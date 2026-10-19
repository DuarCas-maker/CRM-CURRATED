import { z } from "zod";
import {
  checkOrigin,
  requireUser,
  checkDb,
  HttpError,
  jsonError,
  serviceClient,
} from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import { decrypt, encrypt, hash } from "@/lib/server/crypto";
import {
  companyApplicationSchema,
  emptyCompanyApplication,
  representativeSignatureSchema,
  validateCompleteApplication,
  type CompanyApplicationRecord,
  SAMPLE_APPLICATION_DECLARATION,
  bindApplicationAdvisor,
  applicationFilename,
} from "@/lib/company-application";
import { companyApplicationPdf } from "@/lib/server/company-application-pdf";
import { uploadDocument } from "@/lib/server/documents";

async function context(id: string) {
  const { db, profile } = await requireUser();
  if (!checkDb(await db.rpc("can_edit_case", { case_id: id })))
    throw new HttpError(403, "Case is inaccessible or read-only");
  const opportunity = checkDb(
    await db
      .from("opportunities")
      .select("id,company_id,company,contact_id,seller_id")
      .eq("id", id)
      .single(),
  )!;
  if (!opportunity.company_id)
    opportunity.company_id =
      checkDb(
        await db
          .from("contacts")
          .select("company_id")
          .eq("id", opportunity.contact_id)
          .maybeSingle(),
      )?.company_id || null;
  const service = serviceClient();
  const current = opportunity.company_id
    ? checkDb(
        await service
          .from("company_applications")
          .select("revision,encrypted_payload,updated_at")
          .eq("company_id", opportunity.company_id)
          .maybeSingle(),
      )
    : null;
  return { db, service, profile, opportunity, current };
}
export async function GET(request: Request) {
  try {
    const id = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("opportunity"));
    const c = await context(id);
    const advisor = checkDb(
      await c.db
        .from("profiles")
        .select("id,name,email")
        .eq("id", c.opportunity.seller_id)
        .maybeSingle(),
    );
    return Response.json(
      {
        defaults: {
          ...emptyCompanyApplication(c.opportunity.company),
          commercial_name: advisor?.name || "",
          commercial_email: advisor?.email || "",
          identifier: advisor?.id || "",
        },
        revision: c.current?.revision || 0,
        record: c.current
          ? JSON.parse(decrypt(c.current.encrypted_payload))
          : null,
        declaration:
          process.env.FORM_DECLARATION_TEXT || SAMPLE_APPLICATION_DECLARATION,
        declaration_hash: hash(
          process.env.FORM_DECLARATION_TEXT || SAMPLE_APPLICATION_DECLARATION,
        ),
        company: c.opportunity.company,
        advisors:
          checkDb(
            await c.service
              .from("profiles")
              .select("id,name,email")
              .eq("active", true)
              .order("name"),
          ) || [],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const p = z
      .object({
        opportunity_id: z.uuid(),
        revision: z.number().int().min(0),
        action: z.enum(["save", "generate"]),
        data: companyApplicationSchema.optional(),
        signature: representativeSignatureSchema.nullable().optional(),
        declaration_hash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable()
          .optional(),
      })
      .parse(JSON.parse((await readBounded(request, 300000)).toString("utf8")));
    const c = await context(p.opportunity_id);
    if ((c.current?.revision || 0) !== p.revision)
      throw new HttpError(409, "Application changed; reload before saving");
    if (p.action === "save") {
      let data = companyApplicationSchema.parse(p.data);
      try {
        data = bindApplicationAdvisor(
          data,
          checkDb(
            await c.service
              .from("profiles")
              .select("id,name,email")
              .eq("active", true),
          ) || [],
        );
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
      if (p.signature) {
        try {
          validateCompleteApplication(data);
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
        if (
          p.declaration_hash !==
          hash(
            process.env.FORM_DECLARATION_TEXT || SAMPLE_APPLICATION_DECLARATION,
          )
        )
          throw new HttpError(
            409,
            "Disclosures changed; reload and review before signing",
          );
      }
      const record: CompanyApplicationRecord = {
        data,
        declaration: p.signature
          ? process.env.FORM_DECLARATION_TEXT || SAMPLE_APPLICATION_DECLARATION
          : null,
        signature: p.signature
          ? {
              image: p.signature.image,
              name: c.profile.name,
              actor_id: c.profile.id,
              signed_at: new Date().toISOString(),
              capacity: "authorized_representative",
            }
          : null,
      };
      if (p.signature) {
        const signatureBytes = Buffer.from(
          p.signature.image.split(",")[1],
          "base64",
        );
        if (
          signatureBytes.length < 24 ||
          !signatureBytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          signatureBytes.readUInt32BE(16) > 2000 ||
          signatureBytes.readUInt32BE(20) > 1000
        )
          throw new HttpError(400, "Invalid signature image dimensions");
        const { PDFDocument } = await import("pdf-lib");
        const verification = await PDFDocument.create();
        const png = await verification.embedPng(p.signature.image);
        if (png.width > 2000 || png.height > 1000)
          throw new HttpError(400, "Signature image too large");
      }
      return Response.json(
        checkDb(
          await c.service.rpc("save_company_application", {
            case_id: p.opportunity_id,
            payload: encrypt(JSON.stringify(record)),
            expected_revision: p.revision,
            acting_user: c.profile.id,
          }),
        ),
      );
    }
    if (!c.current) throw new HttpError(400, "Save the application first");
    const record = JSON.parse(
      decrypt(c.current.encrypted_payload),
    ) as CompanyApplicationRecord;
    record.data = companyApplicationSchema.parse(record.data);
    try {
      validateCompleteApplication(record.data);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const declaration =
      record.declaration ||
      process.env.FORM_DECLARATION_TEXT ||
      SAMPLE_APPLICATION_DECLARATION;
    if (!declaration)
      throw new HttpError(
        503,
        "Configure FORM_DECLARATION_TEXT before generating the application",
      );
    checkDb(
      await c.service.rpc("initialize_checklist", {
        case_id: p.opportunity_id,
        product_name: "MCA",
      }),
    );
    const documents =
      checkDb(
        await c.db
          .from("documents")
          .select("*")
          .eq("opportunity_id", p.opportunity_id),
      ) || [];
    const application = documents.find((d) => d.kind === "application");
    if (!application) throw new HttpError(400, "Application document required");
    const bytes = await companyApplicationPdf(record, {
      id: c.opportunity.company_id || p.opportunity_id,
      revision: p.revision,
      generatedAt: c.current.updated_at,
      declaration,
      files: documents
        .filter((d) => d.storage_path && d.kind !== "application")
        .map((d) => ({
          name: d.bank_name ? `${d.bank_name} - ${d.name}` : d.name,
          kind: d.kind,
        })),
    });
    const uploaded = await uploadDocument(
      new File([new Uint8Array(bytes)], applicationFilename(record.data), {
        type: "application/pdf",
      }),
      application.id,
      p.opportunity_id,
    );
    checkDb(
      await c.service.rpc("register_company_application_pdf", {
        case_id: p.opportunity_id,
        document: application.id,
        revision: p.revision,
        path: uploaded.path,
        content_hash: uploaded.contentHash,
        signed: !!record.signature,
        acting_user: c.profile.id,
      }),
    );
    return Response.json({
      document_id: application.id,
      url: `/api/documents/${application.id}`,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "PDF_FONT_UNSUPPORTED_CHARACTER")
      return Response.json(
        {
          error:
            "El PDF requiere una fuente compatible con los caracteres ingresados. / The PDF needs a font supporting the entered characters.",
        },
        { status: 400 },
      );
    if (e instanceof z.ZodError)
      return Response.json(
        { error: e.issues[0]?.message || "Invalid application" },
        { status: 400 },
      );
    return jsonError(e);
  }
}

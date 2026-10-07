import { z } from "zod";
import { applicationSchema } from "@/lib/application";
import { resolveApplicationLink } from "@/lib/server/application-links";
import {
  checkOrigin,
  checkDb,
  jsonError,
  HttpError,
} from "@/lib/server/supabase";
import { hash, encrypt } from "@/lib/server/crypto";
import { readBounded } from "@/lib/server/body";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    checkOrigin(request);
    const { token } = await params;
    const { db, link } = await resolveApplicationLink(token);
    const raw = (await readBounded(request, 100000)).toString("utf8");
    const input = z
      .object({ application: applicationSchema, idempotency_key: z.uuid() })
      .parse(JSON.parse(raw));
    const payload = {
      ...input.application,
      declaration: process.env.FORM_DECLARATION_TEXT!,
      declaration_version: process.env.FORM_DECLARATION_VERSION!,
    };
    const id = checkDb(
      await db.rpc("persist_application", {
        link_hash: hash(token),
        payload_encrypted: encrypt(JSON.stringify(payload)),
        payload_hash: hash(JSON.stringify(payload)),
        declaration_version: payload.declaration_version,
        signature_name: input.application.signature_name,
        request_key: input.idempotency_key,
      }),
    );
    return Response.json({ id, received: true });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Please review all required fields." },
        { status: 400 },
      );
    return jsonError(e);
  }
}

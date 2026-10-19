import { z } from "zod";
import {
  recipientIssues,
  recipientSelectionSchema,
} from "@/lib/mail-recipient-selections";
import { readRecipientDirectory } from "@/lib/server/mail-recipient-selections";
import { readBounded } from "@/lib/server/body";
import {
  checkDb,
  checkOrigin,
  HttpError,
  jsonError,
  requireUser,
} from "@/lib/server/supabase";

export async function GET() {
  try {
    const { db, profile } = await requireUser();
    const selections =
      checkDb(
        await db
          .from("mail_recipient_selections")
          .select("id,name,targets")
          .eq("user_id", profile.id)
          .order("name"),
      ) || [];
    return Response.json(
      { selections, directory: await readRecipientDirectory(db) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    const input = z
      .discriminatedUnion("action", [
        recipientSelectionSchema.extend({
          action: z.literal("save"),
          id: z.uuid(),
        }),
        z.object({ action: z.literal("apply"), id: z.uuid() }),
      ])
      .parse(JSON.parse((await readBounded(request, 150000)).toString("utf8")));
    if (input.action === "apply") {
      const selection = checkDb(
        await db
          .from("mail_recipient_selections")
          .select("id,name,targets")
          .eq("user_id", profile.id)
          .eq("id", input.id)
          .maybeSingle(),
      );
      if (!selection)
        throw new HttpError(
          404,
          "Selección no encontrada. / Selection not found.",
        );
      const directory = await readRecipientDirectory(db);
      return Response.json(
        {
          selection,
          directory,
          issues: recipientIssues(selection.targets, directory),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const directory = await readRecipientDirectory(db);
    if (recipientIssues(input.targets, directory).length)
      throw new HttpError(
        409,
        "Revisa los contactos eliminados, inactivos o que cambiaron de lender. / Review deleted, inactive or reassigned contacts.",
      );
    const selection = checkDb(
      await db
        .from("mail_recipient_selections")
        .upsert(
          {
            id: input.id,
            user_id: profile.id,
            name: input.name,
            targets: input.targets,
          },
          { onConflict: "id" },
        )
        .select("id,name,targets")
        .single(),
    );
    return Response.json({ selection });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        {
          error:
            "Revisa el nombre y los destinatarios. / Check the name and recipients.",
        },
        { status: 400 },
      );
    return jsonError(e);
  }
}

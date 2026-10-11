import { z } from "zod";
import {
  requireUser,
  checkOrigin,
  checkDb,
  jsonError,
  HttpError,
} from "@/lib/server/supabase";
import { readBounded } from "@/lib/server/body";
import { gmailHistoryEnabled } from "@/lib/gmail-feature";
const scope = z
  .object({ run_id: z.uuid().nullable(), case_id: z.uuid().nullable() })
  .refine((v) => !!v.run_id !== !!v.case_id);
const selection = scope.and(
  z.object({
    choices: z
      .array(
        z.object({
          archive_message_id: z.uuid(),
          part_id: z.string().min(1).max(200),
          included: z.boolean(),
        }),
      )
      .max(500),
    mark_reviewed: z.boolean(),
  }),
);
async function user() {
  if (!gmailHistoryEnabled())
    throw new HttpError(503, "Gmail history is not enabled");
  return requireUser();
}
export async function GET(request: Request) {
  try {
    const { db } = await user(),
      p = new URL(request.url).searchParams;
    const s = scope.parse({ run_id: p.get("run"), case_id: p.get("case") });
    const candidate = p.get("candidate");
    if (candidate) z.uuid().parse(candidate);
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(p.get("page") || 0);
    const formats = z
      .array(z.string().regex(/^[A-Z0-9]{1,10}$/))
      .max(50)
      .parse(p.getAll("format"));
    return Response.json(
      checkDb(
        await db.rpc("gmail_attachment_list", {
          run: s.run_id,
          candidate,
          case_id: s.case_id,
          formats,
          show_inline: p.get("inline") === "true",
          cursor_offset: page * 50,
        }),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { db } = await user();
    const s = selection.parse(
      JSON.parse((await readBounded(request, 160000)).toString("utf8")),
    );
    checkDb(
      await db.rpc("gmail_select_attachments", {
        run: s.run_id,
        case_id: s.case_id,
        choices: s.choices,
        mark_reviewed: s.mark_reviewed,
      }),
    );
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Invalid attachment selection" },
        { status: 400 },
      );
    return jsonError(e);
  }
}

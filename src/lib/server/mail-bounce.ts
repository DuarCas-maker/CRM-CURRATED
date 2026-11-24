import { z } from "zod";
import { checkOrigin, checkDb, jsonError, requireUser, HttpError } from "./supabase";
import { readBounded } from "./body";

export async function unlockMailbox(request: Request) {
  try {
    checkOrigin(request);
    const { db, profile } = await requireUser();
    if (!["superadmin", "seller_admin"].includes(profile.role)) throw new HttpError(403,"Operación no autorizada / Forbidden");
    const value = z.strictObject({email:z.email().max(320),reason:z.string().trim().min(10).max(500)}).parse(JSON.parse((await readBounded(request,2048)).toString("utf8")));
    checkDb(await db.rpc("unlock_full_mailbox",{address:value.email,explanation:value.reason}),"unlock_full_mailbox");
    return Response.json({ok:true},{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({error:"Indica un correo y un motivo de al menos 10 caracteres."},{status:400});
    return jsonError(error);
  }
}

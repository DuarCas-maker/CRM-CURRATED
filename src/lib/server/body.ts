import { HttpError } from "./supabase";
export async function readBounded(request: Request, max: number) {
  if (Number(request.headers.get("content-length") || 0) > max)
    throw new HttpError(413, "Payload too large");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, "Payload too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function boundedForm(request: Request, max: number) {
  const bytes = await readBounded(request, max);
  return new Response(bytes, {
    headers: { "Content-Type": request.headers.get("content-type") || "" },
  }).formData();
}

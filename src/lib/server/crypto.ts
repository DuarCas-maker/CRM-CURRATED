import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
function key() {
  const value = Buffer.from(
    process.env.INTEGRATION_ENCRYPTION_KEY || "",
    "base64",
  );
  if (value.length !== 32)
    throw new Error("A 32-byte encryption key is required");
  return value;
}
export function encrypt(value: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [nonce, cipher.getAuthTag(), encrypted]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function decrypt(value: string) {
  const parts = value.split(".").map((p) => Buffer.from(p, "base64url"));
  if (parts.length !== 3) throw new Error("Invalid encrypted value");
  const cipher = createDecipheriv("aes-256-gcm", key(), parts[0]);
  cipher.setAuthTag(parts[1]);
  return Buffer.concat([cipher.update(parts[2]), cipher.final()]).toString(
    "utf8",
  );
}
export const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");

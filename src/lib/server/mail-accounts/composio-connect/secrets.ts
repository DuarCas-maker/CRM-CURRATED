import { createCipheriv, createDecipheriv } from "node:crypto";
import { z } from "zod";
import { ConnectError } from "../../../composio-connect";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const contextSchema = z.strictObject({
  attempt_id: z.uuid(),
  slot: z.enum(["state", "navigation"]),
  generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});
export type ConnectSecretContext = z.infer<typeof contextSchema>;
export interface ConnectSecrets {
  seal(value: string, context: ConnectSecretContext): string;
  open(value: string, context: ConnectSecretContext): string;
}
const fail = () => new ConnectError("CONNECT_UNAVAILABLE");
function decode(value: string, max: number): Buffer {
  if (!value || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value))
    throw fail();
  const b = Buffer.from(value, "base64url");
  if (b.toString("base64url") !== value) throw fail();
  return b;
}
export function createConnectSecrets(options: {
  activeKeyId: string;
  keys: Readonly<Record<string, Uint8Array>>;
  randomBytes: (size: number) => Uint8Array;
}): ConnectSecrets {
  try {
    id.parse(options.activeKeyId);
    if (
      typeof options.randomBytes !== "function" ||
      !options.keys ||
      Object.keys(options.keys).length > 16
    )
      throw fail();
    const keys = new Map<string, Buffer>();
    for (const [name, key] of Object.entries(options.keys)) {
      id.parse(name);
      if (!(key instanceof Uint8Array) || key.byteLength !== 32) throw fail();
      keys.set(name, Buffer.from(key));
    }
    if (!keys.has(options.activeKeyId)) throw fail();
    const active = options.activeKeyId,
      random = options.randomBytes;
    const aad = (context: ConnectSecretContext, keyId: string) =>
      Buffer.from(
        JSON.stringify([
          1,
          keyId,
          ...Object.values(contextSchema.parse(context)),
        ]),
      );
    return {
      seal(value, context) {
        try {
          if (
            typeof value !== "string" ||
            !value ||
            Buffer.byteLength(value) > 8192
          )
            throw fail();
          const associated = aad(context, active),
            nonce = Buffer.from(random(12));
          if (nonce.length !== 12) throw fail();
          const cipher = createCipheriv(
            "aes-256-gcm",
            keys.get(active)!,
            nonce,
          );
          cipher.setAAD(associated);
          const encrypted = Buffer.concat([
            cipher.update(value, "utf8"),
            cipher.final(),
          ]);
          return [
            "1",
            active,
            nonce.toString("base64url"),
            cipher.getAuthTag().toString("base64url"),
            encrypted.toString("base64url"),
          ].join(".");
        } catch {
          throw fail();
        }
      },
      open(value, context) {
        try {
          if (typeof value !== "string" || value.length > 12000) throw fail();
          const parts = value.split(".");
          if (parts.length !== 5 || parts[0] !== "1") throw fail();
          const key = keys.get(id.parse(parts[1]));
          if (!key) throw fail();
          const nonce = decode(parts[2], 16),
            tag = decode(parts[3], 22),
            encrypted = decode(parts[4], 11000);
          if (
            nonce.length !== 12 ||
            tag.length !== 16 ||
            encrypted.length > 8192
          )
            throw fail();
          const cipher = createDecipheriv("aes-256-gcm", key, nonce);
          cipher.setAAD(aad(context, parts[1]));
          cipher.setAuthTag(tag);
          return new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat([cipher.update(encrypted), cipher.final()]),
          );
        } catch {
          throw fail();
        }
      },
    };
  } catch {
    throw fail();
  }
}

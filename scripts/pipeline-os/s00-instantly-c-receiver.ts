// Backwards-compatible S00 surface; production imports the pure src module instead.
import * as core from "../../src/lib/server/instantly/receiver";
import { mkdir, open, readFile, rename, unlink, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { S00RunError } from "./s00-composio-common";
import type {
  CReceiptStore,
  CReceiptState,
} from "../../src/lib/server/instantly/receiver";
export type {
  CManifest,
  CReceiptStore,
  CReceiptState,
  CReceiver,
  CObservation,
} from "../../src/lib/server/instantly/receiver";
const fail = (code: string): never => {
  throw new S00RunError(code);
};
function translate(e: unknown): never {
  if (e instanceof core.WebhookError) throw new S00RunError(e.code);
  throw e;
}
function sync<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    return translate(e);
  }
}
async function asyncCall<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    return translate(e);
  }
}
export const cReceiverManifestSchema = core.cReceiverManifestSchema;
export const validateCManifest: typeof core.validateCManifest = (value) =>
  sync(() => core.validateCManifest(value));
export const cSecrets: typeof core.cSecrets = (env, m) =>
  sync(() => core.cSecrets(env, m));
export const validateCReceipt: typeof core.validateCReceipt = (value) =>
  sync(() => core.validateCReceipt(value));
export const cPayloadDigest: typeof core.cPayloadDigest = (value, key) =>
  sync(() => core.cPayloadDigest(value, key));
const receiptTransition: typeof core.receiptTransition = (p, n) =>
  sync(() => core.receiptTransition(p, n));
export const createCReceiver: typeof core.createCReceiver = (input) => {
  const r = sync(() => core.createCReceiver(input));
  return {
    ...r,
    arm: () => asyncCall(r.arm),
    observe: () => asyncCall(r.observe),
    close: () => asyncCall(r.close),
  };
};
export function cReceiptFiles(root: string): CReceiptStore {
  const folder = resolve(root, ".local/pipeline-os"),
    file = resolve(folder, "s00-instantly-c-receipt.json");
  const load = async () => {
    try {
      const m = await lstat(file);
      if (!m.isFile() || m.isSymbolicLink() || m.size > 16384)
        fail("C_RECEIPT_STORAGE_FAILED");
      const text = await readFile(file, "utf8");
      if (Buffer.byteLength(text) > 16384) fail("C_RECEIPT_STORAGE_FAILED");
      return validateCReceipt(JSON.parse(text));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      return fail("C_RECEIPT_STORAGE_FAILED");
    }
  };
  return {
    load,
    async transact(change) {
      let lock: Awaited<ReturnType<typeof open>> | undefined;
      try {
        await mkdir(folder, { recursive: true });
        if ((await lstat(folder)).isSymbolicLink())
          fail("C_RECEIPT_STORAGE_FAILED");
        lock = await open(file + ".lock", "wx", 0o600);
        const p = await load(),
          n = change(p && structuredClone(p));
        receiptTransition(p, n);
        const text = JSON.stringify(n, null, 2) + "\n";
        if (Buffer.byteLength(text) > 16384) fail("C_RECEIPT_STORAGE_FAILED");
        const tmp = await open(file + ".tmp", "wx", 0o600);
        try {
          await tmp.writeFile(text);
          await tmp.sync();
        } finally {
          await tmp.close();
        }
        await rename(file + ".tmp", file);
      } catch {
        fail("C_RECEIPT_STORAGE_FAILED");
      } finally {
        if (lock) {
          await lock.close();
          await unlink(file + ".lock");
        }
      }
    },
  };
}

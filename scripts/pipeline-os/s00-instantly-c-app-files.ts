import { mkdir, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { validateCSource } from "./s00-instantly-c";
import {
  validateCAppState,
  assertCAppTransition,
  type CAppStore,
  type CAppState,
  type CAppInputs,
} from "./s00-instantly-c-app";
export function cAppFiles(root: string) {
  const folder = resolve(root, ".local/pipeline-os"),
    file = resolve(folder, "s00-instantly-run.json"),
    runtime = resolve(folder, "c-app/runtime");
  let held = false;
  async function directories() {
    for (const d of [resolve(root, ".local"), folder]) {
      const s = await lstat(d);
      if (!s.isDirectory() || s.isSymbolicLink())
        throw Error("CAPP_UNSAFE_DIRECTORY");
    }
  }
  async function runtimeDirectories(create = false) {
    await directories();
    for (const d of [resolve(folder, "c-app"), runtime]) {
      if (create)
        await mkdir(d).catch((e) => {
          if (e.code !== "EEXIST") throw e;
        });
      const s = await lstat(d);
      if (!s.isDirectory() || s.isSymbolicLink())
        throw Error("CAPP_UNSAFE_DIRECTORY");
    }
  }
  async function read(path: string) {
    const s = await lstat(path);
    if (!s.isFile() || s.isSymbolicLink() || s.size > 262144)
      throw Error("CAPP_UNSAFE_FILE");
    return JSON.parse(await readFile(path, "utf8"));
  }
  const store: CAppStore = {
    load: async () => {
      try {
        await directories();
        const s = await read(file);
        return s.version === 9 ? validateCAppState(s) : validateCSource(s);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw Error("CAPP_STORAGE_INVALID");
      }
    },
    save: async (s: CAppState) => {
      if (!held) throw Error("CAPP_LOCK_REQUIRED");
      await directories();
      const old = await store.load();
      if (!old) throw Error("CAPP_SOURCE_REQUIRED");
      assertCAppTransition(old, s);
      const text = JSON.stringify(s, null, 2) + "\n";
      if (Buffer.byteLength(text) > 262144) throw Error("CAPP_STORAGE_LIMIT");
      const tmp = await open(file + ".tmp", "wx", 0o600);
      try {
        await tmp.writeFile(text);
        await tmp.sync();
      } finally {
        await tmp.close();
      }
      await rename(file + ".tmp", file);
    },
  };
  return {
    store,
    inputs: async (): Promise<CAppInputs> => {
      const source = await store.load();
      if (!source) throw Error("CAPP_SOURCE_REQUIRED");
      const base =
        source.version === 9
          ? source.provider.version === 8
            ? source.provider.prior
            : source.provider
          : source;
      await runtimeDirectories();
      return {
        source: base,
        scope: await read(
          resolve(folder, "s00-instantly-scope-attestation.json"),
        ),
        bManifest: await read(resolve(folder, "s00-instantly-b-manifest.json")),
        manifest: await read(resolve(runtime, "manifest.json")),
      };
    },
    ticket: async () => {
      await runtimeDirectories();
      return read(resolve(runtime, "ticket.json"));
    },
    approval: async (value: unknown) => {
      if (!held) throw Error("CAPP_LOCK_REQUIRED");
      await runtimeDirectories(true);
      const f = await open(resolve(runtime, "approval.json"), "wx", 0o600);
      try {
        await f.writeFile(JSON.stringify(value, null, 2));
        await f.sync();
      } finally {
        await f.close();
      }
    },
    locked: async <T>(action: () => Promise<T>) => {
      await directories();
      const lock = await open(file + ".lock", "wx", 0o600);
      try {
        held = true;
        return await action();
      } finally {
        held = false;
        await lock.close();
        await unlink(file + ".lock");
      }
    },
  };
}

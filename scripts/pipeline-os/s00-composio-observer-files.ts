import { mkdir, open, readFile, rename, unlink, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { validateRunState, type RunState } from "./s00-composio-runner";
import {
  validateObservation,
  type ObservationStore,
  type ObservationState,
} from "./s00-composio-observer";
import { fail } from "./s00-composio-common";

export function observationFiles(root: string) {
  const folder = resolve(root, ".local/pipeline-os"),
    source = resolve(folder, "s00-composio-run.json"),
    path = resolve(folder, "s00-composio-observation.json");
  const load = async <T>(
    target: string,
    validate: (value: unknown) => T,
    optional = false,
  ): Promise<T | undefined> => {
    try {
      if ((await stat(target)).size > 65_536)
        return fail("INVALID_JOURNAL_SIZE");
      const text = await readFile(target, "utf8");
      if (Buffer.byteLength(text) > 65_536) return fail("INVALID_JOURNAL_SIZE");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return fail("INVALID_JOURNAL_JSON");
      }
      return validate(parsed);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT" && optional)
        return undefined;
      throw e;
    }
  };
  const store: ObservationStore = {
    load: () => load(path, validateObservation, true),
    async save(state: ObservationState) {
      validateObservation(state);
      const text = JSON.stringify(state, null, 2) + "\n";
      if (Buffer.byteLength(text) > 65_536) return fail("INVALID_JOURNAL_SIZE");
      const file = await open(path + ".tmp", "wx", 0o600);
      try {
        await file.writeFile(text);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(path + ".tmp", path);
    },
  };
  return {
    store,
    source: () => load<RunState>(source, validateRunState),
    async locked<T>(work: () => Promise<T>) {
      await mkdir(folder, { recursive: true });
      const held: { path: string; file: Awaited<ReturnType<typeof open>> }[] =
        [];
      try {
        for (const p of [source + ".lock", path + ".lock"]) {
          try {
            held.push({ path: p, file: await open(p, "wx", 0o600) });
          } catch {
            return fail("JOURNAL_LOCKED");
          }
        }
        return await work();
      } finally {
        for (const h of held.reverse()) {
          await h.file.close();
          await unlink(h.path);
        }
      }
    },
  };
}

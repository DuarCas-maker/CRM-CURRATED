import { readFile, stat, open, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { observationFiles } from "./s00-composio-observer-files";
import {
  type ReconnectStore,
  type ReconnectSources,
} from "./s00-composio-reconnect";
import { fail, hash } from "./s00-composio-common";
import {
  validateReconnectLedger,
  type ReconnectLedger,
  type CorrectionStore,
} from "./s00-composio-correction";

export function reconnectFiles(root: string) {
  const previous = observationFiles(root),
    path = resolve(root, ".local/pipeline-os/s00-composio-reconnect.json");
  const ledgerStore: CorrectionStore & {
    save(state: ReconnectLedger): Promise<void>;
  } = {
    async load() {
      let text: string;
      try {
        if ((await stat(path)).size > 65_536)
          return fail("INVALID_JOURNAL_SIZE");
        text = await readFile(path, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw e;
      }
      if (Buffer.byteLength(text) > 65_536) return fail("INVALID_JOURNAL_SIZE");
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        return fail("INVALID_JOURNAL_JSON");
      }
      return validateReconnectLedger(data);
    },
    async save(state) {
      validateReconnectLedger(state);
      const existing = await ledgerStore.load();
      if (existing?.version === 2) {
        if (
          state.version !== 2 ||
          state.predecessorHash !== existing.predecessorHash ||
          state.token !== existing.token ||
          state.fingerprint !== existing.fingerprint ||
          state.targetHash !== existing.targetHash ||
          JSON.stringify(state.originalIds) !==
            JSON.stringify(existing.originalIds) ||
          state.calls < existing.calls ||
          existing.requests.some((r, i) => {
            const n = state.requests[i];
            return (
              !n ||
              r.op !== n.op ||
              r.bucket !== n.bucket ||
              r.startedAt !== n.startedAt ||
              (r.result !== "IN_FLIGHT" && r.result !== n.result)
            );
          }) ||
          (existing.link.id && existing.link.id !== state.link.id) ||
          (existing.link.url && existing.link.url !== state.link.url) ||
          (existing.link.expiresAt &&
            existing.link.expiresAt !== state.link.expiresAt) ||
          state.link.statusChecks < existing.link.statusChecks ||
          (existing.link.delivered && !state.link.delivered) ||
          (existing.phase === "completed" && state.phase !== "completed") ||
          (existing.link.status !== "not_sent" &&
            state.link.status === "not_sent")
        )
          return fail("CORRECTION_HISTORY_IMMUTABLE");
      } else if (
        state.version === 2 &&
        (!existing || hash(JSON.stringify(existing)) !== state.predecessorHash)
      )
        return fail("CORRECTION_HISTORY_IMMUTABLE");
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
    async deliver(url) {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        return fail("INVALID_AUTH_LINK");
      }
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.port ||
        !["connect.composio.dev", "backend.composio.dev"].includes(u.hostname)
      )
        return fail("INVALID_AUTH_LINK");
      const target = resolve(
          root,
          ".local/pipeline-os/s00-composio-m1-correction-enlace.txt",
        ),
        file = await open(target + ".tmp", "wx", 0o600);
      try {
        await file.writeFile(u.href + "\r\n");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(target + ".tmp", target);
    },
  };
  const store: ReconnectStore = {
    async load() {
      const s = await ledgerStore.load();
      if (s?.version === 2) return fail("CORRECTION_LEDGER_REQUIRES_V2");
      return s;
    },
    save: (state) => ledgerStore.save(state),
  };
  return {
    store,
    ledgerStore,
    async targetText() {
      const target = resolve(
        root,
        ".local/pipeline-os/s00-m1-target-email.txt",
      );
      try {
        if ((await stat(target)).size > 512)
          return fail("M1_TARGET_REQUIRED_OR_TOO_LARGE");
        const t = await readFile(target, "utf8");
        if (Buffer.byteLength(t) > 512)
          return fail("M1_TARGET_REQUIRED_OR_TOO_LARGE");
        return t;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw e;
      }
    },
    async sources(): Promise<ReconnectSources> {
      const run = await previous.source(),
        observation = await previous.store.load();
      if (!run || !observation) return fail("SOURCE_REQUIRED");
      return { run, observation };
    },
    locked: async <T>(work: () => Promise<T>) =>
      previous.locked(async () => {
        let lock;
        try {
          lock = await open(path + ".lock", "wx", 0o600);
        } catch {
          return fail("JOURNAL_LOCKED");
        }
        try {
          return await work();
        } finally {
          await lock.close();
          await unlink(path + ".lock");
        }
      }),
  };
}

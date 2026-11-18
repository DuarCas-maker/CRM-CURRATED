import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { simpleMailEnabled } from "../../mail-connections";
import {
  transportProvider,
  transportRevision,
} from "../../mail-transport-selection";
import { GmailError } from "../../gmail-errors";
import { TransportSelectionError } from "./selection";
import { withMailboxScope, validateMailboxScope } from "./mailbox-context";
import { withMailRuntime, type RuntimeDependencies } from "./runtime-context";

const historyId = z.string().regex(/^[0-9]{1,128}$/);
const cycleSchema = z.strictObject({
  id: z.uuid(),
  account_id: z.uuid(),
  provider: transportProvider,
  revision: transportRevision,
  email: z.email(),
  history_id: historyId.nullable(),
  since: z.iso.datetime({ offset: true }),
  deadline: z.iso.datetime({ offset: true }),
});
const pageToken = z.string().min(1).max(4096).optional();
const messageId = z.string().regex(/^[a-f0-9]{1,128}$/i);
const historyPage = z.object({
  history: z
    .array(
      z.object({
        messagesAdded: z
          .array(z.object({ message: z.object({ id: messageId }) }))
          .optional(),
      }),
    )
    .optional(),
  nextPageToken: pageToken,
});
const messagesPage = z.object({
  messages: z.array(z.object({ id: messageId })).optional(),
  nextPageToken: pageToken,
});
export type MailboxSyncPorts<T extends { id: string }> = {
  request<R>(path: string): Promise<R>;
  ingest(account: { id: string; email: string }, message: T): Promise<void>;
};
// The caller supplies the existing ingester. No duplicate parsing, import or attachment logic.
export async function syncSelectedMailbox<T extends { id: string }>(
  account: string,
  revision: unknown,
  deps: RuntimeDependencies,
  ports: MailboxSyncPorts<T>,
) {
  // Old queued jobs are retired without a request. The scheduler replaces them with versioned jobs.
  if (!transportRevision.safeParse(revision).success) return;
  if (!z.uuid().safeParse(account).success)
    throw new TransportSelectionError("R06_INVALID_INPUT");
  const managed =
    simpleMailEnabled() &&
    (await deps.rpc("simple_mail_managed", { account })) === true;
  if (managed) await deps.rpc("simple_mail_recover_sync", { account });
  const capability = randomBytes(32).toString("hex");
  const raw = await deps.rpc("mail_sync_begin", {
    account,
    expected_revision: revision,
    capability_hash: createHash("sha256").update(capability).digest("hex"),
  });
  const parsed = cycleSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.account_id !== account ||
    parsed.data.revision !== revision
  )
    throw new TransportSelectionError("R06_UNAVAILABLE");
  const c = parsed.data;
  const args = { cycle: c.id, capability };
  try {
    const initial = managed
      ? await deps.rpc("simple_mail_sync_floor", { account })
      : null;
    if (
      initial !== null &&
      !z.iso.datetime({ offset: true }).safeParse(initial).success
    )
      throw new TransportSelectionError("R06_UNAVAILABLE");
    if (c.provider === "composio" && !deps.composioEnabled)
      throw new TransportSelectionError("R06_DENIED");
    return await withMailRuntime(deps, () =>
      withMailboxScope(
        {
          account,
          revision: c.revision,
          cycle: c.id,
          capability,
          validate: async () =>
            deps.now() < Date.parse(c.deadline) &&
            (await deps.rpc("mail_sync_validate", args)) === true,
        },
        async () => {
          await validateMailboxScope();
          const baseline = historyId.parse(
            (await ports.request<{ historyId: string }>("profile")).historyId,
          );
          if (initial && !c.history_id) {
            const progress = z
              .strictObject({
                baseline: historyId,
                page: z.string().nullable(),
                done: z.boolean(),
              })
              .parse(
                await deps.rpc("simple_mail_initial_begin", {
                  ...args,
                  baseline,
                }),
              );
            if (progress.done)
              throw new TransportSelectionError("R06_UNAVAILABLE");
            const params = new URLSearchParams({
              q: `after:${Math.floor(Date.parse(String(initial)) / 1000)} -in:spam -in:trash -in:drafts`,
              maxResults: "100",
              includeSpamTrash: "false",
            });
            if (progress.page) params.set("pageToken", progress.page);
            const response = messagesPage.parse(
              await ports.request<unknown>(`messages?${params}`),
            );
            if (response.nextPageToken === progress.page)
              throw new TransportSelectionError("R06_UNAVAILABLE");
            if ((response.messages?.length ?? 0) > 100)
              throw new TransportSelectionError("R06_UNAVAILABLE");
            for (const id of new Set(
              (response.messages ?? []).map((m) => m.id),
            )) {
              await validateMailboxScope();
              let message: T;
              try {
                message = await ports.request<T>(`messages/${id}?format=full`);
              } catch (e) {
                if (e instanceof GmailError && e.status === 404) continue;
                throw e;
              }
              if (message.id !== id)
                throw new TransportSelectionError("R06_DENIED");
              await validateMailboxScope();
              await ports.ingest({ id: account, email: c.email }, message);
            }
            await validateMailboxScope();
            await deps.rpc("simple_mail_initial_advance", {
              ...args,
              expected_page: progress.page,
              next_page: response.nextPageToken ?? null,
            });
            if (response.nextPageToken) await deps.rpc("mail_sync_abort", args);
            return;
          }
          const ids = new Set<string>();
          let full = !c.history_id;
          async function paginate(history: boolean) {
            let page: string | undefined;
            const tokens = new Set<string>();
            for (let n = 0; n < 100; n++) {
              await validateMailboxScope();
              const params = new URLSearchParams(
                history
                  ? {
                      startHistoryId: c.history_id!,
                      historyTypes: "messageAdded",
                      maxResults: "500",
                    }
                  : {
                      q: `after:${Math.floor(Date.parse(c.since) / 1000) - 86400} -in:spam -in:trash -in:drafts`,
                      maxResults: "500",
                      includeSpamTrash: "false",
                    },
              );
              if (page) params.set("pageToken", page);
              const response = await ports.request<unknown>(
                `${history ? "history" : "messages"}?${params}`,
              );
              let values: string[];
              if (history) {
                const parsed = historyPage.parse(response);
                page = parsed.nextPageToken;
                values = (parsed.history || []).flatMap((h) =>
                  (h.messagesAdded || []).map((m) => m.message.id),
                );
              } else {
                const parsed = messagesPage.parse(response);
                page = parsed.nextPageToken;
                values = (parsed.messages || []).map((m) => m.id);
              }
              for (const id of values) ids.add(id);
              if (ids.size > 10000)
                throw new TransportSelectionError("R06_UNAVAILABLE");
              if (!page) return;
              if (tokens.has(page))
                throw new TransportSelectionError("R06_UNAVAILABLE");
              tokens.add(page);
            }
            throw new TransportSelectionError("R06_UNAVAILABLE");
          }
          if (!full) {
            try {
              await paginate(true);
            } catch (e) {
              if (e instanceof GmailError && e.status === 404) full = true;
              else throw e;
            }
          }
          if (full) await paginate(false);
          for (const id of ids) {
            await validateMailboxScope();
            let message: T;
            try {
              message = await ports.request<T>(`messages/${id}?format=full`);
            } catch (e) {
              if (e instanceof GmailError && e.status === 404) continue;
              throw e;
            }
            if (message.id !== id)
              throw new TransportSelectionError("R06_DENIED");
            await validateMailboxScope();
            await ports.ingest({ id: account, email: c.email }, message);
          }
          await validateMailboxScope();
          await deps.rpc(
            managed ? "simple_mail_sync_complete" : "mail_sync_complete",
            {
              ...args,
              checkpoint: baseline,
            },
          );
        },
      ),
    );
  } catch (error) {
    try {
      await deps.rpc("mail_sync_abort", args);
    } catch {
      throw new TransportSelectionError("R06_UNCERTAIN", true);
    }
    throw error;
  }
}

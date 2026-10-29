import { createHash } from "node:crypto";
import { z } from "zod";
import {
  WebhookError,
  validateCManifest,
  validateCReceipt,
  receiptTransition,
  createCReceiver,
  type CManifest,
  type CReceiptState,
  type CReceiptStore,
} from "./receiver";

export interface WebhookRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }> & {
    abortSignal?(
      signal: AbortSignal,
    ): PromiseLike<{ data: unknown; error: unknown }>;
  };
}
export type Trial = {
  manifest: CManifest;
  workspace: string;
  campaign: string;
  revision: number;
  state: CReceiptState | undefined;
};
const nonceSchema = z.string().regex(/^[a-f0-9]{24}$/);
const envelope = z
  .object({
    manifest: z.unknown(),
    workspace: z.string().uuid(),
    campaign: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    state: z.unknown().nullable(),
  })
  .strict();
const binding = (m: CManifest) =>
  createHash("sha256").update(JSON.stringify(m)).digest("hex");
const fail = (): never => {
  throw new WebhookError("IA_STORAGE_UNAVAILABLE");
};
async function rpc(
  client: WebhookRpcClient,
  name: string,
  args: Record<string, unknown>,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = client.rpc(name, args),
      operation = request.abortSignal
        ? request.abortSignal(controller.signal)
        : request;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new WebhookError("IA_STORAGE_UNAVAILABLE"));
      }, 8000);
    });
    const response = await Promise.race([operation, timeout]);
    if (response.error) fail();
    return response.data;
  } catch {
    return fail();
  } finally {
    clearTimeout(timer);
  }
}
export async function readInstantlyTrial(
  client: WebhookRpcClient,
  nonce: string,
): Promise<Trial | undefined> {
  nonceSchema.parse(nonce);
  const raw = await rpc(client, "instantly_webhook_trial_read", {
    p_nonce: nonce,
  });
  if (raw === null) return undefined;
  const p = envelope.safeParse(raw);
  if (!p.success) return fail();
  try {
    const manifest = validateCManifest(p.data.manifest),
      state =
        p.data.state === null ? undefined : validateCReceipt(p.data.state);
    if (
      manifest.nonce !== nonce ||
      (state &&
        (state.manifestHash !== binding(manifest) ||
          state.armedAt < manifest.startsAt ||
          state.deadline !== manifest.endsAt))
    )
      return fail();
    return { ...p.data, manifest, state };
  } catch {
    return fail();
  }
}
export async function prepareInstantlyTrial(
  client: WebhookRpcClient,
  manifest: CManifest,
  workspace: string,
  campaign: string,
) {
  const m = validateCManifest(manifest);
  z.string().uuid().parse(workspace);
  z.string().uuid().parse(campaign);
  await rpc(client, "instantly_webhook_trial_prepare", {
    p_nonce: m.nonce,
    p_manifest: m,
    p_manifest_hash: binding(m),
    p_workspace: workspace,
    p_campaign: campaign,
  });
}
export function instantlyReceiptStore(
  client: WebhookRpcClient,
  trial: Trial,
): CReceiptStore {
  let cached: Trial | undefined = trial,
    first = true;
  const read = async () => {
    const next = first
      ? ((first = false), trial)
      : await readInstantlyTrial(client, trial.manifest.nonce);
    if (
      !next ||
      binding(next.manifest) !== binding(trial.manifest) ||
      next.workspace !== trial.workspace ||
      next.campaign !== trial.campaign
    )
      return fail();
    cached = next;
    return next;
  };
  return {
    async load() {
      return structuredClone((await read()).state);
    },
    async transact(change) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const previous = cached ?? (await read()),
          next = change(previous.state && structuredClone(previous.state));
        receiptTransition(previous.state, next);
        const response = await rpc(client, "instantly_webhook_trial_cas", {
          p_nonce: trial.manifest.nonce,
          p_revision: previous.revision,
          p_state: next,
        });
        const p = z
          .object({
            applied: z.boolean(),
            revision: z.number().int().nonnegative(),
          })
          .strict()
          .safeParse(response);
        if (!p.success) return fail();
        if (p.data.applied) {
          if (
            p.data.revision < previous.revision ||
            p.data.revision > previous.revision + 1
          )
            return fail();
          cached = {
            ...previous,
            revision: p.data.revision,
            state: structuredClone(next),
          };
          first = false;
          return;
        }
        cached = undefined;
        first = false;
      }
      return fail();
    },
  };
}
export function createInstantlyDbReceiver(input: {
  client: WebhookRpcClient;
  trial: Trial;
  token: string;
  key: string;
  now?: () => number;
}) {
  return createCReceiver({
    manifest: input.trial.manifest,
    workspace: input.trial.workspace,
    campaign: input.trial.campaign,
    token: input.token,
    key: input.key,
    store: instantlyReceiptStore(input.client, input.trial),
    now: input.now,
  });
}

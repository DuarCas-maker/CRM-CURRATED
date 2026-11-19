import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { CodeChallengeMethod } from "google-auth-library";
import { z } from "zod";
import { requireUser, serviceClient, HttpError } from "../../supabase";
import { configuredOrganizations, oauthClient } from "../../google";
import { token, hash, encrypt, decrypt } from "../../crypto";
import {
  bindingPageV2,
  bindingV2Ports,
  bindingCommandV2,
  bindingCheckV2,
} from "../composio-binding-v2";
import { bindingExpected } from "../../../composio-bindings";
import {
  verificationSetupPage,
  verificationSetupPorts,
  verificationSetupCommand,
} from "../composio-verification-setup";
import { existingVerificationContext } from "../composio-existing-verifier";
import {
  readTransportSelection,
  reviewTransportSelection,
  commandTransportSelection,
} from "../transport-selection";
import {
  connectOptions,
  connectBegin,
  connectAction,
  connectGetStatus,
} from "../composio-connect/http";
import {
  connectViewHttp,
  connectOptionsHttp,
} from "../../../composio-connect-http";
import {
  createOnboarding,
  privateConnection,
  simpleRpc,
  stepKey,
  type OnboardingPorts,
  type PrivateConnection,
} from "./service";
import { withIncludedUsage, includedComposioFetch } from "./included";
import { simpleMailReturnUrl } from "./return-url";

export function simpleWorkspace() {
  const all = configuredOrganizations(),
    selected = process.env.SIMPLE_MAIL_ORGANIZATION;
  const matches = selected
    ? all.filter((o) => o.id === selected)
    : all.length === 1
      ? all
      : all.filter((o) => o.id === "curated");
  if (matches.length !== 1) throw new HttpError(503, "SIMPLE_NOT_CONFIGURED");
  return matches[0];
}
export async function productionOnboarding(
  request: Request,
): Promise<OnboardingPorts> {
  const { db, profile } = await requireUser();
  if (profile.role !== "superadmin" || !profile.active)
    throw new HttpError(403, "SIMPLE_FORBIDDEN");
  const service = serviceClient();
  const local = (path: string, body?: object, form = false) =>
    new Request(new URL(path, request.url), {
      ...(body !== undefined || form
        ? {
            method: "POST",
            headers: {
              origin: new URL(request.url).origin,
              "content-type": form
                ? "application/x-www-form-urlencoded"
                : "application/json",
            },
            body: form ? "" : JSON.stringify(body),
          }
        : {}),
    });
  const decode = async <T>(response: Response, schema: z.ZodType<T>) => {
    if (!response.ok) throw new HttpError(409, "SIMPLE_PROVIDER_UNAVAILABLE");
    return schema.parse(await response.json());
  };
  const included = <T>(r: PrivateConnection, action: () => Promise<T>) =>
    withIncludedUsage(
      {
        account: r.account_id,
        reserve: async (key, account, proxy) => {
          const descriptor = z
            .object({ context: existingVerificationContext })
            .parse(bindingV2Ports(db).descriptor());
          return (
            (await simpleRpc(service, "simple_mail_included_reserve", {
              request_key: key,
              account,
              calls: 1,
              proxy: proxy ? 1 : 0,
              project: descriptor.context.composio_project_id,
            })) === true
          );
        },
      },
      action,
    );
  return {
    human: db,
    service,
    workspace: simpleWorkspace,
    state: token,
    encrypt,
    decrypt,
    async directUrl(r, state) {
      (await cookies()).set("simple_mail_state_" + r.id, hash(state), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 600,
        path: "/api/gmail",
      });
      return oauthClient(r.organization).generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        state,
        login_hint: r.email,
        hd: r.domain,
        scope: [
          "openid",
          "email",
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.send",
        ],
        code_challenge_method: CodeChallengeMethod.S256,
        code_challenge: createHash("sha256")
          .update(hash(r.encrypted_state))
          .digest("base64url"),
      });
    },
    async composioBegin(r) {
      return included(r, async () => {
        const options = await decode(
          await connectOptions(
            local(
              "/api/mail/composio/connect" +
                (r.account_id
                  ? "?account_id=" + encodeURIComponent(r.account_id)
                  : ""),
            ),
          ),
          connectOptionsHttp,
        );
        const brand = options.brands.find((b) => b.id === r.brand_id);
        if (
          !options.enabled ||
          !brand ||
          !options.organizations.some((o) => o.id === r.organization)
        )
          throw new HttpError(503, "SIMPLE_NOT_CONFIGURED");
        const a = options.account;
        const body = {
          mode: a ? "existing" : "new",
          idempotency_key: stepKey(r.id, "connect"),
          brand_id: brand.id,
          expected_brand_revision: brand.revision,
          expected_account_revision: a?.account_revision ?? 0,
          expected_head_revision: a?.head_revision ?? 0,
          expected_config_generation: options.generation,
          ...(a
            ? { account_id: a.id }
            : { email: r.email, organization: r.organization }),
        };
        const result = await decode(
          await connectBegin(local("/api/mail/composio/connect", body)),
          connectViewHttp,
        );
        if (!result.status || result.status.expected_mailbox_email !== r.email)
          throw new HttpError(409, "SIMPLE_CONFLICT");
        return result.status.id;
      });
    },
    async composioUrl(r) {
      return included(r, async () => {
        if (!r.provider_attempt_id)
          throw new HttpError(409, "SIMPLE_NOT_READY");
        let v = await decode(
          await connectGetStatus(
            local("/api/mail/composio/connect"),
            r.provider_attempt_id,
          ),
          connectViewHttp,
        );
        if (v.status?.state === "prepared")
          v = await decode(
            await connectAction(
              local("/api/mail/composio/connect", {
                expected_revision: v.status.revision,
                idempotency_key: stepKey(r.id, "start"),
              }),
              r.provider_attempt_id,
              "start",
            ),
            connectViewHttp,
          );
        const response = await connectAction(
          local("/api/mail/composio/connect", undefined, true),
          r.provider_attempt_id,
          "resume",
        );
        const url = response.headers.get("location");
        if (response.status !== 303 || !url)
          throw new HttpError(409, "SIMPLE_NOT_READY");
        return url;
      });
    },
    async composioPrepare(r) {
      return included(r, async () => {
        if (!r.provider_attempt_id)
          throw new HttpError(409, "SIMPLE_NOT_READY");
        // Existing saved recovery/candidate skips its expired OAuth continuation.
        if (!r.identity_saved) {
          let v = await decode(
            await connectGetStatus(
              local("/api/mail/composio/connect"),
              r.provider_attempt_id,
            ),
            connectViewHttp,
          );
          if (v.status?.state === "awaiting_consent") return false;
          if (
            !v.status ||
            !["awaiting_brand", "ready_to_register", "completed"].includes(
              v.status.state,
            )
          )
            throw new HttpError(409, "SIMPLE_NOT_READY");
          await simpleRpc(db, "simple_mail_confirm", { id: r.id });
          if (v.pending)
            v = await decode(
              await connectAction(
                local("/api/mail/composio/connect", {
                  idempotency_key: stepKey(r.id, "adopt"),
                }),
                r.provider_attempt_id,
                "adopt",
              ),
              connectViewHttp,
            );
          if (v.status?.state === "ready_to_register")
            await decode(
              await connectAction(
                local("/api/mail/composio/connect", {
                  expected_revision: v.status.revision,
                  idempotency_key: stepKey(r.id, "register"),
                }),
                r.provider_attempt_id,
                "register",
              ),
              connectViewHttp,
            );
        } else await simpleRpc(db, "simple_mail_confirm", { id: r.id });
        const latest = privateConnection.parse(
          await simpleRpc(service, "simple_mail_private", { id: r.id }),
        );
        if (!latest.account_id) throw new HttpError(409, "SIMPLE_NOT_READY");
        const account = latest.account_id,
          p = bindingV2Ports(db);
        p.fetchImpl = (input, init) => includedComposioFetch(input, init);
        let page = await bindingPageV2(p, account, null, 1);
        if (!page.current || page.current.stale) {
          const candidate = z
            .strictObject({
              composio_project_id: z.string(),
              auth_config_id: z.string(),
              connected_account_id: z.string(),
              composio_user_id: z.string(),
            })
            .parse(
              await simpleRpc(service, "simple_mail_candidate", { id: r.id }),
            );
          await bindingCommandV2(p, account, {
            contract_version: 2,
            kind: "register_candidate",
            payload: { ...bindingExpected(page), ...candidate },
            idempotency_key: stepKey(
              r.id,
              "refresh-candidate:" + JSON.stringify(bindingExpected(page)),
            ),
          });
          page = await bindingPageV2(p, account, null, 1);
        }
        if (page.current?.status === "verified" && !page.current.stale)
          return true;
        const setup = {
          ...verificationSetupPorts(db),
          enabled: true,
          targetAccount: account,
          binding: p,
        };
        let prepared = await verificationSetupPage(setup, account);
        if (!prepared.policy.ready) {
          await verificationSetupCommand(setup, account, {
            action: "publish_policy",
            setup_revision: prepared.setup_revision,
            idempotency_key: stepKey(
              r.id,
              "policy:" + prepared.policy.expected_generation,
            ),
            expected_generation: prepared.policy.expected_generation,
            quiescent: true,
          });
          prepared = await verificationSetupPage(setup, account);
        }
        if (!prepared.verification_available) {
          await verificationSetupCommand(setup, account, {
            action: "grant_budget",
            setup_revision: prepared.setup_revision,
            idempotency_key: stepKey(r.id, "budget:" + prepared.setup_revision),
            binding_id: page.current?.id,
            included_confirmed: true,
            expires_at: new Date(Date.now() + 300000).toISOString(),
          });
        }
        if (!page.current) throw new HttpError(409, "SIMPLE_NOT_READY");
        if (!page.can_confirm && page.latest_check?.status === "prepared")
          throw new HttpError(409, "SIMPLE_NOT_READY");
        if (!page.can_confirm) {
          const checked = await bindingCheckV2(p, account, {
            contract_version: 2,
            binding_id: page.current.id,
            expected: bindingExpected(page),
            idempotency_key: stepKey(
              r.id,
              "check:" +
                JSON.stringify(bindingExpected(page)) +
                ":" +
                (page.latest_check?.id ?? "initial"),
            ),
          });
          if (checked.status !== "completed")
            throw new HttpError(409, "SIMPLE_PROVIDER_UNAVAILABLE");
          page = await bindingPageV2(p, account, null, 1);
        }
        if (!page.can_confirm || !page.latest_check)
          throw new HttpError(409, "SIMPLE_NOT_READY");
        await bindingCommandV2(p, account, {
          contract_version: 2,
          kind: "confirm_binding",
          payload: {
            ...bindingExpected(page),
            binding_id: page.current!.id,
            check_id: page.latest_check.id,
          },
          idempotency_key: stepKey(
            r.id,
            "confirm-binding:" + page.latest_check.id,
          ),
        });
        return true;
      });
    },
    async activate(r) {
      if (!r.account_id) throw new HttpError(409, "SIMPLE_NOT_READY");
      let review = await reviewTransportSelection(db, r.account_id, true);
      // A newly added Composio connection is backup when direct is already ready.
      const target =
        r.provider === "composio" && review.eligible_direct
          ? "gmail_oauth"
          : r.provider;
      if (
        review.current &&
        review.selection?.state === "ready" &&
        review.selection.provider === target
      )
        return;
      let kind:
        "bootstrap_direct" | "prepare_transition" | "commit_transition" =
        !review.selection && target === "gmail_oauth"
          ? "bootstrap_direct"
          : review.selection?.state === "draining"
            ? "commit_transition"
            : "prepare_transition";
      await commandTransportSelection(
        db,
        r.account_id,
        {
          kind,
          payload: { ...review.expected, target_provider: target },
          idempotency_key: stepKey(
            r.id,
            kind + ":" + JSON.stringify(review.expected) + ":" + target,
          ),
        },
        true,
      );
      if (kind === "prepare_transition") {
        review = await reviewTransportSelection(db, r.account_id, true);
        await commandTransportSelection(
          db,
          r.account_id,
          {
            kind: "commit_transition",
            payload: { ...review.expected, target_provider: target },
            idempotency_key: stepKey(
              r.id,
              "commit_transition:" +
                JSON.stringify(review.expected) +
                ":" +
                target,
            ),
          },
          true,
        );
      }
    },
  };
}

export async function simpleDirectCallback(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url),
    state = url.searchParams.get("state");
  if (!state) return null;
  const { db, profile } = await requireUser();
  const id = await simpleRpc(db, "simple_mail_callback_lookup", {
    digest: hash(state),
  });
  if (!id) return null;
  const allowed = new Set([
    "state",
    "code",
    "scope",
    "authuser",
    "prompt",
    "hd",
    "error",
    "error_description",
    "error_uri",
    "iss",
  ]);
  if (
    url.search.length > 16384 ||
    [...url.searchParams.keys()].some(
      (key) => !allowed.has(key) || url.searchParams.getAll(key).length !== 1,
    ) ||
    (url.searchParams.get("code")?.length ?? 0) > 4096
  )
    throw new HttpError(400, "SIMPLE_INVALID_INPUT");
  const ports = await productionOnboarding(request),
    api = createOnboarding(ports);
  const view = await api.get(z.uuid().parse(id));
  const destination = simpleMailReturnUrl(view.id);
  if (view.state === "ready" || view.state === "preparing") {
    return Response.redirect(destination, 303);
  }
  if (
    (await cookies()).get("simple_mail_state_" + view.id)?.value !== hash(state)
  )
    throw new HttpError(403, "SIMPLE_FORBIDDEN");
  if (!url.searchParams.get("code") || url.searchParams.has("error")) {
    await simpleRpc(db, "simple_mail_update", {
      id: view.id,
      error_code: "AUTHORIZATION_REQUIRED",
    });
    return Response.redirect(destination, 303);
  }
  const record = privateConnection.parse(
    await simpleRpc(ports.service, "simple_mail_private", { id: view.id }),
  );
  const org = simpleWorkspace();
  if (record.organization !== org.id || record.domain !== org.domain)
    throw new HttpError(409, "SIMPLE_CONFLICT");
  if (
    (await simpleRpc(db, "simple_mail_exchange_begin", { id: view.id })) !==
    true
  )
    return Response.redirect(destination, 303);
  try {
    const client = oauthClient(record.organization),
      { tokens } = await client.getToken({
        code: url.searchParams.get("code")!,
        codeVerifier: hash(record.encrypted_state),
      });
    const scopes = new Set((tokens.scope ?? "").split(/\s+/));
    if (
      !tokens.id_token ||
      !tokens.refresh_token ||
      !scopes.has("https://www.googleapis.com/auth/gmail.readonly") ||
      !scopes.has("https://www.googleapis.com/auth/gmail.send")
    )
      throw new HttpError(409, "SIMPLE_AUTHORIZATION_REQUIRED");
    const claims = (
      await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: org.clientId,
      })
    ).getPayload();
    if (
      !claims?.email_verified ||
      claims.hd !== record.domain ||
      claims.email?.toLowerCase() !== record.email
    )
      throw new HttpError(403, "SIMPLE_FORBIDDEN");
    await simpleRpc(ports.service, "simple_mail_direct_saved", {
      id: view.id,
      actor: profile.id,
      mailbox: record.email,
      encrypted_token: encrypt(tokens.refresh_token),
    });
    (await cookies()).delete("simple_mail_state_" + view.id);
  } catch {
    await simpleRpc(db, "simple_mail_update", {
      id: view.id,
      error_code: "AUTHORIZATION_REQUIRED",
    }).catch(() => {});
  }
  return Response.redirect(destination, 303);
}

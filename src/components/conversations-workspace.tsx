"use client";
import "./conversations-workspace.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mail,
  Users,
  UserRound,
  Landmark,
  Search,
  ArrowLeft,
  Info,
  Plus,
  SlidersHorizontal,
  ReplyAll,
  LoaderCircle,
  Check,
  Circle,
  RefreshCw,
} from "lucide-react";
import type { Message, Locale, Workspace, Opportunity } from "@/lib/domain";
import { dateLabel, canSeeOpportunity } from "@/lib/domain";
import type { Action } from "./crm";
import { t, Empty, Modal } from "./ui";
import { MailEditor } from "./mail-editor";
import { MailboxStatus, type MailboxState } from "./mailbox-status";
import { MailOrder } from "./mail-order";
import { MailClientPicker, type MailClientChoice } from "./mail-client-picker";
import { MailMessage, type MailVisibleFile } from "./mail-message";
import { MailSendStatus } from "./mail-composer";
import { MailBody } from "./mail-bubble";
import { forwardedBody, type MailDraft } from "@/lib/mail-manager";
import { suggestedReply } from "@/lib/mail-display";
import { lenderReplyRecipients, lenderEmailResolver } from "@/lib/lender-mail";
import {
  mailChatMessages,
  orderMailMessages,
  type MailDateOrder,
  type MailReplySend,
} from "@/lib/mail-chat";
import {
  summarizeThreads,
  filterThreads,
  elapsedMailTime,
  type MailChannels,
  type ThreadSummary,
  type ThreadCategory,
} from "@/lib/conversation-threads";

type Page = {
  messages: Message[];
  attachments: NonNullable<Workspace["attachments"]>;
  hasMore: boolean;
  files: MailVisibleFile[];
  sends?: MailReplySend[];
};
const empty: MailChannels = {
  conversations: [],
  processes: [],
  routes: [],
  lenders: [],
  lender_contacts: [],
  team_emails: [],
  client_emails: [],
};
const categoryNames: Record<ThreadCategory, [string, string]> = {
  client: ["Cliente", "Customer"],
  team: ["Equipo", "Team"],
  lender: ["Lenders", "Lenders"],
  review: ["Por clasificar", "Unclassified"],
};
type PendingMessage = Message & {
  subject: string;
  attachments?: { name: string; size: number }[];
};
type PendingPage = {
  messages: PendingMessage[];
  hasMore: boolean;
  cursor: { before: string; cursor: string } | null;
};

export function ConversationsWorkspace({
  data,
  locale,
  act,
  busy,
  openCase,
  opportunity,
  onAttachment,
}: {
  data: Workspace;
  locale: Locale;
  act: Action;
  busy: boolean;
  openCase: (id: string, scope?: Workspace) => void;
  opportunity?: Opportunity;
  onAttachment?: (
    attachment: NonNullable<Workspace["attachments"]>[number],
    message: Message,
    conversation: Workspace["conversations"][number],
    scope?: Workspace,
  ) => void;
}) {
  const initial = useMemo(
    () => data.opportunities.filter((o) => canSeeOpportunity(data.profile, o)),
    [data.opportunities, data.profile],
  );
  const [choice, setChoice] = useState<MailClientChoice | undefined>(
    opportunity || initial[0],
  );
  const caseId = choice?.id || "";
  const pendingMode = caseId === "unassigned";
  const [metadataState, setMetadataState] = useState<{
    id: string;
    value: MailChannels;
  }>({ id: "", value: empty });
  const metadata = metadataState.id === caseId ? metadataState.value : empty;
  const [scopedState, setScopedState] = useState<{
    id: string;
    value: Workspace;
  } | null>(null);
  const scoped = scopedState?.id === caseId ? scopedState.value : undefined;
  const [tab, setTab] = useState<"all" | ThreadCategory>("all"),
    [filter, setFilter] = useState<"all" | "unread" | "unassigned">("all");
  const [activeId, setActiveId] = useState("");
  const [process, setProcess] = useState("all"),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0),
    [error, setError] = useState("");
  const [loadingMeta, setLoadingMeta] = useState(false),
    [loadingMail, setLoadingMail] = useState(false);
  const [pages, setPages] = useState<Record<string, Page>>({});
  const [mailbox, setMailbox] = useState<MailboxState>({
    accounts: [],
    pending: [],
    drafts: [],
  });
  const [pendingPage, setPendingPage] = useState(0),
    [reviewToOpen, setReviewToOpen] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<{
    id: string;
    page: PendingPage;
  } | null>(null);
  const [readerVisible, setReaderVisible] = useState(false);
  const [dateOrder, setDateOrder] = useState<MailDateOrder>("newest");
  const [reply, setReply] = useState<Message | null>(null),
    [replyAll, setReplyAll] = useState(false),
    [replyEpoch, setReplyEpoch] = useState(0),
    [focusToken, setFocusToken] = useState(0);
  const [replyAccount, setReplyAccount] = useState("");
  const [queuedReplies, setQueuedReplies] = useState<MailReplySend[]>([]);
  const [editing, setEditing] = useState<MailDraft | null>(null),
    [originalThread, setOriginalThread] = useState<string | null>(null),
    [showSending, setShowSending] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null),
    sourceRef = useRef<HTMLDivElement>(null);
  const pageGeneration = useRef(0),
    loadedSource = useRef("");
  const selectedCase =
    metadata.context?.opportunity ||
    scoped?.opportunities.find((o) => o.id === caseId) ||
    initial.find((o) => o.id === caseId) ||
    opportunity;
  const effectiveData: Workspace = {
    ...data,
    ...(scoped || {}),
    lenders: [
      ...new Map(
        [
          ...data.lenders,
          ...metadata.lenders.map((l) => ({
            ...data.lenders.find((d) => d.id === l.id),
            ...l,
          })),
        ].map((l) => [l.id, l]),
      ).values(),
    ] as Workspace["lenders"],
    lender_contacts: metadata.lender_contacts.length
      ? metadata.lender_contacts
      : data.lender_contacts,
    opportunities: selectedCase
      ? [
          ...new Map(
            [selectedCase, ...data.opportunities].map((o) => [o.id, o]),
          ).values(),
        ]
      : data.opportunities,
    sender_account_ids:
      metadata.sender_account_ids ||
      data.sender_account_ids ||
      (data.demo
        ? data.accounts
            .filter(
              (a) =>
                a.status === "connected" || (data.demo && a.status === "demo"),
            )
            .map((a) => a.id)
        : []),
  };
  const managed = !!data.gmail_history_enabled && !data.demo;
  const bump = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(() => {
    if (opportunity?.id) setChoice(opportunity);
    else if (!choice && initial[0]) setChoice(initial[0]);
  }, [opportunity, initial, choice]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    setTab("all");
    setActiveId("");
    setProcess("all");
    setPages({});
    setQueuedReplies([]);
    setReply(null);
    setEditing(null);
    setOriginalThread(null);
    setReaderVisible(false);
    if (!pendingMode) setFilter("all");
  }, [caseId, pendingMode]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) bump();
    }, 60000);
    return () => clearInterval(timer);
  }, [bump]);
  useEffect(() => {
    if (!caseId || pendingMode) return;
    if (data.demo) {
      const o = initial.find((c) => c.id === caseId);
      if (!o) return;
      const conversations = data.conversations.filter(
        (c) => c.opportunity_id === caseId,
      );
      const submissions = data.submissions.filter(
        (s) => s.opportunity_id === caseId,
      );
      const channels: MailChannels = {
        ...empty,
        conversations,
        submissions,
        routes: conversations.flatMap((c) =>
          submissions
            .filter((s) => s.id === c.submission_id)
            .map((s) => ({ conversation_id: c.id, lender_id: s.lender_id })),
        ),
        lenders: data.lenders,
        lender_contacts:
          data.lender_contacts ||
          data.lenders.map((l) => ({ lender_id: l.id, email: l.email })),
        team_emails: [
          ...data.accounts.map((a) => a.email),
          ...data.profiles.map((p) => p.email),
        ],
        client_emails: [o.email],
        sender_account_ids: data.accounts
          .filter(
            (a) =>
              a.status === "connected" || (data.demo && a.status === "demo"),
          )
          .map((a) => a.id),
      };
      const messages = data.messages.filter((m) =>
        conversations.some((c) => c.id === m.conversation_id),
      );
      channels.thread_summaries = summarizeThreads(channels, messages);
      const required = data.documents.filter(
        (d) => d.opportunity_id === caseId && d.required !== false,
      );
      const approved = required.filter((d) => d.status === "approved");
      const customer = orderMailMessages(
        messages.filter(
          (m) => m.direction === "inbound" && m.sender === o.email,
        ),
      )[0];
      channels.context = {
        opportunity: o,
        client_emails: [o.email],
        last_client_message_at: customer?.sent_at || null,
        documents: {
          required: required.length,
          approved: approved.length,
          ready: !!required.length && required.length === approved.length,
        },
        followup: o.next_action
          ? { title: o.next_action, at: o.next_action_at }
          : null,
      };
      setMetadataState({ id: caseId, value: channels });
      return;
    }
    const controller = new AbortController();
    setLoadingMeta(true);
    setError("");
    fetch(
      `/api/conversations/channels?${new URLSearchParams({ case: caseId, q: search })}`,
      { signal: controller.signal },
    )
      .then(async (r) => {
        const p = await r.json();
        if (!r.ok) throw Error(p.error);
        if (!controller.signal.aborted)
          setMetadataState({ id: caseId, value: p });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMeta(false);
      });
    return () => controller.abort();
  }, [
    caseId,
    pendingMode,
    revision,
    search,
    data.demo,
    data.messages,
    data.conversations,
    initial,
  ]);
  useEffect(() => {
    if (!caseId || pendingMode || data.demo) return;
    const controller = new AbortController();
    fetch(`/api/workspace?${new URLSearchParams({ case: caseId })}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const p = await r.json();
        if (!r.ok) throw Error(p.error);
        if (!controller.signal.aborted)
          setScopedState({ id: caseId, value: p });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [caseId, pendingMode, data.demo, revision]);

  const summaries = useMemo(
    () =>
      metadata.thread_summaries ||
      summarizeThreads(
        metadata,
        Object.values(pages).flatMap((p) => p.messages),
      ),
    [metadata, pages],
  );
  const processPool = summaries.filter(
    (s) =>
      process === "all" ||
      (s.process_id !== undefined
        ? (s.process_id || "") === process
        : s.conversation_ids.some(
            (id) =>
              (metadata.conversations.find((c) => c.id === id)?.process_id ||
                "") === process,
          )),
  );
  const pendingThreads: ThreadSummary[] = mailbox.pending.map((p) => {
    const emails = p.participants.map((a) => a.email.toLowerCase());
    const sender = p.participants.find((a) => a.role === "from")?.email || "";
    const lenderIds = [
      ...new Set(
        (data.lender_contacts || [])
          .filter((l) => emails.includes(l.email))
          .map((l) => l.lender_id),
      ),
    ];
    const team = [
      ...data.accounts.map((a) => a.email),
      ...data.profiles.map((a) => a.email),
    ].map((e) => e.toLowerCase());
    return {
      id: p.review_id,
      conversation_ids: [],
      opportunity_id: "",
      subject: p.subject,
      sender,
      snippet: t(
        locale,
        "Pendiente de asociación al expediente",
        "Awaiting case association",
      ),
      sent_at: p.sent_at,
      category: lenderIds.length
        ? "lender"
        : emails.length && emails.every((e) => team.includes(e))
          ? "team"
          : "review",
      lender_ids: lenderIds,
      participants: p.participants,
      unread: false,
    };
  });
  const pool = pendingMode ? pendingThreads : processPool;
  const visibleThreads = filterThreads(pool, tab, filter === "unread", search);
  const active =
    visibleThreads.find(
      (s) => s.id === activeId || s.conversation_ids.includes(activeId),
    ) || visibleThreads[0];
  const activeKey = `${caseId}:${active && (active.id === activeId || active.conversation_ids.includes(activeId)) ? activeId : active?.id || ""}`;
  useEffect(() => {
    if (active && !activeId) setActiveId(active.id);
  }, [active?.id, activeId]);
  const activeCoIds = active?.conversation_ids.join(",") || "";
  const activeMessageIds = active?.message_ids?.join(",") || "";
  useEffect(() => {
    setReply(null);
    setReplyAll(false);
    setReplyAccount("");
    setFocusToken(0);
    if (historyRef.current) historyRef.current.scrollTop = 0;
  }, [activeKey]);
  useEffect(() => {
    if (historyRef.current) historyRef.current.scrollTop = 0;
    if (sourceRef.current) sourceRef.current.scrollTop = 0;
  }, [dateOrder]);
  useEffect(() => {
    if (pendingMode || !activeCoIds) {
      setPages({});
      return;
    }
    const ids = activeCoIds.split(",");
    if (data.demo) {
      setPages(
        Object.fromEntries(
          ids.map((id) => [
            id,
            {
              messages: orderMailMessages(
                data.messages.filter((m) => m.conversation_id === id),
                "oldest",
              ),
              attachments: (data.attachments || []).filter((a) =>
                data.messages.some(
                  (m) => m.id === a.message_id && m.conversation_id === id,
                ),
              ),
              files: [],
              hasMore: false,
            },
          ]),
        ),
      );
      return;
    }
    const controller = new AbortController();
    const current = ++pageGeneration.current;
    setLoadingMail(true);
    setError("");
    Promise.all(
      ids.map(async (id) => {
        const selected = active?.message_ids?.filter(
          (mid) => active.message_conversations?.[mid] === id,
        );
        const r = await fetch(
          `/api/conversations/${id}/messages${selected ? `?${new URLSearchParams({ ids: selected.slice(0, 100).join(",") })}` : ""}`,
          {
            signal: controller.signal,
          },
        );
        const p = await r.json();
        if (!r.ok) throw Error(p.error);
        return [
          id,
          {
            ...p,
            hasMore: selected ? selected.length > p.messages.length : p.hasMore,
          } as Page,
        ] as const;
      }),
    )
      .then((rows) => {
        if (controller.signal.aborted || current !== pageGeneration.current)
          return;
        const preserve = loadedSource.current === activeKey;
        setPages((old) =>
          Object.fromEntries(
            rows.map(([id, page]) => {
              const previous = preserve ? old[id] : undefined;
              if (
                !previous ||
                !page.messages.some((m) =>
                  previous.messages.some((n) => n.id === m.id),
                )
              )
                return [id, page];
              return [
                id,
                {
                  ...page,
                  hasMore: active?.message_ids
                    ? active.message_ids.some(
                        (mid) =>
                          active.message_conversations?.[mid] === id &&
                          ![...previous.messages, ...page.messages].some(
                            (m) => m.id === mid,
                          ),
                      )
                    : previous.hasMore,
                  messages: orderMailMessages(
                    [
                      ...new Map(
                        [...previous.messages, ...page.messages].map((m) => [
                          m.id,
                          m,
                        ]),
                      ).values(),
                    ],
                    "oldest",
                  ),
                  files: [
                    ...new Map(
                      [...(previous.files || []), ...(page.files || [])].map(
                        (f) => [`${f.message_id}:${f.id}`, f],
                      ),
                    ).values(),
                  ],
                  attachments: [
                    ...new Map(
                      [...previous.attachments, ...page.attachments].map(
                        (f) => [f.id, f],
                      ),
                    ).values(),
                  ],
                },
              ];
            }),
          ),
        );
        loadedSource.current = activeKey;
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMail(false);
      });
    return () => controller.abort();
  }, [
    activeCoIds,
    activeMessageIds,
    activeKey,
    pendingMode,
    revision,
    data.demo,
    data.messages,
    data.attachments,
  ]);
  useEffect(() => {
    if (!pendingMode || !active) return;
    const controller = new AbortController();
    setLoadingMail(true);
    setError("");
    fetch(`/api/mail/review/${active.id}?thread=true`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const p = await r.json();
        if (!r.ok) throw Error(p.error);
        if (!controller.signal.aborted)
          setPendingPreview({ id: active.id, page: p });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMail(false);
      });
    return () => controller.abort();
  }, [pendingMode, active?.id, revision]);
  const sends = [
    ...new Map(
      [
        ...queuedReplies,
        ...Object.values(pages).flatMap((p) => p.sends || []),
      ].map((s) => [s.id, s]),
    ).values(),
  ];
  const awaiting = sends.some((s) => ["queued", "sending"].includes(s.status));
  useEffect(() => {
    if (!awaiting) return;
    const timer = setInterval(() => {
      if (!document.hidden) bump();
    }, 5000);
    return () => clearInterval(timer);
  }, [awaiting, bump]);
  const seen = new Set<string>();
  const rawMessages = Object.values(pages)
    .flatMap((p) => p.messages)
    .filter((m) => active?.conversation_ids.includes(m.conversation_id))
    .filter((m) => !active?.message_ids || active.message_ids.includes(m.id))
    .filter((m) => {
      const key = m.internet_message_id || m.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const messages = mailChatMessages(
    rawMessages,
    sends.filter(
      (s) =>
        active?.conversation_ids.includes(s.conversation_id) &&
        (!active?.message_ids ||
          active.message_ids.includes(s.reply_message_id)) &&
        (active?.category !== "lender" ||
          lenderEmailResolver(metadata)(s.to_email) === active.lender_ids[0]),
    ),
    effectiveData.accounts,
  );
  const latestReply =
    [...messages]
      .reverse()
      .find((m) => !m.queued_send && m.direction === "inbound") ||
    [...messages].reverse().find((m) => !m.queued_send);
  useEffect(() => {
    if (!reply && latestReply && !pendingMode) setReply(latestReply);
  }, [reply, latestReply?.id, pendingMode, activeKey, replyEpoch]);
  const co = metadata.conversations.find(
    (c) => c.id === reply?.conversation_id,
  );
  const own = [
    effectiveData.accounts.find(
      (a) => a.id === (replyAccount || co?.account_id),
    )?.email || "",
    ...(reply?.direction === "outbound" ? [reply.sender] : []),
  ];
  const replyRecipients = reply
    ? active?.category === "lender"
      ? lenderReplyRecipients(reply, active.lender_ids[0], metadata, own[0])
      : suggestedReply(reply.participants || [], reply.sender, own)
    : { to: "", cc: [] };
  if (reply && !replyRecipients.to && active?.category !== "lender")
    replyRecipients.to =
      co?.recipient_email ||
      (active?.category === "client" ? selectedCase?.email || "" : "");
  if (!managed && !data.demo && active?.category !== "lender") {
    const submission = effectiveData.submissions.find(
      (s) => s.id === co?.submission_id,
    );
    replyRecipients.to =
      (co?.area === "closer"
        ? effectiveData.lenders.find((l) => l.id === submission?.lender_id)
            ?.email
        : "") ||
      selectedCase?.email ||
      "";
    replyRecipients.cc = [];
  }
  const files = [
    ...new Map(
      Object.values(pages)
        .flatMap((p) => p.files || [])
        .map((f) => [f.id, f]),
    ).values(),
  ];
  const legacyAttachments = [
    ...new Map(
      Object.values(pages)
        .flatMap((p) => p.attachments || [])
        .map((a) => [a.id, a]),
    ).values(),
  ];
  function chooseReply(m: Message, all = false) {
    if (m.id !== reply?.id) setReplyAccount("");
    setReply(m);
    setReplyAll(all);
    setFocusToken((n) => n + 1);
  }
  function forward(m: Message) {
    const c = metadata.conversations.find((c) => c.id === m.conversation_id);
    setEditing({
      mode: "forward",
      opportunity_id: caseId,
      account_id: c?.account_id,
      process_id: c?.process_id,
      forward_message_id: m.id,
      forward_file_ids: files
        .filter((f) => f.message_id === m.id)
        .map((f) => f.id),
      to_email: "",
      subject: `Fwd: ${c?.subject || ""}`.slice(0, 200),
      body: forwardedBody(
        m.sender,
        dateLabel(m.sent_at, locale, true),
        c?.subject || "",
        m.body,
      ),
    });
  }
  async function older() {
    setLoadingMail(true);
    setError("");
    const current = pageGeneration.current;
    try {
      if (pendingMode) {
        const page = pendingPreview?.page;
        if (!page?.cursor || !active) return;
        const r = await fetch(
          `/api/mail/review/${active.id}?${new URLSearchParams({ thread: "true", ...page.cursor })}`,
        );
        const p = await r.json();
        if (!r.ok) throw Error(p.error);
        setPendingPreview({
          id: active.id,
          page: {
            ...p,
            messages: [
              ...new Map(
                [...page.messages, ...p.messages].map((m) => [m.id, m]),
              ).values(),
            ],
          },
        });
      } else {
        const additions = await Promise.all(
          (active?.conversation_ids || [])
            .filter((id) => pages[id]?.hasMore)
            .map(async (id) => {
              const first = orderMailMessages(pages[id].messages, "oldest")[0];
              const remaining = active?.message_ids?.filter(
                (mid) =>
                  active.message_conversations?.[mid] === id &&
                  !pages[id].messages.some((m) => m.id === mid),
              );
              const r = await fetch(
                `/api/conversations/${id}/messages?${new URLSearchParams(remaining ? { ids: remaining.slice(0, 100).join(",") } : { before: first.sent_at, cursor: first.id })}`,
              );
              const p = await r.json();
              if (!r.ok) throw Error(p.error);
              return [
                id,
                {
                  ...p,
                  hasMore: remaining
                    ? remaining.length > p.messages.length
                    : p.hasMore,
                  messages: [
                    ...new Map(
                      [...p.messages, ...pages[id].messages].map(
                        (m: Message) => [m.id, m],
                      ),
                    ).values(),
                  ],
                  files: [...(p.files || []), ...(pages[id].files || [])],
                  attachments: [...p.attachments, ...pages[id].attachments],
                },
              ] as const;
            }),
        );
        if (current === pageGeneration.current)
          setPages((old) => ({ ...old, ...Object.fromEntries(additions) }));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMail(false);
    }
  }
  const customerContext = metadata.context;
  const lenderCount = summaries.filter((s) => s.category === "lender").length;
  const followupReady =
    !!customerContext?.followup?.at &&
    Date.parse(customerContext.followup.at) >= Date.now();
  const displayedPending =
    pendingPreview && pendingPreview.id === active?.id
      ? pendingPreview.page
      : null;
  const displayed = orderMailMessages(
    pendingMode ? displayedPending?.messages || [] : messages,
    dateOrder,
  );
  const hasMore = pendingMode
    ? displayedPending?.hasMore
    : Object.values(pages).some((p) => p.hasMore);
  const tabs: {
    id: "all" | ThreadCategory;
    name: string;
    icon: typeof Mail;
  }[] = [
    { id: "all", name: t(locale, "Todos", "All"), icon: Mail },
    { id: "client", name: t(locale, "Cliente", "Customer"), icon: UserRound },
    { id: "team", name: t(locale, "Equipo", "Team"), icon: Users },
    { id: "lender", name: "Lenders", icon: Landmark },
  ];
  return (
    <section
      className={`conversations-workspace ${opportunity ? "embedded" : ""}`}
      aria-label={t(locale, "Conversaciones", "Conversations")}
    >
      <div className="cw-top-strip">
        {!data.demo && (
          <MailboxStatus
            compact
            data={effectiveData}
            locale={locale}
            caseId={!pendingMode && caseId ? caseId : undefined}
            onChanged={bump}
            onDraft={setEditing}
            onState={setMailbox}
            pendingPage={pendingPage}
            onPendingPageChange={setPendingPage}
            reviewToOpen={reviewToOpen}
            onReviewClosed={() => setReviewToOpen(null)}
            onPendingSelect={() => {
              setChoice({
                id: "unassigned",
                contact: t(locale, "Sin asociar", "Unassociated"),
                company: t(locale, "Correos pendientes", "Pending mail"),
                email: "",
              });
              setFilter("unassigned");
            }}
          />
        )}
        {data.demo && (
          <span className="cw-demo-note">
            {t(
              locale,
              "Demostración · datos ficticios, sin envío real",
              "Demo · fictional data, no real sending",
            )}
          </span>
        )}
        <button
          className="cw-new-mail"
          type="button"
          disabled={!managed || pendingMode || !selectedCase}
          onClick={() =>
            setEditing({ mode: "compose", opportunity_id: caseId })
          }
        >
          <Plus size={14} />
          {t(locale, "Nuevo correo", "New email")}
        </button>
        <button
          className="cw-icon"
          type="button"
          aria-label={t(locale, "Estado de envíos", "Sending status")}
          onClick={() => setShowSending(true)}
        >
          <Info size={14} />
        </button>
      </div>
      <div className="cw-client-toolbar">
        <span className="cw-toolbar-label">
          {t(locale, "Cliente", "Customer")}
        </span>
        <MailClientPicker
          selected={choice}
          initial={initial}
          locale={locale}
          demo={data.demo}
          locked={!!opportunity}
          onSelect={setChoice}
        />
        <div className="cw-client-summary">
          <div className="cw-meta">
            <small>
              {t(locale, "Último mensaje del cliente", "Last customer message")}
            </small>
            <strong>
              {pendingMode
                ? "—"
                : elapsedMailTime(
                    customerContext?.last_client_message_at,
                    locale,
                  )}
            </strong>
          </div>
          <div
            className="cw-followup-progress"
            title={t(
              locale,
              "El CRM no tiene un porcentaje oficial de seguimiento. No se calcula una puntuación comercial.",
              "The CRM has no defined follow-up percentage. No commercial score is calculated.",
            )}
          >
            <span>
              {t(locale, "Seguimiento", "Follow-up")}
              <b>{t(locale, "No definido", "Not defined")}</b>
            </span>
            <div aria-hidden="true" />
          </div>
          <div className="cw-meta cw-lender-stat">
            <small>
              {t(locale, "Conv. con lenders", "Lender conversations")}
            </small>
            <strong>{pendingMode ? "—" : lenderCount}</strong>
          </div>
          <div className="cw-checks">
            {[
              [
                "Docs",
                !!customerContext?.documents.ready,
                customerContext
                  ? `${customerContext.documents.approved}/${customerContext.documents.required} ${t(locale, "documentos requeridos aprobados", "required documents approved")}`
                  : t(
                      locale,
                      "Sin checklist disponible",
                      "No available checklist",
                    ),
              ],
              [
                t(locale, "Seguimiento", "Follow-up"),
                followupReady,
                customerContext?.followup
                  ? `${customerContext.followup.title} · ${dateLabel(customerContext.followup.at, locale, true)}`
                  : t(
                      locale,
                      "Sin próxima acción registrada",
                      "No next action recorded",
                    ),
              ],
              [
                "Lenders",
                (metadata.stats?.lenders_contacted || 0) > 0,
                t(
                  locale,
                  "Contactados mediante correos enviados registrados",
                  "Contacted through recorded outgoing emails",
                ),
              ],
            ].map(([label, ok, hint]) => (
              <span
                key={String(label)}
                className={ok ? "ok" : ""}
                title={String(hint)}
              >
                {ok ? <Check size={11} /> : <Circle size={10} />}
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className={`cw-area ${readerVisible ? "reader-visible" : ""}`}>
        <aside
          className="cw-thread-list"
          aria-label={t(
            locale,
            "Bandeja de conversaciones",
            "Conversation inbox",
          )}
        >
          <div
            className="cw-tabs"
            role="tablist"
            aria-label={t(
              locale,
              "Categorías de conversaciones",
              "Conversation categories",
            )}
          >
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={tab === item.id ? "active" : ""}
                onClick={() => {
                  setTab(item.id);
                  setReaderVisible(false);
                }}
              >
                <item.icon size={13} />
                {item.name}
                {["team", "lender"].includes(item.id) && (
                  <span className="cw-tab-count">
                    {pool.filter((s) => s.category === item.id).length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="cw-thread-filters">
            {(
              [
                ["all", "Todos", "All"],
                ["unread", "Sin leer", "Unread"],
                ["unassigned", "Sin asociar", "Unassociated"],
              ] as const
            ).map(([id, es, en]) => (
              <button
                key={id}
                type="button"
                className={filter === id ? "active" : ""}
                title={
                  id === "unread"
                    ? t(
                        locale,
                        "Pendientes de atención en el CRM; no cambia el estado en Gmail",
                        "Awaiting attention in CRM; Gmail read state is unchanged",
                      )
                    : undefined
                }
                onClick={() => {
                  setFilter(id);
                  setReaderVisible(false);
                  if (id === "unassigned")
                    setChoice({
                      id: "unassigned",
                      contact: t(locale, "Sin asociar", "Unassociated"),
                      company: t(locale, "Correos pendientes", "Pending mail"),
                      email: "",
                    });
                }}
              >
                {t(locale, es, en)}
              </button>
            ))}
            <span>
              {visibleThreads.length} {t(locale, "hilos", "threads")}
            </span>
          </div>
          <div className="cw-thread-search">
            <Search size={13} />
            <input
              aria-label={t(
                locale,
                "Buscar en correos del cliente",
                "Search customer emails",
              )}
              placeholder={t(locale, "Buscar en correos…", "Search emails…")}
              value={query}
              maxLength={150}
              onChange={(e) => setQuery(e.target.value)}
            />
            <details className="cw-extra-filters">
              <summary
                aria-label={t(
                  locale,
                  "Filtrar por proceso",
                  "Filter by process",
                )}
              >
                <SlidersHorizontal size={14} />
              </summary>
              <label>
                {t(locale, "Proceso de financiación", "Financing process")}
                <select
                  value={process}
                  onChange={(e) => setProcess(e.target.value)}
                >
                  <option value="all">
                    {t(locale, "Todos los procesos", "All processes")}
                  </option>
                  <option value="">
                    {t(locale, "Sin proceso", "No process")}
                  </option>
                  {metadata.processes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </details>
          </div>
          <div className="cw-thread-items">
            {loadingMeta && (
              <p className="cw-small-status" role="status">
                <LoaderCircle size={13} className="spin" />
                {t(locale, "Cargando hilos…", "Loading threads…")}
              </p>
            )}
            {visibleThreads.map((s) => (
              <button
                className={`cw-thread ${s.id === active?.id ? "active" : ""} ${s.unread ? "unread" : ""}`}
                key={s.id}
                type="button"
                aria-pressed={s.id === active?.id}
                onClick={() => {
                  setActiveId(s.id);
                  setReaderVisible(true);
                }}
              >
                <span className="cw-thread-row">
                  <strong>
                    {s.category === "lender"
                      ? s.lender_ids
                          .map(
                            (id) =>
                              metadata.lenders.find((l) => l.id === id)?.name ||
                              data.lenders.find((l) => l.id === id)?.name,
                          )
                          .filter(Boolean)
                          .join(" · ") || s.sender
                      : s.sender || t(locale, "Sin remitente", "No sender")}
                  </strong>
                  <time dateTime={s.sent_at}>
                    {elapsedMailTime(s.sent_at, locale)}
                  </time>
                </span>
                <b className="cw-thread-subject">
                  {s.subject || t(locale, "Sin asunto", "No subject")}
                </b>
                <span className="cw-thread-snippet">
                  {s.snippet ||
                    t(locale, "Abrir conversación", "Open conversation")}
                </span>
                <span className="cw-thread-tags">
                  <span>{t(locale, ...categoryNames[s.category])}</span>
                  <span>
                    {pendingMode
                      ? t(locale, "Sin asociar", "Unassociated")
                      : `#${caseId.slice(0, 8)}`}
                  </span>
                </span>
              </button>
            ))}
            {!loadingMeta && !visibleThreads.length && (
              <Empty
                title={t(locale, "Sin conversaciones", "No conversations")}
                body={t(
                  locale,
                  "Selecciona un cliente o cambia los filtros.",
                  "Select a customer or change the filters.",
                )}
              />
            )}
          </div>
          {pendingMode && (
            <div className="cw-pending-pages">
              <span>
                {mailbox.pending_total || 0}{" "}
                {t(locale, "pendientes", "pending")}
              </span>
              <button
                type="button"
                disabled={!pendingPage}
                onClick={() => setPendingPage((p) => p - 1)}
              >
                {t(locale, "Anterior", "Previous")}
              </button>
              <button
                type="button"
                disabled={
                  (pendingPage + 1) * 50 >= (mailbox.pending_total || 0)
                }
                onClick={() => setPendingPage((p) => p + 1)}
              >
                {t(locale, "Siguiente", "Next")}
              </button>
            </div>
          )}
        </aside>
        <section
          className="cw-reader"
          aria-label={t(
            locale,
            "Detalle de la conversación",
            "Conversation detail",
          )}
        >
          <header className="cw-reader-top">
            <div>
              <button
                className="cw-mobile-back"
                type="button"
                onClick={() => setReaderVisible(false)}
              >
                <ArrowLeft size={13} />
                {t(locale, "Volver", "Back")}
              </button>
              <h2>
                {(active?.category === "lender"
                  ? `${metadata.lenders.find((l) => l.id === active.lender_ids[0])?.name || "Lender"} · ${active.subject}`
                  : active?.subject) ||
                  t(
                    locale,
                    "Selecciona una conversación",
                    "Select a conversation",
                  )}
              </h2>
              <p title={active?.participants.map((p) => p.email).join(", ")}>
                {active
                  ? [...new Set(active.participants.map((p) => p.email))].join(
                      " · ",
                    )
                  : t(
                      locale,
                      "Los mensajes del hilo aparecerán aquí.",
                      "Thread messages appear here.",
                    )}
              </p>
            </div>
            <div className="cw-reader-actions">
              <MailOrder
                locale={locale}
                value={dateOrder}
                onChange={setDateOrder}
              />
              {active && (
                <button
                  className="cw-icon"
                  type="button"
                  aria-label={t(
                    locale,
                    "Información original del hilo",
                    "Original thread information",
                  )}
                  onClick={() =>
                    pendingMode
                      ? setReviewToOpen(active.id)
                      : setOriginalThread(active.conversation_ids[0])
                  }
                >
                  <Info size={14} />
                </button>
              )}
            </div>
          </header>
          <div className="cw-context">
            <span>
              <b>{t(locale, "Cliente", "Customer")}:</b>{" "}
              {pendingMode
                ? t(locale, "Sin asociar", "Unassociated")
                : selectedCase?.contact || choice?.contact || "—"}
            </span>
            <span>
              <b>{t(locale, "Empresa", "Company")}:</b>{" "}
              {pendingMode
                ? "—"
                : selectedCase?.company || choice?.company || "—"}
            </span>
            {!pendingMode && selectedCase && (
              <button
                className="cw-link"
                type="button"
                title={caseId}
                onClick={() => openCase(caseId, scoped)}
              >
                {t(locale, "Ver expediente", "View case")} #{caseId.slice(0, 8)}
              </button>
            )}
            {pendingMode && active && (
              <button
                className="cw-link"
                type="button"
                onClick={() => setReviewToOpen(active.id)}
              >
                {t(locale, "Asociar hilo", "Associate thread")}
              </button>
            )}
          </div>
          {error && (
            <div className="cw-inline-error" role="alert">
              {error}
              <button className="cw-link" type="button" onClick={bump}>
                <RefreshCw size={12} />
                {t(locale, "Reintentar", "Retry")}
              </button>
            </div>
          )}
          <div
            className="cw-messages"
            ref={historyRef}
            tabIndex={0}
            role="region"
            aria-label={t(
              locale,
              "Historial de la conversación",
              "Conversation history",
            )}
          >
            {loadingMail && (
              <p className="cw-small-status" role="status">
                <LoaderCircle size={13} className="spin" />
                {t(locale, "Cargando mensajes…", "Loading messages…")}
              </p>
            )}
            {hasMore && dateOrder === "oldest" && (
              <button
                className="cw-history-more"
                type="button"
                disabled={loadingMail}
                onClick={() => void older()}
              >
                {t(
                  locale,
                  "Cargar mensajes anteriores",
                  "Load earlier messages",
                )}
              </button>
            )}
            {displayed.map((m) =>
              pendingMode ? (
                <article className="cw-message incoming" key={m.id}>
                  <div className="cw-message-bubble">
                    <div className="cw-message-meta">
                      <strong>{m.sender}</strong>
                      <time>{dateLabel(m.sent_at, locale, true)}</time>
                    </div>
                    <MailBody body={m.body} locale={locale} />
                    {(m as PendingMessage).attachments?.map((f) => (
                      <small className="cw-message-address" key={f.name}>
                        {f.name} ·{" "}
                        {t(
                          locale,
                          "Asocia el hilo para guardar los adjuntos",
                          "Associate the thread to save attachments",
                        )}
                      </small>
                    ))}
                  </div>
                </article>
              ) : (
                <MailMessage
                  canReplyAll={active?.category === "lender"}
                  key={m.id}
                  message={m}
                  data={effectiveData}
                  locale={locale}
                  teamEmails={metadata.team_emails}
                  files={files.filter((f) => f.message_id === m.id)}
                  legacyAttachments={legacyAttachments.filter(
                    (a) => a.message_id === m.id,
                  )}
                  onAttachment={
                    onAttachment
                      ? (a, message) => {
                          const parent = metadata.conversations.find(
                            (c) => c.id === message.conversation_id,
                          );
                          if (parent) onAttachment(a, message, parent, scoped);
                        }
                      : undefined
                  }
                  onReply={chooseReply}
                  onForward={forward}
                  onOriginal={(message) =>
                    setOriginalThread(message.conversation_id)
                  }
                />
              ),
            )}
            {hasMore && dateOrder === "newest" && (
              <button
                className="cw-history-more"
                type="button"
                disabled={loadingMail}
                onClick={() => void older()}
              >
                {t(
                  locale,
                  "Cargar mensajes anteriores",
                  "Load earlier messages",
                )}
              </button>
            )}
            {!loadingMail && !displayed.length && (
              <Empty
                title={
                  active
                    ? t(
                        locale,
                        "Todavía no hay mensajes cargados",
                        "No messages loaded yet",
                      )
                    : t(locale, "Selecciona un hilo", "Select a thread")
                }
                body={t(
                  locale,
                  "Conservamos la relación con el correo y su expediente.",
                  "Email and case relationships are preserved.",
                )}
              />
            )}
          </div>
          <div className="cw-reply-dock">
            {reply &&
            co &&
            active?.conversation_ids.includes(reply.conversation_id) &&
            !pendingMode &&
            selectedCase ? (
              <>
                <div className="cw-reply-heading">
                  <span>
                    {t(locale, "Responder a", "Reply to")}{" "}
                    <b>{replyRecipients.to || reply.sender}</b>
                  </span>
                  <button
                    className={`cw-link ${replyAll ? "active" : ""}`}
                    type="button"
                    disabled={!managed && active.category !== "lender"}
                    onClick={() => setReplyAll(!replyAll)}
                  >
                    <ReplyAll size={12} />
                    {t(locale, "Responder a todos", "Reply all")}
                  </button>
                </div>
                <MailEditor
                  key={`${activeKey}:${reply.id}:${replyEpoch}`}
                  compact
                  inline
                  focusToken={focusToken}
                  onAccountChange={setReplyAccount}
                  data={effectiveData}
                  locale={locale}
                  act={act}
                  busy={busy}
                  opportunity={selectedCase}
                  close={() => {
                    setReplyEpoch((e) => e + 1);
                    bump();
                  }}
                  onQueued={(mail, id) => {
                    if (id)
                      setQueuedReplies((old) => [
                        ...old,
                        {
                          id,
                          conversation_id: reply.conversation_id,
                          reply_message_id: reply.id,
                          account_id: mail.account_id!,
                          to_email: mail.to_email!,
                          cc_emails: mail.cc_emails || [],
                          subject: mail.subject!,
                          body: mail.body!,
                          status: "queued",
                          message_id_header: "",
                          created_at: new Date().toISOString(),
                        },
                      ]);
                  }}
                  start={{
                    mode: "reply",
                    opportunity_id: caseId,
                    conversation_id: reply.conversation_id,
                    reply_message_id: reply.id,
                    account_id: co?.account_id,
                    process_id: co?.process_id,
                    lender_id:
                      active.category === "lender"
                        ? active.lender_ids[0]
                        : undefined,
                    submission_id:
                      active.category === "lender"
                        ? metadata.submissions?.find(
                            (s) =>
                              s.lender_id === active.lender_ids[0] &&
                              s.process_id === co?.process_id,
                          )?.id
                        : co?.submission_id || undefined,
                    subject: co?.subject,
                    to_email: replyRecipients.to,
                    cc_emails: replyAll ? replyRecipients.cc : [],
                  }}
                />
              </>
            ) : (
              <p>
                {pendingMode
                  ? t(
                      locale,
                      "Asocia este hilo a un expediente para poder responder.",
                      "Associate this thread with a case before replying.",
                    )
                  : t(
                      locale,
                      "Selecciona una conversación para responder.",
                      "Select a conversation to reply.",
                    )}
              </p>
            )}
          </div>
        </section>
      </div>
      {editing && (
        <MailEditor
          data={effectiveData}
          locale={locale}
          act={act}
          busy={busy}
          start={editing}
          opportunity={selectedCase}
          close={() => {
            setEditing(null);
            bump();
          }}
        />
      )}
      {showSending && (
        <Modal
          title={t(locale, "Estado de envíos", "Sending status")}
          close={() => setShowSending(false)}
        >
          <MailSendStatus
            data={effectiveData}
            locale={locale}
            caseId={!pendingMode ? caseId : undefined}
          />
          {!(effectiveData.mail_sends || []).length && (
            <p>
              {t(locale, "Sin envíos en esta página", "No sends on this page")}
            </p>
          )}
        </Modal>
      )}
      {originalThread && (
        <Modal
          title={
            metadata.conversations.find((c) => c.id === originalThread)
              ?.subject || t(locale, "Hilo original", "Original thread")
          }
          close={() => setOriginalThread(null)}
        >
          <p>
            {
              effectiveData.accounts.find(
                (a) =>
                  a.id ===
                  metadata.conversations.find((c) => c.id === originalThread)
                    ?.account_id,
              )?.email
            }
          </p>
          <MailOrder
            locale={locale}
            value={dateOrder}
            onChange={setDateOrder}
          />
          {pages[originalThread]?.hasMore && (
            <button
              className="button"
              type="button"
              disabled={loadingMail}
              onClick={() => void older()}
            >
              {t(locale, "Cargar anteriores", "Load earlier messages")}
            </button>
          )}
          <div
            className="source-chat"
            ref={sourceRef}
            tabIndex={0}
            role="region"
            aria-label={t(
              locale,
              "Historial del hilo original",
              "Original thread history",
            )}
          >
            {orderMailMessages(
              pages[originalThread]?.messages || [],
              dateOrder,
            ).map((m) => (
              <article className="document-row" key={m.id}>
                <div>
                  <strong>{m.sender}</strong>
                  <small>{dateLabel(m.sent_at, locale, true)}</small>
                  <MailBody body={m.body} locale={locale} />
                </div>
              </article>
            ))}
          </div>
        </Modal>
      )}
    </section>
  );
}

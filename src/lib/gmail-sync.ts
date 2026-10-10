export function gmailSyncMode(): "polling" | "pubsub" {
  // Preserve existing push deployments until they explicitly select polling.
  const mode = process.env.GMAIL_SYNC_MODE?.trim() || "pubsub";
  if (mode !== "polling" && mode !== "pubsub")
    throw new Error("INVALID_GMAIL_SYNC_MODE");
  return mode;
}

export function gmailPushEnabled() {
  return gmailSyncMode() === "pubsub";
}

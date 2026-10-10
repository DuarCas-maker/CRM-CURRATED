// Roll out the new schema before enabling either process in production.
export const gmailHistoryEnabled = () =>
  process.env.GMAIL_HISTORY_ENABLED === "true";

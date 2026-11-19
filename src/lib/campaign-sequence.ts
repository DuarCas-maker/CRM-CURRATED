import type { CampaignFormat } from "./campaign-content";

export const reminderDays = [2, 3, 3, 5] as const;
export type ReminderTemplate = {
  subject: string;
  body: string;
  wait_days: number;
};
export const defaultReminders: ReminderTemplate[] = reminderDays.map(
  (wait_days, i) => ({
    subject: [
      "Following up on our email",
      "Still available for {{company}}",
      "Would you like to continue?",
      "A final follow-up",
    ][i],
    body: [
      "Hi,\n\nI'm following up on my previous email about {{company}}. If you'd like to continue the conversation, just reply to this message.\n\nThank you.\n\nUnsubscribe: {{unsubscribe_url}}",
      "Hi,\n\nDid you have a chance to review my email? If you need more information or would prefer to reconnect later, please let me know by replying.\n\nThank you.\n\nUnsubscribe: {{unsubscribe_url}}",
      "Hi,\n\nI'm still available to answer your questions. If you'd like to discuss next steps for {{company}}, reply to this email and I'll be happy to help.\n\nThank you.\n\nUnsubscribe: {{unsubscribe_url}}",
      "Hi,\n\nThis is my final reminder in this sequence. If you'd like to pick up the conversation later, you're welcome to reply whenever you're ready.\n\nThank you for your time.\n\nUnsubscribe: {{unsubscribe_url}}",
    ][i],
    wait_days,
  }),
);

// Explicit signature blocks belong to the selected Gmail sender, never to a
// reusable template author. Commercial content outside the block is untouched.
export function withoutInlineSignature(body: string, format?: CampaignFormat) {
  return format === "markdown"
    ? body
        .replace(
          /(^|\n)[ \t]*:::signature[ \t]*\r?\n.*?\r?\n[ \t]*:::[ \t]*(?=\r?\n|$)/gs,
          "$1",
        )
        .trim()
    : body;
}
export function templateReminders(
  steps: ReminderTemplate[] = [],
  format?: CampaignFormat,
) {
  return reminderDays.map((wait_days, i) => ({
    ...(steps[i] || defaultReminders[i]),
    wait_days,
    body: withoutInlineSignature(
      (steps[i] || defaultReminders[i]).body,
      format,
    ),
  }));
}
export function automaticSignatureTemplate<
  T extends {
    body: string;
    body_format?: CampaignFormat;
    steps: ReminderTemplate[];
  },
>(template: T): T {
  return {
    ...template,
    body: withoutInlineSignature(template.body, template.body_format),
    steps: template.steps.map((s) => ({
      ...s,
      body: withoutInlineSignature(s.body, template.body_format),
    })),
  };
}

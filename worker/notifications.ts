import webpush from "web-push";
import { db, checked } from "./db";
export async function deliverNotification(notificationId: string) {
  const client = db();
  const n = checked(
    await client
      .from("notifications")
      .select("*")
      .eq("id", notificationId)
      .single(),
  )!;
  const preferences = checked(
    await client
      .from("notification_preferences")
      .select("*")
      .eq("user_id", n.user_id)
      .maybeSingle(),
  );
  if (!preferences) return;
  if (
    preferences.push &&
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY
  ) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
    const subscriptions =
      checked(
        await client
          .from("push_subscriptions")
          .select("*")
          .eq("user_id", n.user_id),
      ) || [];
    for (const sub of subscriptions) {
      const channel = `push:${sub.id}`;
      const reserved = checked(
        await client
          .from("notification_deliveries")
          .upsert(
            { notification_id: n.id, channel, status: "sending" },
            { onConflict: "notification_id,channel", ignoreDuplicates: true },
          )
          .select("channel")
          .maybeSingle(),
      );
      if (!reserved) continue;
      try {
        await webpush.sendNotification(
          sub.subscription,
          JSON.stringify({ type: "workspace_update" }),
          { TTL: 3600, timeout: 15000 },
        );
        checked(
          await client
            .from("notification_deliveries")
            .update({ status: "sent" })
            .eq("notification_id", n.id)
            .eq("channel", channel),
        );
      } catch (e) {
        checked(
          await client
            .from("notification_deliveries")
            .update({ status: "failed" })
            .eq("notification_id", n.id)
            .eq("channel", channel),
        );
        if ([404, 410].includes((e as { statusCode: number }).statusCode))
          checked(
            await client.from("push_subscriptions").delete().eq("id", sub.id),
          );
      }
    }
  }
  if (preferences.email && process.env.NOTIFICATION_GMAIL_ACCOUNT_ID) {
    const recipient = checked(
      await client
        .from("profiles")
        .select("email,active")
        .eq("id", n.user_id)
        .single(),
    )!;
    if (!recipient.active) return;
    const admin = checked(
      await client
        .from("profiles")
        .select("id")
        .eq("role", "superadmin")
        .eq("active", true)
        .limit(1)
        .single(),
    )!;
    checked(
      await client.from("outbox").upsert(
        {
          notification_id: n.id,
          account_id: process.env.NOTIFICATION_GMAIL_ACCOUNT_ID,
          to_email: recipient.email,
          subject: "Your Curated Financial workspace has an update",
          body: `You have a new update. Sign in to your secure workspace to review it.\n\n${process.env.APP_ORIGIN}`,
          area: "general",
          message_id_header: `<notification.${n.id}@crm.curated.local>`,
          requested_by: admin.id,
          request_key: `notification:${n.id}`,
        },
        { onConflict: "request_key", ignoreDuplicates: true },
      ),
    );
  }
}

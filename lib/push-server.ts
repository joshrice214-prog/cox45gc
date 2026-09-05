import webpush from "web-push";
import { supabaseAdmin } from "./supabase";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

function configured(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:cox45@example.com", pub, priv);
  return true;
}

/** Send to every subscription for the given players (or everyone if playerIds is null). Prunes dead subscriptions. */
export async function sendPush(playerIds: string[] | null, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  if (!configured()) return { sent: 0, failed: 0 };
  const sb = supabaseAdmin();
  let q = sb.from("push_subscriptions").select("id, subscription_json");
  if (playerIds) q = q.in("player_id", playerIds);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  let sent = 0, failed = 0;
  const dead: string[] = [];
  await Promise.all(
    (data ?? []).map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription_json, JSON.stringify(payload), { TTL: 60 * 60 * 24 });
        sent++;
      } catch (e) {
        failed++;
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(row.id);
      }
    }),
  );
  if (dead.length) await sb.from("push_subscriptions").delete().in("id", dead);
  return { sent, failed };
}

export function cronAuthorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

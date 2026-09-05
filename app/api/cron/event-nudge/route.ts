import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { cronAuthorised, sendPush } from "@/lib/push-server";

export const runtime = "nodejs";

/** Daily: for any event that was yesterday with no round logged, nudge those who said "in". */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const sb = supabaseAdmin();
  const y = new Date();
  y.setUTCDate(y.getUTCDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);

  const { data: events, error } = await sb.from("events").select("id, course_name, course_id, date").eq("date", yesterday);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let nudged = 0;
  for (const ev of events ?? []) {
    // a round counts as logged if it's linked to the event, or played that day at that course
    const { data: linked } = await sb.from("rounds").select("id").eq("event_id", ev.id).limit(1);
    if (linked?.length) continue;
    if (ev.course_id) {
      const { data: sameDay } = await sb.from("rounds").select("id").eq("date", ev.date).eq("course_id", ev.course_id).limit(1);
      if (sameDay?.length) continue;
    }
    const { data: ins } = await sb.from("rsvps").select("player_id").eq("event_id", ev.id).eq("status", "in");
    const ids = (ins ?? []).map((r) => r.player_id as string);
    if (!ids.length) continue;
    const r = await sendPush(ids, {
      title: "Cox 45 — how did it go?",
      body: `No card in yet for ${ev.course_name ?? "yesterday's round"}. Snap the scorecard and it's logged.`,
      url: "/add",
      tag: "nudge-" + ev.id,
    });
    nudged += r.sent;
  }
  return NextResponse.json({ events: events?.length ?? 0, nudged });
}

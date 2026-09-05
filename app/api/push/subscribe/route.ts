import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { playerId, subscription } = (await req.json().catch(() => ({}))) as { playerId?: string; subscription?: { endpoint?: string } };
  if (!playerId || !subscription?.endpoint) return NextResponse.json({ error: "playerId and subscription required" }, { status: 400 });
  const { error } = await supabaseAdmin()
    .from("push_subscriptions")
    .upsert({ player_id: playerId, endpoint: subscription.endpoint, subscription_json: subscription }, { onConflict: "endpoint" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  const { error } = await supabaseAdmin().from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

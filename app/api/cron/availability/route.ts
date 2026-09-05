import { NextResponse } from "next/server";
import { cronAuthorised, sendPush } from "@/lib/push-server";

export const runtime = "nodejs";

/** 1st of the month: ask everyone to fill in their free dates. */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const month = new Date().toLocaleDateString("en-GB", { month: "long" });
  const r = await sendPush(null, {
    title: "Cox 45 — new month",
    body: `Mark the days you're free in ${month} so a round can get booked.`,
    url: "/events",
    tag: "availability",
  });
  return NextResponse.json(r);
}

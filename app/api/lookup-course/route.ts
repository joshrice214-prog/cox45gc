import { NextResponse } from "next/server";
import { lookupCourseRating } from "@/lib/course-lookup";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const { name, holes, tee } = (await req.json().catch(() => ({}))) as { name?: string; holes?: 9 | 18; tee?: string | null };
  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  const result = await lookupCourseRating(name.trim(), holes === 9 ? 9 : 18, tee ?? null);
  return NextResponse.json(result);
}

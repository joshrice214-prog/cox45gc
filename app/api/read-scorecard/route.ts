import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { extractJSON, normalise, secondPassPrompt, serious, validate, visionPrompt, type Parsed } from "@/lib/scorecard";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  images: { mime: string; b64: string }[];
  players: string[];
  courses: { name: string; holes?: number; pars: number[]; stroke_index: (number | null)[]; course_rating: number | null; slope: number | null }[];
}

type ImgBlock = { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string } };

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!body.images?.length || body.images.length > 4) return NextResponse.json({ error: "Send between 1 and 4 images." }, { status: 400 });

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  const imgs: ImgBlock[] = body.images.map((i) => ({
    type: "image",
    source: { type: "base64", media_type: (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(i.mime) ? i.mime : "image/jpeg") as ImgBlock["source"]["media_type"], data: i.b64 },
  }));
  const players = (body.players ?? []).slice(0, 30);
  const courses = (body.courses ?? []).slice(0, 40);

  const ask = async (text: string) => {
    const res = await client.messages.create({
      model,
      max_tokens: 2500,
      messages: [{ role: "user", content: [...imgs, { type: "text", text }] }],
    });
    return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
  };

  try {
    const first = await ask(visionPrompt(players, courses.map((c) => c.name)));
    let parsed: Parsed = normalise(extractJSON(first), players, courses);
    let issues = validate(parsed);
    let secondPassDone = false;

    const bad = serious(issues);
    if (bad.length) {
      try {
        const again = await ask(secondPassPrompt(parsed, bad));
        const fixed = normalise(extractJSON(again), players, courses);
        const fi = validate(fixed);
        if (serious(fi).length <= bad.length) {
          parsed = fixed;
          issues = fi;
        }
      } catch {
        /* keep the first read */
      }
      secondPassDone = true;
    }
    return NextResponse.json({ parsed, issues, secondPassDone });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "read failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

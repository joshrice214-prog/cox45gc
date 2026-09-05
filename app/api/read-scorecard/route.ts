import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { MODEL, appKeyOk } from "@/lib/anthropic";
import { extractJSON, mergeSecondPass, normalise, secondPassPrompt, serious, validate, visionPrompt } from "@/lib/scorecard";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  images: { mime: string; b64: string }[];
  players: string[];
  courses: { name: string; holes?: number; pars: number[]; stroke_index: (number | null)[]; course_rating: number | null; slope: number | null }[];
  /** Whoever's currently using the app — used to fill in a solo scorecard that prints no name at all. */
  importerName?: string | null;
}

type ImgBlock = { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string } };

const MAX_B64 = 4_000_000; // Vercel caps request bodies at 4.5 MB; leave headroom for the JSON around the images

export async function POST(req: Request) {
  if (!appKeyOk(req)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!body.images?.length || body.images.length > 4) return NextResponse.json({ error: "Send between 1 and 4 images." }, { status: 400 });
  if (body.images.reduce((s, i) => s + (i.b64?.length ?? 0), 0) > MAX_B64) return NextResponse.json({ error: "Those images are too large together — try fewer pages at once." }, { status: 413 });

  const client = new Anthropic({ apiKey });
  const imgs: ImgBlock[] = body.images.map((i) => ({
    type: "image",
    source: { type: "base64", media_type: (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(i.mime) ? i.mime : "image/jpeg") as ImgBlock["source"]["media_type"], data: i.b64 },
  }));
  const players = (body.players ?? []).slice(0, 30);
  const courses = (body.courses ?? []).slice(0, 40);
  const importerName = body.importerName?.trim() || null;

  const ask = async (text: string) => {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2500,
      messages: [{ role: "user", content: [...imgs, { type: "text", text }] }],
    });
    return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
  };

  try {
    const firstText = await ask(visionPrompt(players, courses.map((c) => c.name)));
    const firstRaw = extractJSON(firstText);
    let parsed = normalise(firstRaw, players, courses, importerName);
    let issues = validate(parsed);
    let secondPassDone = false;
    let secondText: string | null = null;

    // Rating/slope lookup is deliberately NOT done here — it adds web searches
    // and can push a read past the function timeout. The review screen has a
    // button for it when the card doesn't print one.

    const bad = serious(issues);
    if (bad.length) {
      secondPassDone = true;
      try {
        secondText = await ask(secondPassPrompt(firstRaw, bad));
        const merged = mergeSecondPass(firstRaw, extractJSON(secondText));
        const fixed = normalise(merged, players, courses, importerName);
        const fi = validate(fixed);
        if (serious(fi).length <= bad.length) {
          parsed = fixed;
          issues = fi;
        }
      } catch {
        /* keep the first read */
      }
    }
    return NextResponse.json({
      parsed,
      issues,
      secondPassDone,
      model: MODEL,
      raw: { first: firstText, second: secondText },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "read failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

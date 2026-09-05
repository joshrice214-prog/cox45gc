import Anthropic from "@anthropic-ai/sdk";
import { extractJSON } from "./scorecard";
import { MODEL } from "./anthropic";

export interface CourseLookup {
  found: boolean;
  courseRating: number | null;
  slope: number | null;
  tee: string | null;
  source: string | null; // a URL, if one was used
  note: string | null; // e.g. "matched the Blue tees, no White tees figure found"
}

const NOT_FOUND: CourseLookup = { found: false, courseRating: null, slope: null, tee: null, source: null, note: null };

/**
 * Look up a course's (rating, slope) online when the scorecard doesn't print it.
 * This is a suggestion only — the caller must still show it to a human before saving,
 * same as every other field in the review screen.
 */
export async function lookupCourseRating(name: string, holes: 9 | 18, tee?: string | null): Promise<CourseLookup> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !name.trim()) return NOT_FOUND;

  const client = new Anthropic({ apiKey });
  const model = MODEL;
  const prompt = `Find the USGA/WHS Course Rating and Slope Rating for this golf course${holes === 9 ? "'s 9-hole (or front/back 9) card" : ""}:

Course: "${name}"
Holes: ${holes}
${tee ? `Tee/markers if known: ${tee}` : "Tee/markers: not given — prefer the men's standard/white tee, or whichever the course lists as the default, and say which one you used"}

Search for it (course website, golf.com/coursefinder, USGA/WHS handicap lookup, the state golf association, etc). If you find multiple tees, pick the most likely default and say which tee it is. If you cannot find a confident match, say so.

Return ONLY this JSON, no commentary, no markdown fences:
{"found":boolean,"courseRating":number|null,"slope":number|null,"tee":string|null,"source":string|null,"note":string|null}

courseRating is typically 60-80 for 18 holes (30-40 for 9). slope is an integer 55-155 (113 is average). If you're not confident, set found to false rather than guessing.`;

  try {
    const res = await client.messages.create({
      model,
      max_tokens: 1200,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const j = extractJSON(text) as Partial<CourseLookup>;
    const cr = typeof j.courseRating === "number" && j.courseRating >= 25 && j.courseRating <= 85 ? j.courseRating : null;
    const sl = typeof j.slope === "number" && j.slope >= 55 && j.slope <= 155 ? Math.round(j.slope) : null;
    if (!cr && !sl) return NOT_FOUND;
    return {
      found: true,
      courseRating: cr,
      slope: sl,
      tee: typeof j.tee === "string" ? j.tee : null,
      source: typeof j.source === "string" ? j.source : null,
      note: typeof j.note === "string" ? j.note : null,
    };
  } catch {
    return NOT_FOUND;
  }
}

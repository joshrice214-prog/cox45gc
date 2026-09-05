/** Scorecard-reading pipeline pieces shared by the API route and the review screen. Pure. */

export interface ParsedPlayer {
  name: string;
  scores: (number | null)[];
  out: number | null;
  in: number | null;
  printed: number | null; // total printed on the card
  confidence: "high" | "medium" | "low";
  gross: number | null; // what we'll save: sum of holes when complete, else printed
}

export interface Parsed {
  course: string;
  date: string;
  holes: 9 | 18;
  tee: string | null;
  pars: (number | null)[];
  strokeIndex: (number | null)[];
  parOut: number | null;
  parIn: number | null;
  parTotal: number | null;
  courseRating: number | null;
  slope: number | null;
  players: ParsedPlayer[];
  unreadable: string[];
  /** where courseRating/slope came from — shown in the review screen so nothing is silently trusted */
  ratingSource: "card" | "course" | "lookup" | null;
  ratingNote: string | null;
}

export interface Issue {
  t: "par" | "si" | "note" | `p${number}`;
  m: string;
}

export const sum = (a: (number | null)[]) => a.reduce<number>((s, v) => s + (v ?? 0), 0);

export function visionPrompt(names: string[], courses: string[]): string {
  return `You are reading a golf scorecard. It may be a photo of a paper card or a screenshot from a golf app (18Birdies, Golfshot, Hole19, etc). If several images are given, they are pages of the SAME card (usually front nine and back nine) — merge them into one result.

How a paper scorecard is laid out:
- Columns are holes, numbered 1-9 then 10-18. There are usually OUT, IN and TOTAL columns.
- Rows near the top are yardages for each tee, then PAR, then STROKE INDEX (labelled SI, S.I., Index, HCP or Handicap) which contains each number from 1 to 18 exactly once, in scrambled order.
- Rows below are players, with a name written at the left and their strokes in each hole column.

How an 18Birdies-style app screenshot is laid out (read this just as carefully — it's typed, not handwritten, so get every field exact):
- A row labelled "HOLE" gives hole numbers, "PAR" gives the printed par per hole, and "HANDICAP" is the STROKE INDEX per hole (not a player's personal handicap) — map that row to strokeIndex.
- One or more rows labelled "SCORE" give gross strokes per hole. A solo round has one SCORE row for the account holder; a group round has one SCORE row per player, each with a name label to its left or above it (sometimes on a separate "Scorecard" or "Group" screen with a row per player instead of just one). Capture every player's row you can see. Ignore any "NET" row entirely — that's the app's own handicap-adjusted score, not what we want.
- The tee and rating are usually on one line near the date, formatted like "Yellow 3121 yds (121.0/35.4)" — two numbers in brackets, slash-separated. One of them is Slope (always a whole number, roughly 55-155) and the other is Course Rating (usually close to par, e.g. 33-37 for a 9-hole course or 67-77 for 18). Work out which is which from those ranges, not from position, and put them in courseRating and slope accordingly.
- The played date is usually shown as a plain date in a bar at the very bottom or top of the screen (commonly DD/MM/YYYY). Convert whatever format you see to YYYY-MM-DD.
- The course name is usually at the top, sometimes with the tee or "(9 HOLES)"/"(18 HOLES)" appended — strip that qualifier into the holes count, not into the course name itself.

Read it carefully, one row at a time. Then return ONLY a JSON object, no markdown fences, no commentary:

{"course":string|null,"date":"YYYY-MM-DD"|null,"holes":9|18,"tee":string|null,
"pars":[9 or 18 numbers],"strokeIndex":[9 or 18 numbers or null],"parOut":number|null,"parIn":number|null,"parTotal":number|null,
"courseRating":number|null,"slope":number|null,
"players":[{"name":string,"scores":[numbers or null],"out":number|null,"in":number|null,"total":number|null,"confidence":"high"|"medium"|"low"}],
"unreadable":[strings]}

Rules that matter:
- "pars" is the REAL printed par per hole. Never add anything to it. Par values are 3, 4 or 5 (rarely 6).
- "strokeIndex" is the printed stroke index per hole, in hole order. Each of 1..18 (or 1..9) appears once. Use null for any you cannot read. If there is no stroke index row at all, return all nulls.
- "scores" is gross strokes per hole in hole order. Use null for any box you cannot read or that is blank. Do not guess a number to fill a gap — null is the correct answer when unsure.
- "out", "in" and "total" must be the numbers PRINTED on the card, not your own additions. Use null if not printed.
- Never treat the stroke index row, yardage row, or par row as a player.
- Set "confidence" to low for any player whose handwriting is hard to make out.
- Put anything you could not read into "unreadable" as short plain descriptions.
- Course rating and slope only if actually printed. They are often absent.
${names.length ? `- Expected player names, match to these where the handwriting is close: ${names.join(", ")}.` : ""}
${courses.length ? `- Courses played before, match the course name to one of these if it fits: ${courses.join(", ")}.` : ""}`;
}

export function secondPassPrompt(first: Parsed, problems: Issue[]): string {
  return `Here is a first attempt at reading this scorecard, and the problems found with it:

${JSON.stringify({
  course: first.course,
  holes: first.holes,
  pars: first.pars,
  strokeIndex: first.strokeIndex,
  parTotal: first.parTotal,
  players: first.players.map((p) => ({ name: p.name, scores: p.scores, total: p.printed })),
})}

Problems:
${problems.map((p) => "- " + p.m).join("\n")}

Look at the image again and focus only on the rows and holes involved in those problems. Correct them. Where the hole-by-hole strokes disagree with the printed total, trust whichever the image actually shows and leave the other as null rather than forcing them to match. Return the full corrected JSON in exactly the same schema as before, ONLY the JSON.`;
}

export function extractJSON(txt: string): unknown {
  const t = txt.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error("no json");
  return JSON.parse(t.slice(a, b + 1));
}

const num = (v: unknown): number | null => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));

export function normalise(raw: unknown, knownPlayers: string[], knownCourses: { name: string; holes?: number; pars: number[]; stroke_index: (number | null)[]; course_rating: number | null; slope: number | null }[]): Parsed {
  const r = (raw ?? {}) as Record<string, unknown>;
  const parsIn = Array.isArray(r.pars) ? (r.pars as unknown[]).map(num) : [];
  const holes: 9 | 18 = r.holes === 9 || (parsIn.length === 9 && r.holes !== 18) ? 9 : 18;
  const pad = <T,>(a: T[], fill: T): T[] => {
    const out = a.slice(0, holes);
    while (out.length < holes) out.push(fill);
    return out;
  };
  const p: Parsed = {
    course: String(r.course ?? "").trim(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date ?? "")) ? String(r.date) : new Date().toISOString().slice(0, 10),
    holes,
    tee: r.tee ? String(r.tee) : null,
    pars: pad(parsIn, null),
    strokeIndex: pad(Array.isArray(r.strokeIndex) ? (r.strokeIndex as unknown[]).map(num) : [], null),
    parOut: num(r.parOut),
    parIn: num(r.parIn),
    parTotal: num(r.parTotal),
    courseRating: num(r.courseRating),
    slope: num(r.slope),
    players: [],
    unreadable: Array.isArray(r.unreadable) ? (r.unreadable as unknown[]).map(String).slice(0, 5) : [],
    ratingSource: null,
    ratingNote: null,
  };
  // Digital scorecards often print rating/slope as an unlabelled bracketed
  // pair, e.g. "(121.0/35.4)". Slope is always a whole number 55–155; if
  // what came back as "slope" falls outside that range while "courseRating"
  // is a whole number inside it, the two were almost certainly read in the
  // wrong order — put them back.
  if (p.slope != null && (p.slope < 55 || p.slope > 155) && p.courseRating != null && Number.isInteger(p.courseRating) && p.courseRating >= 55 && p.courseRating <= 155) {
    [p.courseRating, p.slope] = [p.slope, p.courseRating];
  }
  if (p.courseRating != null || p.slope != null) p.ratingSource = "card";
  p.players = (Array.isArray(r.players) ? (r.players as Record<string, unknown>[]) : [])
    .map((pl) => {
      const scores = pad(Array.isArray(pl.scores) ? (pl.scores as unknown[]).map(num) : [], null);
      const filled = scores.filter((v) => v != null).length;
      const printed = num(pl.total);
      return {
        name: matchName(String(pl.name ?? ""), knownPlayers),
        scores,
        out: num(pl.out),
        in: num(pl.in),
        printed,
        confidence: (["high", "medium", "low"].includes(String(pl.confidence)) ? pl.confidence : "medium") as ParsedPlayer["confidence"],
        gross: filled === holes ? sum(scores) : printed ?? (filled ? sum(scores) : null),
      };
    })
    .filter((pl) => pl.name || pl.gross);
  if (!p.parTotal && p.pars.some((v) => v != null)) p.parTotal = sum(p.pars);

  const known = knownCourses.find((c) => c.name.toLowerCase().trim() === p.course.toLowerCase().trim() && (c.holes == null || c.holes === holes));
  if (known) {
    p.course = known.name;
    if (p.courseRating == null && p.slope == null && (known.course_rating != null || known.slope != null)) p.ratingSource = "course";
    p.courseRating = p.courseRating ?? known.course_rating;
    p.slope = p.slope ?? known.slope;
    if (!p.pars.some((v) => v != null) && known.pars?.length === holes) p.pars = [...known.pars];
    if (!p.strokeIndex.some((v) => v != null) && known.stroke_index?.length === holes) p.strokeIndex = [...known.stroke_index];
  }
  return p;
}

export function matchName(raw: string, known: string[]): string {
  const s = raw.trim();
  if (!s) return "";
  const l = s.toLowerCase();
  return known.find((k) => k.toLowerCase() === l || l.startsWith(k.toLowerCase()) || k.toLowerCase().startsWith(l)) ?? s;
}

/** The card carries its own checksums. Use them. */
export function validate(p: Parsed): Issue[] {
  const out: Issue[] = [];
  const n = p.holes;

  const parsRead = p.pars.filter((v) => v != null).length;
  if (parsRead < n) out.push({ t: "par", m: `Only ${parsRead} of ${n} pars were read.` });
  else {
    const bad = p.pars.filter((v) => v == null || v < 3 || v > 6).length;
    if (bad) out.push({ t: "par", m: `${bad} par ${bad === 1 ? "value looks" : "values look"} wrong (pars are 3–6).` });
    const s = sum(p.pars);
    if (p.parTotal && s !== p.parTotal) out.push({ t: "par", m: `Pars add up to ${s} but the card says ${p.parTotal}.` });
    if (n === 18 && (s < 66 || s > 76)) out.push({ t: "par", m: `A par total of ${s} is unusual — worth a check.` });
    if (n === 9 && (s < 30 || s > 40)) out.push({ t: "par", m: `A par total of ${s} is unusual for nine — worth a check.` });
  }

  const si = p.strokeIndex;
  const siRead = si.filter((v) => v != null).length;
  // Some 9-hole courses print a stroke index drawn from 1–18 (e.g. all odd
  // numbers) because the nine is designed to be played twice for an 18-hole
  // round. That's a legitimate printed card, not a misread — only the
  // holes-vs-max range differs, so allow up to 18 for a 9-hole card too.
  const siMax = n === 9 ? 18 : n;
  if (siRead === 0) out.push({ t: "si", m: "No stroke index read. Without it, blow-up holes can't be capped — type it in if the card has one." });
  else if (siRead < n) out.push({ t: "si", m: `${n - siRead} stroke index ${n - siRead === 1 ? "value is" : "values are"} missing.` });
  else {
    const seen = new Set<number>();
    let dup = 0, range = 0;
    for (const v of si) {
      if (v! < 1 || v! > siMax || !Number.isInteger(v)) range++;
      else if (seen.has(v!)) dup++;
      else seen.add(v!);
    }
    if (range) out.push({ t: "si", m: `${range} stroke index ${range === 1 ? "value is" : "values are"} outside 1–${siMax}.` });
    if (dup) out.push({ t: "si", m: `Stroke index has ${dup} duplicate${dup === 1 ? "" : "s"} — each should appear once.` });
  }

  p.players.forEach((pl, i) => {
    const t: Issue["t"] = `p${i}`;
    if (!pl.name) out.push({ t, m: `Player ${i + 1} has no name.` });
    const filled = pl.scores.filter((v) => v != null).length;
    const who = pl.name || `Player ${i + 1}`;
    if (filled > 0 && filled < n) out.push({ t, m: `${who}: ${n - filled} ${n - filled === 1 ? "hole" : "holes"} couldn't be read.` });
    if (filled === 0 && !pl.printed) out.push({ t, m: `${who}: no scores read.` });
    const s = sum(pl.scores);
    if (pl.printed && filled === n && s !== pl.printed) out.push({ t, m: `${who}: holes add to ${s} but the card's total says ${pl.printed}.` });
    if (n === 18 && pl.out != null && filled >= 9) {
      const o = sum(pl.scores.slice(0, 9));
      if (pl.scores.slice(0, 9).every((v) => v != null) && o !== pl.out) out.push({ t, m: `${who}: front nine adds to ${o}, card says ${pl.out}.` });
    }
    if (n === 18 && pl.in != null && pl.scores.slice(9).every((v) => v != null)) {
      const iv = sum(pl.scores.slice(9));
      if (iv !== pl.in) out.push({ t, m: `${who}: back nine adds to ${iv}, card says ${pl.in}.` });
    }
    const silly = pl.scores.filter((v) => v != null && (v < 1 || v > 15)).length;
    if (silly) out.push({ t, m: `${who}: ${silly} score${silly === 1 ? "" : "s"} outside 1–15.` });
    if (pl.confidence === "low") out.push({ t, m: `${who}: read with low confidence.` });
  });

  p.unreadable.slice(0, 3).forEach((u) => out.push({ t: "note", m: "Couldn't read: " + u }));
  return out;
}

export const serious = (issues: Issue[]) => issues.filter((i) => i.t !== "note");

/**
 * The cap engine needs a 9-hole card's stroke index as a plain 1–9 relative
 * ranking. Some real cards instead print values drawn from 1–18 (commonly
 * all-odd) because the nine doubles as an 18-hole loop. Convert those to
 * their rank order before they're stored as a course's canonical stroke
 * index — what's shown on the review screen stays exactly what's printed;
 * this only runs once, at save time. A no-op on a card that's already 1–9.
 */
export function normaliseStrokeIndexForStorage(si: (number | null)[], holes: number): (number | null)[] {
  if (holes !== 9 || si.length !== 9) return si;
  const vals = si.filter((v): v is number => v != null);
  if (vals.length !== 9) return si; // leave partial cards for the user to finish
  if (!vals.every((v) => Number.isInteger(v) && v >= 1 && v <= 18)) return si;
  if (new Set(vals).size !== 9) return si; // duplicates — leave for the checksum to flag
  if (vals.every((v) => v <= 9)) return si; // already a plain 1–9 index
  const rank = new Map([...vals].sort((a, b) => a - b).map((v, i) => [v, i + 1]));
  return si.map((v) => (v == null ? null : rank.get(v)!));
}

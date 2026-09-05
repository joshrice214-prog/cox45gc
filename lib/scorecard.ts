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
  /** the date exactly as the reader transcribed it, before we parsed it */
  dateRaw: string | null;
  /** false when dateRaw was present but couldn't be parsed (date is then today's, and flagged) */
  dateOk: boolean;
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
  t: "par" | "si" | "date" | "rating" | "note" | `p${number}`;
  m: string;
}

export const sum = (a: (number | null)[]) => a.reduce<number>((s, v) => s + (v ?? 0), 0);

/**
 * Course names come off cards and screenshots with all sorts of decoration:
 * "EDWALTON GOLF CLUB (EDWALTON (9 HOLES))", "Edwalton GC - Yellow tees".
 * Everything after the first bracket or dash is a qualifier, not the name.
 * Used for matching only — the stored name keeps its original casing.
 */
export function canonicalCourseName(name: string): string {
  return name
    .replace(/\s*[\(\[].*$/, "")     // drop "(9 holes)", "(Yellow)" etc and anything after
    .replace(/\s+[-–—]\s+.*$/, "")    // drop " - Yellow tees"
    .replace(/\b(golf\s+club|golf\s+course|g\.?c\.?)\b/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

/** Human-facing version of the same clean-up: strips qualifiers but keeps the casing. */
export function tidyCourseName(name: string): string {
  return name.replace(/\s*[\(\[].*$/, "").replace(/\s+[-–—]\s+.*$/, "").replace(/\s+/g, " ").trim();
}

export function findCourse<T extends { name: string; holes?: number | null }>(courses: T[], name: string, holes?: number | null): T | undefined {
  const cn = canonicalCourseName(name);
  if (!cn) return undefined;
  const same = courses.filter((c) => holes == null || c.holes == null || c.holes === holes);
  return same.find((c) => canonicalCourseName(c.name) === cn);
}

/** A near miss worth offering as "did you mean" — one canonical name starts with the other. */
export function suggestCourse<T extends { name: string; holes?: number | null }>(courses: T[], name: string, holes?: number | null): T | undefined {
  const cn = canonicalCourseName(name);
  if (cn.length < 4) return undefined;
  const same = courses.filter((c) => holes == null || c.holes == null || c.holes === holes);
  return same.find((c) => {
    const k = canonicalCourseName(c.name);
    return k !== cn && (k.startsWith(cn) || cn.startsWith(k));
  });
}

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
- The played date is usually shown as a plain date in a bar at the very bottom or top of the screen. Copy it exactly as printed into "date" — do not convert or reformat it yourself, just transcribe the characters you see.
- The course name is usually at the top, sometimes with the tee or "(9 HOLES)"/"(18 HOLES)" appended — strip that qualifier into the holes count, not into the course name itself.

Read it carefully, one row at a time. Then return ONLY a JSON object, no markdown fences, no commentary:

{"course":string|null,"date":string|null,"holes":9|18,"tee":string|null,
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
- "date": transcribe exactly what's printed, character for character (e.g. "14/09/2024" or "14 Sep 2024") — do not reorder the parts or guess which number is the day.
- If there is exactly one player's scores on the card and no name is printed for them anywhere (common on a solo round screenshot), leave "name" as an empty string. Do not guess a name and do not pick one from the expected names list just to fill the field — we already know who's uploading the round and will fill it in ourselves.
${names.length ? `- Expected player names, match to these ONLY where a name is actually printed or handwritten and it's a close match — never use this list to invent a name that isn't on the card: ${names.join(", ")}.` : ""}
${courses.length ? `- Courses played before, match the course name to one of these if it fits: ${courses.join(", ")}.` : ""}`;
}

/**
 * The second pass is a fresh API call with no memory of the first, so it has
 * to be given the complete first attempt and the complete schema — otherwise
 * it can only return the fields it was shown, and anything else (date,
 * rating, slope, tee) silently disappears. Even so, the caller merges the
 * result over the first attempt rather than replacing it (see mergeSecondPass).
 */
export function secondPassPrompt(firstRaw: unknown, problems: Issue[]): string {
  return `Here is a first attempt at reading this scorecard — the complete JSON — and the problems found with it:

${JSON.stringify(firstRaw)}

Problems:
${problems.map((p) => "- " + p.m).join("\n")}

Look at the image again and correct only the rows and holes involved in those problems. Every other field (course, date, tee, courseRating, slope, pars, strokeIndex, out/in/total, the other players) must be carried over from the first attempt exactly as it is unless the image clearly shows it was wrong. Where hole-by-hole strokes disagree with a printed total, trust whichever the image actually shows and leave the other as null rather than forcing them to match.

Return the complete corrected JSON in this exact schema (every key present), ONLY the JSON, no fences, no commentary:
{"course":string|null,"date":string|null,"holes":9|18,"tee":string|null,
"pars":[9 or 18 numbers],"strokeIndex":[9 or 18 numbers or null],"parOut":number|null,"parIn":number|null,"parTotal":number|null,
"courseRating":number|null,"slope":number|null,
"players":[{"name":string,"scores":[numbers or null],"out":number|null,"in":number|null,"total":number|null,"confidence":"high"|"medium"|"low"}],
"unreadable":[strings]}`;
}

/**
 * Overlay the second attempt on the first at the raw-JSON level: a field the
 * second pass left null/missing/empty keeps the first pass's value. Players
 * are taken from the second pass only if it returned any at all.
 */
export function mergeSecondPass(first: unknown, second: unknown): Record<string, unknown> {
  const a = (first ?? {}) as Record<string, unknown>;
  const b = (second ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...a };
  const empty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && (v.length === 0 || v.every((x) => x == null)));
  for (const k of ["course", "date", "holes", "tee", "pars", "strokeIndex", "parOut", "parIn", "parTotal", "courseRating", "slope", "unreadable"]) {
    if (!empty(b[k])) out[k] = b[k];
  }
  if (Array.isArray(b.players) && b.players.length) out.players = b.players;
  return out;
}

export function extractJSON(txt: string): unknown {
  const t = txt.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error("no json");
  return JSON.parse(t.slice(a, b + 1));
}

const num = (v: unknown): number | null => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const validDate = (y: number, m: number, d: number) =>
  y > 1900 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate() ? `${y}-${pad2(m)}-${pad2(d)}` : null;

/**
 * Parses a date exactly as printed on a card, assuming UK day-first
 * convention (this is a UK club) rather than trusting the vision model to
 * have silently converted it — an ambiguous "04/05/2026" left to an LLM
 * tends to come back American. Day-first is only abandoned when it's
 * flatly impossible (e.g. "05/13/2026", where 13 can't be a month).
 */
export function parseCardDate(raw: string | null | undefined, fallback: string): string {
  const s = (raw ?? "").trim();
  if (!s) return fallback;

  // Already ISO (some apps, or our own re-submission of a parsed value).
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return validDate(+m[1], +m[2], +m[3]) ?? fallback;

  // Numeric, slash/dash/dot separated — day first unless that's impossible.
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) {
    const [, a, b, y] = m;
    let year = +y;
    if (year < 100) year += year < 70 ? 2000 : 1900;
    const dayFirst = validDate(year, +b, +a); // UK default: first number is the day
    if (dayFirst) return dayFirst;
    const monthFirst = validDate(year, +a, +b); // day-first was impossible — only remaining reading
    return monthFirst ?? fallback;
  }

  // Textual month, either order: "14 Sep 2024" / "September 14, 2024".
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]) ?? fallback;
  m = s.match(/^([A-Za-z]{3,9})\.?[\s-]+(\d{1,2}),?[\s-]+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return validDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]) ?? fallback;

  return fallback;
}

export function normalise(raw: unknown, knownPlayers: string[], knownCourses: { name: string; holes?: number; pars: number[]; stroke_index: (number | null)[]; course_rating: number | null; slope: number | null }[], importerName?: string | null): Parsed {
  const r = (raw ?? {}) as Record<string, unknown>;
  const parsIn = Array.isArray(r.pars) ? (r.pars as unknown[]).map(num) : [];
  const holes: 9 | 18 = r.holes === 9 || (parsIn.length === 9 && r.holes !== 18) ? 9 : 18;
  const pad = <T,>(a: T[], fill: T): T[] => {
    const out = a.slice(0, holes);
    while (out.length < holes) out.push(fill);
    return out;
  };
  const today = new Date().toISOString().slice(0, 10);
  const dateRaw = r.date == null || String(r.date).trim() === "" ? null : String(r.date).trim();
  const parsedDate = dateRaw ? parseCardDate(dateRaw, "") : "";
  const p: Parsed = {
    course: tidyCourseName(String(r.course ?? "")),
    date: parsedDate || today,
    dateRaw,
    dateOk: dateRaw == null ? true : parsedDate !== "",
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
        gross: filled === holes ? sum(scores) : printed, // never sum a partial card
      };
    })
    .filter((pl) => pl.name || pl.gross);

  // A solo scorecard often prints no name at all — it's implicitly "you".
  // Only fill this in when there's exactly one player on the card; with two
  // or more unnamed rows there's no safe way to guess which is which, so
  // those are left blank for the review screen instead.
  if (importerName && p.players.length === 1 && !p.players[0].name) {
    p.players[0].name = importerName;
  }
  if (!p.parTotal && p.pars.some((v) => v != null)) p.parTotal = sum(p.pars);

  const known = findCourse(knownCourses, p.course, holes);
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

  if (!p.dateOk) out.push({ t: "date", m: `Couldn't make sense of the date "${p.dateRaw}" — showing today's date instead. Check it.` });
  else if (p.dateRaw == null) out.push({ t: "note", m: "No date was found on the card — showing today's date. Check it." });
  if (p.courseRating == null || p.slope == null) {
    out.push({ t: "note", m: p.courseRating == null && p.slope == null ? "No course rating or slope on the card. The round will save but won't count for handicap until they're filled in — try the look-up button below." : `Only ${p.courseRating == null ? "slope" : "course rating"} was read — the round needs both to count.` });
  }

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

/**
 * Hard stops before a round can be saved — shared by Add Round and Import
 * so neither screen can slip something past the other. Returns null when
 * it's fine to save.
 */
export function preSaveError(p: Parsed): string | null {
  if (!p.course.trim()) return "Give the course a name so the round can be saved.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return "The date isn't valid.";
  if (p.pars.length !== p.holes || p.pars.some((v) => v == null || v < 3 || v > 6)) return "Every hole needs a par between 3 and 6.";
  const named = p.players.filter((pl) => pl.name.trim());
  if (!named.length) return "At least one player needs a name and a score.";
  for (const pl of named) {
    const filled = pl.scores.filter((v) => v != null).length;
    if (filled > 0 && filled < p.holes) return `${pl.name}: ${p.holes - filled} hole${p.holes - filled === 1 ? " is" : "s are"} blank. Fill them in, or clear the row and enter the total only.`;
    if (!pl.gross) return `${pl.name} has no score.`;
  }
  return null;
}

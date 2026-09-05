/**
 * Cox 45™ handicap engine.
 *
 * Two indices are computed in parallel from the same rounds:
 *   World Index  — WHS, real course rating.
 *   Cox 45 Index — same method, but every rating is Cox-adjusted (+2 per hole).
 *
 * Everything in here is pure. No I/O. Tested in tests/handicap.test.ts.
 */

export type Kind = "world" | "cox";

export interface RoundInput {
  id: string;
  date: string; // YYYY-MM-DD
  holes: 9 | 18;
  pars: number[];
  strokeIndex: (number | null)[];
  courseRating: number | null;
  slope: number | null;
  /** raw gross per hole; null = not recorded */
  scores: (number | null)[];
  /** gross total (used if hole scores are incomplete) */
  grossTotal: number | null;
}

export interface CappedHole {
  raw: number | null;
  capped: number | null; // null when raw is null
  wasCapped: boolean;
}

export interface RoundResult {
  roundId: string;
  date: string;
  holes: 9 | 18;
  counting: boolean; // has rating + slope + full hole scores (or gross total)
  reason?: string;
  world: KindResult;
  cox: KindResult;
}

export interface KindResult {
  /** index the player carried INTO this round (null for first 3 rounds) */
  indexBefore: number | null;
  courseHandicap: number | null;
  capApplied: boolean;
  holes: CappedHole[];
  adjustedGross: number | null;
  differential: number | null; // already doubled for 9-hole rounds
  indexAfter: number | null;
}

/* ---------- ratings ---------- */

export function coxAdjustedRating(courseRating: number, holes: number): number {
  return courseRating + holes * 2;
}
export function coxPar(par: number, holes: number): number {
  return par + holes * 2;
}

/* ---------- WHS table (3.4) ---------- */

export function whsRule(n: number): { use: number; adjust: number } {
  if (n < 3) return { use: 0, adjust: 0 };
  if (n === 3) return { use: 1, adjust: -2 };
  if (n === 4) return { use: 1, adjust: -1 };
  if (n === 5) return { use: 1, adjust: 0 };
  if (n === 6) return { use: 2, adjust: -1 };
  if (n <= 9) return { use: 2, adjust: 0 };
  if (n <= 11) return { use: 3, adjust: 0 };
  if (n <= 14) return { use: 4, adjust: 0 };
  if (n <= 16) return { use: 5, adjust: 0 };
  if (n <= 18) return { use: 6, adjust: 0 };
  if (n === 19) return { use: 7, adjust: 0 };
  return { use: 8, adjust: 0 };
}

/** Round half away from zero to one decimal (WHS convention). */
export function round1(v: number): number {
  const s = Math.sign(v) || 1;
  return (s * Math.round(Math.abs(v) * 10 + 1e-9)) / 10;
}

/**
 * Index from an ordered (oldest → newest) list of differentials.
 * Uses the most recent 20 only. Returns null with fewer than 3.
 */
export function indexFromDifferentials(diffs: number[]): number | null {
  if (diffs.length < 3) return null;
  const recent = diffs.slice(-20);
  const { use, adjust } = whsRule(recent.length);
  const sorted = [...recent].sort((a, b) => a - b);
  const take = sorted.slice(0, use);
  const avg = take.reduce((s, v) => s + v, 0) / take.length;
  return round1(avg + adjust);
}

/* ---------- course handicap + stroke allocation (3.2) ---------- */

/**
 * Course Handicap = Index × (Slope/113) + (Rating − Par), rounded to whole.
 * For a 9-hole round the WHS convention is half the index against the
 * 9-hole rating and par (the rating/par passed in are already for 9).
 */
export function courseHandicap(
  index: number,
  slope: number,
  rating: number,
  par: number,
  holes: number,
): number {
  const idx = holes === 9 ? index / 2 : index;
  return Math.round(idx * (slope / 113) + (rating - par));
}

/**
 * Strokes received on a hole: one for every full `holes` in the course
 * handicap, plus one more if the hole's SI is <= the remainder.
 * Works for handicaps above 18 (or 9) and for plus handicaps (negative):
 * a −3 handicap gives back a stroke on SI 18, 17, 16 (i.e. the easiest holes).
 */
export function strokesOnHole(ch: number, si: number | null, holes: number): number {
  if (si == null) return ch >= 0 ? Math.floor(ch / holes) : 0 - Math.floor(-ch / holes);
  if (ch >= 0) {
    const full = Math.floor(ch / holes);
    const rem = ch - full * holes;
    return full + (si <= rem ? 1 : 0);
  }
  const abs = -ch;
  const full = Math.floor(abs / holes);
  const rem = abs - full * holes;
  // strokes given back start from the hardest-numbered (easiest) hole
  return 0 - (full + (si > holes - rem ? 1 : 0));
}

/* ---------- differential (3.3, 3.5) ---------- */

export function differential(adjustedGross: number, rating: number, slope: number, holes: number): number {
  const d = ((adjustedGross - rating) * 113) / slope;
  return holes === 9 ? d * 2 : d;
}

/* ---------- Cox categories (3.6) — display only ---------- */

export type CoxCategory = "eagle" | "bird" | "par" | "bogey" | "double" | "worse";
export function coxCategory(score: number, par: number): { cat: CoxCategory; label: string; vs: number } {
  const vs = score - (par + 2);
  if (vs <= -2) return { cat: "eagle", label: "Cox Eagle", vs };
  if (vs === -1) return { cat: "bird", label: "Cox Bird", vs };
  if (vs === 0) return { cat: "par", label: "Cox Par", vs };
  if (vs === 1) return { cat: "bogey", label: "Cox Bogey", vs };
  if (vs === 2) return { cat: "double", label: "Cox Double", vs };
  return { cat: "worse", label: `Cox +${vs}`, vs };
}

/* ---------- the full per-player computation ---------- */

function sumParOf(r: RoundInput): number {
  return r.pars.reduce((s, v) => s + (v ?? 0), 0);
}

function evalKind(
  r: RoundInput,
  kind: Kind,
  indexBefore: number | null,
  priorCounting: number,
): Omit<KindResult, "indexAfter"> {
  const par = sumParOf(r);
  const rating = kind === "cox" ? coxAdjustedRating(r.courseRating!, r.holes) : r.courseRating!;
  const base = kind === "cox" ? 4 : 2;

  // 3.2 — no cap for the first 3 rounds, and never without an index to base it on.
  // Course Handicap = Index × (Slope/113) + (Rating − Par). For the Cox side the
  // rating is the Cox-adjusted one and Par is the real par, which is what makes the
  // Cox course handicap come out equal to the World one — so the cap shifts by
  // exactly +2 per hole (Par+4) rather than being harsher.
  const capOn = priorCounting >= 3 && indexBefore != null;
  const ch = capOn ? courseHandicap(indexBefore!, r.slope!, rating, par, r.holes) : null;

  const holes: CappedHole[] = r.scores.map((raw, i) => {
    if (raw == null) return { raw: null, capped: null, wasCapped: false };
    if (!capOn) return { raw, capped: raw, wasCapped: false };
    const cap = r.pars[i] + base + strokesOnHole(ch!, r.strokeIndex[i] ?? null, r.holes);
    return raw > cap ? { raw, capped: cap, wasCapped: true } : { raw, capped: raw, wasCapped: false };
  });

  const complete = holes.length === r.holes && holes.every((h) => h.capped != null);
  const adjustedGross = complete
    ? holes.reduce((s, h) => s + (h.capped ?? 0), 0)
    : r.grossTotal; // no hole detail → cap can't apply; use printed total
  const diff = adjustedGross != null ? differential(adjustedGross, rating, r.slope!, r.holes) : null;

  return { indexBefore, courseHandicap: ch, capApplied: capOn, holes, adjustedGross, differential: diff };
}

/**
 * Walk a player's rounds oldest → newest, computing the cap with the index
 * they carried INTO each round, then the differential, then the new index.
 * Never circular.
 */
export function computePlayer(roundsIn: RoundInput[]): RoundResult[] {
  const rounds = [...roundsIn].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const wDiffs: number[] = [];
  const cDiffs: number[] = [];
  let wIdx: number | null = null;
  let cIdx: number | null = null;
  const out: RoundResult[] = [];

  for (const r of rounds) {
    const hasScore =
      (r.scores.length === r.holes && r.scores.every((s) => s != null)) || r.grossTotal != null;
    const counting = !!(r.courseRating && r.slope && r.holes && hasScore && r.pars.length === r.holes);
    if (!counting) {
      const empty = (): KindResult => ({
        indexBefore: null,
        courseHandicap: null,
        capApplied: false,
        holes: r.scores.map((raw) => ({ raw, capped: raw, wasCapped: false })),
        adjustedGross: null,
        differential: null,
        indexAfter: null,
      });
      out.push({
        roundId: r.id,
        date: r.date,
        holes: r.holes,
        counting: false,
        reason: !r.courseRating || !r.slope ? "No course rating or slope" : "Incomplete score",
        world: { ...empty(), indexAfter: wIdx },
        cox: { ...empty(), indexAfter: cIdx },
      });
      continue;
    }
    const w = evalKind(r, "world", wIdx, wDiffs.length);
    const c = evalKind(r, "cox", cIdx, cDiffs.length);
    wDiffs.push(w.differential!);
    cDiffs.push(c.differential!);
    wIdx = indexFromDifferentials(wDiffs);
    cIdx = indexFromDifferentials(cDiffs);
    out.push({
      roundId: r.id,
      date: r.date,
      holes: r.holes,
      counting: true,
      world: { ...w, indexAfter: wIdx },
      cox: { ...c, indexAfter: cIdx },
    });
  }
  return out;
}

export function currentIndex(results: RoundResult[], kind: Kind): number | null {
  for (let i = results.length - 1; i >= 0; i--) {
    const v = results[i][kind].indexAfter;
    if (v != null) return v;
  }
  return null;
}

/** Index history as [{date, value}] — only rounds that produced an index. */
export function indexHistory(results: RoundResult[], kind: Kind): { date: string; value: number }[] {
  return results
    .filter((r) => r.counting && r[kind].indexAfter != null)
    .map((r) => ({ date: r.date, value: r[kind].indexAfter! }));
}

/** Index a player held on/before a given date (null if none yet). */
export function indexAt(results: RoundResult[], kind: Kind, date: string): number | null {
  let v: number | null = null;
  for (const r of results) {
    if (r.date > date) break;
    if (r[kind].indexAfter != null) v = r[kind].indexAfter;
  }
  return v;
}

export function countingRounds(results: RoundResult[]): number {
  return results.filter((r) => r.counting).length;
}

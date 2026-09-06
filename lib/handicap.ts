/**
 * Cox 45™ handicap engine.
 *
 * Three indices are computed in parallel from the same rounds, differing only in
 * how much padding is added to the course rating:
 *   World Index      — WHS, real course rating (padding 0)
 *   Cox 45 Pro Index — rating + 1 per hole
 *   Cox 45 Index     — rating + 2 per hole
 *
 * A player climbs a ladder: Cox 45 → Cox 45 Pro (once their Cox 45 index reaches
 * −10.5) → WHS Only (once their Pro index reaches −1.0). Promotion only ever goes
 * up. Every track is always computed over the whole history, so on promotion the
 * new headline number is simply the track that was already running.
 *
 * Everything in here is pure. No I/O. Tested in tests/handicap.test.ts.
 */

export type Kind = "world" | "pro" | "cox";
export type Tier = "cox45" | "pro" | "whs";

export const PADDING: Record<Kind, number> = { world: 0, pro: 1, cox: 2 };
export const PRO_THRESHOLD = -10.5; // Cox 45 index at or below this → Cox 45 Pro
export const WHS_THRESHOLD = -1.0; // Cox 45 Pro index at or below this → WHS Only

/**
 * Rounds a player needs before their index is eligible for the record book
 * (lowest index ever held, most improved). Half the 20-round WHS window, and
 * exactly where the table steps from "lowest 2" to "lowest 3" — the point at
 * which the number stops being one good day with an adjustment on top.
 *
 * This gates trophies only. The live index, the cap, and ladder promotion all
 * use the number as soon as it exists (3 rounds) — a promotion is a real
 * graduation, not a record claim.
 */
export const RECORD_MIN_ROUNDS = 10;

/** The track that is a player's headline "house" number at a given tier. */
export const TIER_KIND: Record<Tier, Kind> = { cox45: "cox", pro: "pro", whs: "world" };
export const TIER_LABEL: Record<Tier, string> = { cox45: "Cox 45", pro: "Cox 45 Pro", whs: "WHS Only" };
export const KIND_LABEL: Record<Kind, string> = { world: "World", pro: "Cox 45 Pro", cox: "Cox 45" };

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
  pro: KindResult;
  cox: KindResult;
  /** the ladder rung the player was on going into this round */
  tierBefore: Tier;
  /** the rung after this round's indices were recomputed (ratchets up only) */
  tierAfter: Tier;
  /** set when this round triggered a promotion */
  promotedTo?: Tier;
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

/** Rating with a track's padding applied (+0 / +1 / +2 per hole). */
export function paddedRating(courseRating: number, holes: number, kind: Kind): number {
  return courseRating + holes * PADDING[kind];
}
/** Cox Adjusted Rating — the +2/hole house rating. Kept for the shared scoring baseline. */
export function coxAdjustedRating(courseRating: number, holes: number): number {
  return paddedRating(courseRating, holes, "cox");
}
/** Cox Par (+2/hole). The group's fixed scoring yardstick — never changes with tier. */
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
  const rating = paddedRating(r.courseRating!, r.holes, kind);
  // cap = Par + padding + 2 + strokes: World Par+2, Pro Par+3, Cox Par+4
  const base = 2 + PADDING[kind];

  // 3.2 — no cap for the first 3 rounds, and never without an index to base it on.
  // Course Handicap = Index × (Slope/113) + (Rating − Par). The padded rating is
  // used against the real par, which is what makes every track's course handicap
  // come out equal to the World one — so the cap shifts by exactly the padding
  // rather than biting harder on the house tracks.
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
  const diffs: Record<Kind, number[]> = { world: [], pro: [], cox: [] };
  const idx: Record<Kind, number | null> = { world: null, pro: null, cox: null };
  let tier: Tier = "cox45";
  const out: RoundResult[] = [];

  for (const r of rounds) {
    const hasScore =
      (r.scores.length === r.holes && r.scores.every((s) => s != null)) || r.grossTotal != null;
    const counting = !!(r.courseRating && r.slope && r.holes && hasScore && r.pars.length === r.holes);
    if (!counting) {
      const empty = (k: Kind): KindResult => ({
        indexBefore: null,
        courseHandicap: null,
        capApplied: false,
        holes: r.scores.map((raw) => ({ raw, capped: raw, wasCapped: false })),
        adjustedGross: null,
        differential: null,
        indexAfter: idx[k],
      });
      out.push({
        roundId: r.id,
        date: r.date,
        holes: r.holes,
        counting: false,
        reason: !r.courseRating || !r.slope ? "No course rating or slope" : "Incomplete score",
        world: empty("world"),
        pro: empty("pro"),
        cox: empty("cox"),
        tierBefore: tier,
        tierAfter: tier,
      });
      continue;
    }
    const tierBefore = tier;
    const res = {} as Record<Kind, KindResult>;
    for (const k of ["world", "pro", "cox"] as Kind[]) {
      const e = evalKind(r, k, idx[k], diffs[k].length);
      diffs[k].push(e.differential!);
      idx[k] = indexFromDifferentials(diffs[k]);
      res[k] = { ...e, indexAfter: idx[k] };
    }
    // the ladder — ratchets up only, checked after every round
    let promotedTo: Tier | undefined;
    if (tier === "cox45" && idx.cox != null && idx.cox <= PRO_THRESHOLD) {
      tier = "pro";
      promotedTo = "pro";
    }
    if (tier === "pro" && idx.pro != null && idx.pro <= WHS_THRESHOLD) {
      tier = "whs";
      promotedTo = "whs";
    }
    out.push({
      roundId: r.id,
      date: r.date,
      holes: r.holes,
      counting: true,
      world: res.world,
      pro: res.pro,
      cox: res.cox,
      tierBefore,
      tierAfter: tier,
      promotedTo,
    });
  }
  return out;
}

export function currentTier(results: RoundResult[]): Tier {
  return results.length ? results[results.length - 1].tierAfter : "cox45";
}

export function tierAt(results: RoundResult[], date: string): Tier {
  let t: Tier = "cox45";
  for (const r of results) {
    if (r.date > date) break;
    t = r.tierAfter;
  }
  return t;
}

/** The headline house number for the player's current tier (World once they're WHS Only). */
export function houseIndex(results: RoundResult[]): { tier: Tier; kind: Kind; value: number | null } {
  const tier = currentTier(results);
  const kind = TIER_KIND[tier];
  return { tier, kind, value: currentIndex(results, kind) };
}

export function promotions(results: RoundResult[]): { tier: Tier; date: string; roundId: string }[] {
  return results.filter((r) => r.promotedTo).map((r) => ({ tier: r.promotedTo!, date: r.date, roundId: r.roundId }));
}

export function currentIndex(results: RoundResult[], kind: Kind): number | null {
  for (let i = results.length - 1; i >= 0; i--) {
    const v = results[i][kind].indexAfter;
    if (v != null) return v;
  }
  return null;
}

export interface IndexPoint {
  date: string;
  value: number;
  /** rung after this round — what the player is on from here (sparkline, badges) */
  tier: Tier;
  /** rung the round was played on — the rung this number was earned on (records, personal bests) */
  rung: Tier;
  promoted: boolean;
  nth: number; // counting-round number, 1-based
  eligible: boolean; // nth >= RECORD_MIN_ROUNDS
}

/**
 * Index history — only rounds that produced an index. A round that promotes a
 * player belongs to the rung they were on when they played it (`rung`): the number
 * that graduates you is your last, and usually best, number on the old rung.
 */
export function indexHistory(results: RoundResult[], kind: Kind): IndexPoint[] {
  let nth = 0;
  const out: IndexPoint[] = [];
  for (const r of results) {
    if (!r.counting) continue;
    nth++;
    if (r[kind].indexAfter == null) continue;
    out.push({ date: r.date, value: r[kind].indexAfter!, tier: r.tierAfter, rung: r.tierBefore, promoted: !!r.promotedTo, nth, eligible: nth >= RECORD_MIN_ROUNDS });
  }
  return out;
}

export interface PersonalBest {
  tier: Tier;
  value: number;
  date: string;
  nth: number; // counting-round number it was set at
  early: boolean; // set before RECORD_MIN_ROUNDS — real, but not a settled number
  current: boolean; // still on this rung
}

/**
 * A player's own best index on every rung they've been on — their story, not the
 * club trophy. Ungated on purpose: a fast graduate still gets to see what they did
 * on Cox 45. `early` flags a best set before RECORD_MIN_ROUNDS so it isn't read as
 * a settled achievement. The club-wide record (allTimeRecords) is separate and gated.
 */
export function personalBests(results: RoundResult[]): PersonalBest[] {
  const now = currentTier(results);
  const out: PersonalBest[] = [];
  for (const tier of ["cox45", "pro", "whs"] as Tier[]) {
    let best: PersonalBest | null = null;
    for (const h of indexHistory(results, TIER_KIND[tier])) {
      if (h.rung !== tier) continue;
      if (!best || h.value < best.value) best = { tier, value: h.value, date: h.date, nth: h.nth, early: !h.eligible, current: tier === now };
    }
    if (best) out.push(best);
  }
  return out;
}

/** Counting rounds the player had completed on or before a date. */
export function roundsPlayedBy(results: RoundResult[], date: string): number {
  let n = 0;
  for (const r of results) {
    if (r.date > date) break;
    if (r.counting) n++;
  }
  return n;
}

/** True once a player has enough rounds for their index to count in the record book. */
export function recordEligible(results: RoundResult[], date?: string): boolean {
  const n = date ? roundsPlayedBy(results, date) : results.filter((r) => r.counting).length;
  return n >= RECORD_MIN_ROUNDS;
}

/**
 * The player's house-index history — the track that was their headline number at
 * the time of each round. Jumps at promotion (the ruler changes), so consumers
 * should mark those points rather than read them as form.
 */
export function houseHistory(results: RoundResult[]): { date: string; value: number; tier: Tier; promoted: boolean }[] {
  return results
    .filter((r) => r.counting)
    .map((r) => ({ date: r.date, value: r[TIER_KIND[r.tierAfter]].indexAfter, tier: r.tierAfter, promoted: !!r.promotedTo }))
    .filter((h): h is { date: string; value: number; tier: Tier; promoted: boolean } => h.value != null);
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

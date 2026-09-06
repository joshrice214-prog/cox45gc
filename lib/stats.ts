import {
  computePlayer,
  currentIndex,
  currentTier,
  houseHistory,
  houseIndex,
  indexAt,
  indexHistory,
  coxCategory,
  countingRounds,
  promotions,
  tierAt,
  KIND_LABEL,
  TIER_LABEL,
  TIER_KIND,
  type RoundInput,
  type RoundResult,
  type Kind,
  type Tier,
} from "./handicap";
import type { AppData, Course, Round, RoundScore } from "./types";

/* ---------- glue: DB rows → engine input ---------- */

export function roundInputsFor(data: AppData, playerId: string): RoundInput[] {
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  return data.scores
    .filter((s) => s.player_id === playerId)
    .map((s) => {
      const r = data.rounds.find((x) => x.id === s.round_id);
      if (!r) return null;
      const c = courses.get(r.course_id);
      return {
        id: r.id,
        date: r.date,
        holes: (r.holes === 9 ? 9 : 18) as 9 | 18,
        pars: c?.pars ?? [],
        strokeIndex: c?.stroke_index ?? [],
        courseRating: r.course_rating,
        slope: r.slope,
        scores: s.hole_scores ?? [],
        grossTotal: s.gross_total,
      } as RoundInput;
    })
    .filter((x): x is RoundInput => !!x);
}

const cache = new WeakMap<AppData, Map<string, RoundResult[]>>();
export function playerResults(data: AppData, playerId: string): RoundResult[] {
  let m = cache.get(data);
  if (!m) {
    m = new Map();
    cache.set(data, m);
  }
  let r = m.get(playerId);
  if (!r) {
    r = computePlayer(roundInputsFor(data, playerId));
    m.set(playerId, r);
  }
  return r;
}

export function roundResultFor(data: AppData, playerId: string, roundId: string): RoundResult | undefined {
  return playerResults(data, playerId).find((r) => r.roundId === roundId);
}

/* ---------- helpers ---------- */

export const seasonOf = (date: string) => Number(date.slice(0, 4));
export const today = () => new Date().toISOString().slice(0, 10);
export const coxParOf = (c: Course | undefined, r: Round) =>
  c && c.pars.length ? c.pars.reduce((s, v) => s + v, 0) + r.holes * 2 : null;
export const parOf = (c: Course | undefined) => (c && c.pars.length ? c.pars.reduce((s, v) => s + v, 0) : null);

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/* ---------- leaderboard ---------- */

export interface BoardRow {
  playerId: string;
  name: string;
  tier: Tier;
  /** the headline house number for the player's tier (World once WHS Only) */
  house: { kind: Kind; value: number | null; label: string };
  world: number | null;
  pro: number | null;
  cox: number | null;
  counting: number;
  needed: number;
  /** on World index — the one scale that never shifts under anyone */
  trend: { dir: "up" | "down" | "flat"; delta: number } | null;
  /** house-index history for the sparkline; promoted=true marks a ruler change */
  history: { date: string; value: number; tier: Tier; promoted: boolean }[];
  /** movement over the window: World always; house only if the tier didn't change in the window */
  movement: { world: number | null; house: number | null };
}

/**
 * Ranked by World Index — the only number that's on the same scale for a Cox 45
 * player, a Pro and a WHS Only player. The house number is shown alongside.
 */
export function leaderboard(data: AppData, windowDays: number): BoardRow[] {
  const since = daysAgo(windowDays);
  return data.players
    .map((p) => {
      const res = playerResults(data, p.id);
      const h = houseIndex(res);
      const wh = indexHistory(res, "world");
      let trend: BoardRow["trend"] = null;
      if (wh.length >= 2) {
        const back = wh[Math.max(0, wh.length - 4)].value;
        const delta = wh[wh.length - 1].value - back;
        trend = { dir: delta <= -0.15 ? "up" : delta >= 0.15 ? "down" : "flat", delta };
      }
      const mv = (k: Kind) => {
        const now = currentIndex(res, k);
        const then = indexAt(res, k, since);
        return now != null && then != null ? Math.round((now - then) * 10) / 10 : null;
      };
      const sameTier = tierAt(res, since) === h.tier;
      return {
        playerId: p.id,
        name: p.name,
        tier: h.tier,
        house: { kind: h.kind, value: h.value, label: KIND_LABEL[h.kind] },
        world: currentIndex(res, "world"),
        pro: currentIndex(res, "pro"),
        cox: currentIndex(res, "cox"),
        counting: countingRounds(res),
        needed: Math.max(0, 3 - countingRounds(res)),
        trend,
        history: houseHistory(res),
        movement: { world: mv("world"), house: sameTier ? mv(h.kind) : null },
      };
    })
    .sort((a, b) => {
      if (a.world == null && b.world == null) return b.counting - a.counting;
      if (a.world == null) return 1;
      if (b.world == null) return -1;
      return a.world - b.world;
    });
}

export const tierBadge = (t: Tier): string | null => (t === "pro" ? "PRO" : t === "whs" ? "WHS" : null);
export { TIER_LABEL, KIND_LABEL };

/* ---------- per-round rows (season scoped) ---------- */

export interface ScoreRow {
  round: Round;
  course: Course | undefined;
  score: RoundScore;
  playerId: string;
  vsCox: number | null; // gross − Cox Par
  vsPar: number | null;
  coxBirds: number; // holes exactly Cox Par − 1
  birdies: number; // holes exactly Par − 1 (real)
  coxParsOrBetter: number;
}

export function scoreRows(data: AppData, season?: number): ScoreRow[] {
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const rows: ScoreRow[] = [];
  for (const r of data.rounds) {
    if (season != null && seasonOf(r.date) !== season) continue;
    const c = courses.get(r.course_id);
    const cp = coxParOf(c, r);
    const par = parOf(c);
    for (const s of data.scores.filter((x) => x.round_id === r.id)) {
      let coxBirds = 0,
        birdies = 0,
        coxParsOrBetter = 0;
      if (c && c.pars.length && s.hole_scores?.length) {
        s.hole_scores.forEach((v, i) => {
          const p = c.pars[i];
          if (v == null || p == null) return;
          const cat = coxCategory(v, p);
          if (cat.cat === "bird") coxBirds++;
          if (cat.vs <= 0) coxParsOrBetter++;
          if (v === p - 1) birdies++;
        });
      }
      rows.push({
        round: r,
        course: c,
        score: s,
        playerId: s.player_id,
        vsCox: cp != null ? s.gross_total - cp : null,
        vsPar: par != null ? s.gross_total - par : null,
        coxBirds,
        birdies,
        coxParsOrBetter,
      });
    }
  }
  return rows;
}

/* ---------- order of merit ----------
   Each round is worth  40 − (gross − Cox Par)  points, floored at 0
   (so a round played to Cox Par is 40, a Cox Bird average is 41…).
   A player's total is the sum of their best 6 rounds in the season.
   9-hole rounds are scaled: 20 − (gross − Cox Par) so they're worth half. */

export interface MeritRow {
  playerId: string;
  name: string;
  points: number;
  counted: number;
  played: number;
  best: number[];
}

export function roundPoints(row: ScoreRow): number | null {
  if (row.vsCox == null) return null;
  const base = row.round.holes === 9 ? 20 : 40;
  return Math.max(0, base - row.vsCox);
}

export function orderOfMerit(data: AppData, season: number): MeritRow[] {
  const rows = scoreRows(data, season);
  return data.players
    .map((p) => {
      const pts = rows
        .filter((r) => r.playerId === p.id)
        .map(roundPoints)
        .filter((v): v is number => v != null)
        .sort((a, b) => b - a);
      const best = pts.slice(0, 6);
      return { playerId: p.id, name: p.name, points: best.reduce((s, v) => s + v, 0), counted: best.length, played: pts.length, best };
    })
    .sort((a, b) => b.points - a.points || b.counted - a.counted);
}

/* ---------- course records ---------- */

export interface CourseRecord {
  course: Course;
  gross: number;
  vsCox: number | null;
  holder: string;
  date: string;
}
export function courseRecords(data: AppData, season?: number): CourseRecord[] {
  const names = new Map(data.players.map((p) => [p.id, p.name]));
  const best = new Map<string, CourseRecord>();
  for (const row of scoreRows(data, season)) {
    if (!row.course) continue;
    const cur = best.get(row.course.id);
    if (!cur || row.score.gross_total < cur.gross) {
      best.set(row.course.id, {
        course: row.course,
        gross: row.score.gross_total,
        vsCox: row.vsCox,
        holder: names.get(row.playerId) ?? "?",
        date: row.round.date,
      });
    }
  }
  return [...best.values()].sort((a, b) => a.course.name.localeCompare(b.course.name));
}

/* ---------- birdie counters ---------- */

export function birdieCounts(data: AppData, season?: number) {
  const rows = scoreRows(data, season);
  return data.players
    .map((p) => {
      const mine = rows.filter((r) => r.playerId === p.id);
      return {
        playerId: p.id,
        name: p.name,
        birdies: mine.reduce((s, r) => s + r.birdies, 0),
        coxBirds: mine.reduce((s, r) => s + r.coxBirds, 0),
      };
    })
    .sort((a, b) => b.coxBirds - a.coxBirds || b.birdies - a.birdies);
}

/* ---------- honours (a season, or all-time) ---------- */

export interface Honour {
  label: string;
  name: string;
  detail: string;
}

export function seasonHonours(data: AppData, season: number): Honour[] {
  const names = new Map(data.players.map((p) => [p.id, p.name]));
  const rows = scoreRows(data, season);
  const out: Honour[] = [];
  if (!rows.length) return out;

  const merit = orderOfMerit(data, season).filter((m) => m.played > 0);
  if (merit.length) out.push({ label: "Order of merit", name: merit[0].name, detail: `${merit[0].points} pts from ${merit[0].counted} counting rounds` });

  const bestVs = rows.filter((r) => r.vsCox != null).sort((a, b) => a.vsCox! - b.vsCox!)[0];
  if (bestVs) out.push({ label: "Best round vs Cox Par", name: names.get(bestVs.playerId) ?? "?", detail: `${fmtVs(bestVs.vsCox!)} at ${bestVs.course?.name ?? "?"}` });

  const bestGross = [...rows].sort((a, b) => a.score.gross_total - b.score.gross_total)[0];
  if (bestGross) out.push({ label: "Lowest gross", name: names.get(bestGross.playerId) ?? "?", detail: `${bestGross.score.gross_total} at ${bestGross.course?.name ?? "?"}` });

  const birds = birdieCounts(data, season);
  if (birds[0]?.coxBirds) out.push({ label: "Most Cox Birds", name: birds[0].name, detail: `${birds[0].coxBirds} this season` });
  const realBirds = [...birds].sort((a, b) => b.birdies - a.birdies);
  if (realBirds[0]?.birdies) out.push({ label: "Most real birdies", name: realBirds[0].name, detail: `${realBirds[0].birdies} this season` });

  // most improved — World index at start of season vs end. World is used because a
  // player promoted mid-season would otherwise be measured on two different rulers.
  let bestImp: { name: string; delta: number } | null = null;
  for (const p of data.players) {
    const res = playerResults(data, p.id);
    const start = indexAt(res, "world", `${season - 1}-12-31`);
    const end = indexAt(res, "world", `${season}-12-31`);
    if (start != null && end != null) {
      const delta = start - end;
      if (!bestImp || delta > bestImp.delta) bestImp = { name: p.name, delta };
    }
  }
  if (bestImp && bestImp.delta > 0) out.push({ label: "Most improved", name: bestImp.name, detail: `World index down ${bestImp.delta.toFixed(1)}` });

  // promotions are milestones — they belong in the season they happened
  for (const p of data.players) {
    for (const pr of promotions(playerResults(data, p.id))) {
      if (seasonOf(pr.date) === season) out.push({ label: `Graduated to ${TIER_LABEL[pr.tier]}`, name: p.name, detail: fmtDate(pr.date) });
    }
  }
  return out;
}

export interface AllTimeRecord {
  label: string;
  name: string;
  detail: string;
}

export function allTimeRecords(data: AppData): AllTimeRecord[] {
  const names = new Map(data.players.map((p) => [p.id, p.name]));
  const rows = scoreRows(data);
  const out: AllTimeRecord[] = [];
  if (!rows.length) return out;

  const bestGross = [...rows].filter((r) => r.round.holes === 18).sort((a, b) => a.score.gross_total - b.score.gross_total)[0];
  if (bestGross) out.push({ label: "Best gross round", name: names.get(bestGross.playerId) ?? "?", detail: `${bestGross.score.gross_total} at ${bestGross.course?.name ?? "?"}, ${fmtDate(bestGross.round.date)}` });

  const bestVs = rows.filter((r) => r.vsCox != null).sort((a, b) => a.vsCox! - b.vsCox!)[0];
  if (bestVs) out.push({ label: "Best round vs Cox Par", name: names.get(bestVs.playerId) ?? "?", detail: `${fmtVs(bestVs.vsCox!)} at ${bestVs.course?.name ?? "?"}` });

  // Lowest index ever held — one record per track, and the house tracks only count
  // snapshots recorded while the player was actually on that rung. A player's Cox 45
  // history is frozen as a trophy the moment they graduate; it is never rewritten.
  for (const t of ["cox45", "pro", "whs"] as Tier[]) {
    const kind = TIER_KIND[t];
    let lowest: { name: string; v: number; date: string } | null = null;
    for (const p of data.players) {
      for (const h of indexHistory(playerResults(data, p.id), kind)) {
        if (t !== "whs" && h.tier !== t) continue; // World counts for everyone, always
        if (!lowest || h.value < lowest.v) lowest = { name: p.name, v: h.value, date: h.date };
      }
    }
    if (lowest) out.push({ label: `Lowest ${t === "whs" ? "World" : TIER_LABEL[t]} index ever held`, name: lowest.name, detail: `${lowest.v.toFixed(1)}, ${fmtDate(lowest.date)}` });
  }

  const mostBirds = [...rows].sort((a, b) => b.coxBirds - a.coxBirds)[0];
  if (mostBirds?.coxBirds) out.push({ label: "Most Cox Birds in one round", name: names.get(mostBirds.playerId) ?? "?", detail: `${mostBirds.coxBirds} at ${mostBirds.course?.name ?? "?"}` });

  const run = longestRunAtTop(data);
  if (run) out.push({ label: "Longest run at #1", name: run.name, detail: `${run.days} day${run.days === 1 ? "" : "s"}` });
  return out;
}

/** Walk every round date; whoever holds the lowest World index after that date is #1 (World: same scale for every tier). */
export function longestRunAtTop(data: AppData): { name: string; days: number } | null {
  const dates = [...new Set(data.rounds.map((r) => r.date))].sort();
  if (!dates.length) return null;
  const results = data.players.map((p) => ({ name: p.name, res: playerResults(data, p.id) }));
  let best: { name: string; days: number } | null = null;
  let cur: { name: string; since: string } | null = null;
  const end = today();
  const close = (until: string) => {
    if (!cur) return;
    const days = Math.max(1, Math.round((Date.parse(until) - Date.parse(cur.since)) / 864e5));
    if (!best || days > best.days) best = { name: cur.name, days };
  };
  for (const d of dates) {
    let leader: { name: string; v: number } | null = null;
    for (const p of results) {
      const v = indexAt(p.res, "world", d);
      if (v != null && (!leader || v < leader.v)) leader = { name: p.name, v };
    }
    if (!leader) continue;
    if (!cur || cur.name !== leader.name) {
      close(d);
      cur = { name: leader.name, since: d };
    }
  }
  close(end);
  return best;
}

/* ---------- player detail ---------- */

export function formGuide(data: AppData, playerId: string, n = 5): (number | null)[] {
  return scoreRows(data)
    .filter((r) => r.playerId === playerId)
    .sort((a, b) => b.round.date.localeCompare(a.round.date))
    .slice(0, n)
    .reverse()
    .map((r) => r.vsCox);
}

export function headToHead(data: AppData, a: string, b: string) {
  let aw = 0,
    bw = 0,
    tie = 0,
    n = 0;
  for (const r of data.rounds) {
    const sa = data.scores.find((s) => s.round_id === r.id && s.player_id === a);
    const sb = data.scores.find((s) => s.round_id === r.id && s.player_id === b);
    if (!sa || !sb) continue;
    n++;
    if (sa.gross_total < sb.gross_total) aw++;
    else if (sb.gross_total < sa.gross_total) bw++;
    else tie++;
  }
  return { aw, bw, tie, n };
}

export function seasonsAvailable(data: AppData): number[] {
  const set = new Set(data.rounds.map((r) => seasonOf(r.date)));
  set.add(new Date().getFullYear());
  return [...set].sort((a, b) => b - a);
}

/* ---------- formatting ---------- */

export const fmtVs = (v: number) => (v > 0 ? `+${v}` : v === 0 ? "level" : `${v}`);
export const fmtIdx = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));
export function fmtDate(s: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  if (!s) return "";
  const d = new Date(s + "T12:00:00");
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", opts);
}

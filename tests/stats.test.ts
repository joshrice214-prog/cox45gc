import { test } from "node:test";
import assert from "node:assert/strict";
import { leaderboard, orderOfMerit, courseRecords, birdieCounts, seasonHonours, allTimeRecords, longestRunAtTop } from "../lib/stats";
import type { AppData } from "../lib/types";

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const SI = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 2, 16, 4, 12, 6, 18, 10, 14];

function fixture(): AppData {
  const players = ["Josh", "Owen"].map((n, i) => ({ id: "p" + i, name: n, first_name: n, last_name: null, photo_url: null }));
  const course = { id: "c1", name: "Pinewood", holes: 18, pars: PARS, stroke_index: SI, course_rating: 71, slope: 125 };
  const rounds = [], scores = [];
  for (let i = 0; i < 5; i++) {
    const id = "r" + i;
    rounds.push({ id, course_id: "c1", date: `2026-0${i + 1}-10`, holes: 18, course_rating: 71, slope: 125, event_id: null });
    // Josh: +1 every hole (90) but a birdie on 1 in round 3; Owen: +2 every hole (108)
    const josh = PARS.map((p, h) => (i === 2 && h === 0 ? p - 1 : p + 1));
    const owen = PARS.map((p) => p + 2);
    scores.push({ round_id: id, player_id: "p0", hole_scores: josh, gross_total: josh.reduce((s, v) => s + v, 0) });
    scores.push({ round_id: id, player_id: "p1", hole_scores: owen, gross_total: owen.reduce((s, v) => s + v, 0) });
  }
  return { players, courses: [course], rounds, scores, events: [], rsvps: [], availability: [] };
}

test("leaderboard ranks by cox index and reports counting rounds", () => {
  const b = leaderboard(fixture(), 90);
  assert.equal(b[0].name, "Josh");
  assert.equal(b[0].counting, 5);
  assert.ok(b[0].cox! < b[1].cox!);
  assert.equal(b[0].world, 15.4); // 5 rounds → lowest 1: the 88
});

test("order of merit: best 6, 40 − vs Cox Par", () => {
  const m = orderOfMerit(fixture(), 2026);
  assert.equal(m[0].name, "Josh");
  // Josh: 4 rounds at −18 vs Cox Par (58 pts) + one at −20 (60) → 60+58*4 = 292
  assert.equal(m[0].points, 292);
  assert.equal(m[0].counted, 5);
  // Owen: level with Cox Par → 40 × 5
  assert.equal(m[1].points, 200);
});

test("course records, birdies, honours, all-time", () => {
  const d = fixture();
  const rec = courseRecords(d, 2026);
  assert.equal(rec[0].holder, "Josh");
  assert.equal(rec[0].gross, 88);
  const b = birdieCounts(d, 2026);
  const josh = b.find((x) => x.name === "Josh")!;
  assert.equal(josh.birdies, 1); // one real birdie
  assert.equal(josh.coxBirds, 5 * 18 - 1); // every other hole is par+1 = Cox Bird
  const hon = seasonHonours(d, 2026);
  assert.equal(hon.find((h) => h.label === "Order of merit")!.name, "Josh");
  const all = allTimeRecords(d);
  assert.equal(all.find((h) => h.label === "Best gross round")!.detail.startsWith("88"), true);
  assert.equal(longestRunAtTop(d)!.name, "Josh");
});

/* ---------- the 10-round record gate ---------- */

function ladderFixture(n: number, extra?: { lateGoodRound?: boolean }): AppData {
  // one player, n identical +4 rounds so they stay on Cox 45 the whole way
  const players = [{ id: "p0", name: "Matt", first_name: "Matt", last_name: null, photo_url: null }];
  const course = { id: "c1", name: "Pinewood", holes: 18, pars: PARS, stroke_index: SI, course_rating: 71, slope: 125 };
  const rounds = [], scores = [];
  for (let i = 0; i < n; i++) {
    const id = "r" + i;
    const d = new Date(Date.UTC(2026, 0, 1 + i * 7)).toISOString().slice(0, 10);
    rounds.push({ id, course_id: "c1", date: d, holes: 18, course_rating: 71, slope: 125, event_id: null });
    // round 2 is a fluke (+2/hole = 108); everything else is +4/hole (144)
    const fluke = i === 1;
    const s = PARS.map((p) => p + (fluke ? 2 : 4));
    scores.push({ round_id: id, player_id: "p0", hole_scores: s, gross_total: s.reduce((a, b) => a + b, 0) });
  }
  void extra;
  return { players, courses: [course], rounds, scores, events: [], rsvps: [], availability: [] };
}

test("lowest-index record is withheld before round 10 and awarded from round 10", () => {
  const nine = allTimeRecords(ladderFixture(9));
  const w9 = nine.find((r) => r.label === "Lowest World index ever held")!;
  assert.equal(w9.name, "Not yet earned");
  assert.match(w9.detail, /10 rounds/);

  const ten = allTimeRecords(ladderFixture(10));
  const w10 = ten.find((r) => r.label === "Lowest World index ever held")!;
  assert.equal(w10.name, "Matt");
  // round 10 uses lowest 3 of 10 → (33.4 + 33.4 + 66.0)/3 = 44.3, not the round-3 fluke number
  // (round 3: lowest 1 of 3 − 2 = 33.4 − 2 = 31.4 — that number never becomes a record)
  const v = Number(w10.detail.split(",")[0]);
  assert.ok(v > 31.5, `record ${v} must not be the early fluke 31.4`);
  const c10 = ten.find((r) => r.label === "Lowest Cox 45 index ever held")!;
  assert.equal(c10.name, "Matt");
});

test("single-performance records are not gated", () => {
  const three = allTimeRecords(ladderFixture(3));
  assert.equal(three.find((r) => r.label === "Best gross round")!.name, "Matt");
  assert.ok(three.find((r) => r.label === "Best round vs Cox Par"));
});

test("most improved needs 10 rounds by the start of the season", () => {
  // 12 rounds in 2026 only → start of 2026 has 0 rounds → not eligible even though the index moved
  const d = ladderFixture(12);
  const hon = seasonHonours(d, 2026);
  assert.equal(hon.find((h) => h.label === "Most improved"), undefined);
});

/* ---------- personal bests ---------- */
import { personalBests } from "../lib/handicap";
import { playerResults } from "../lib/stats";

test("personal best on a graduated rung is frozen, ungated, and separate from the club record", () => {
  // 90s → cox −17.4 after 3 rounds → promoted straight through to whs at round 3
  const d = fixture();
  const res = playerResults(d, "p0");
  const pb = personalBests(res);
  const cox = pb.find((b) => b.tier === "cox45")!;
  assert.ok(cox, "graduate keeps a Cox 45 personal best");
  assert.equal(cox.early, true); // set at round 3, before the 10-round gate
  assert.equal(cox.current, false);
  assert.equal(cox.value, -19.2); // round 3 is the 88 → (88−107)×113/125 − 2
  // club record is still gated: five rounds is not enough for anyone
  const rec = allTimeRecords(d).find((r) => r.label === "Lowest Cox 45 index ever held")!;
  assert.equal(rec.name, "Not yet earned");
  // the promotion honour carries the number
  const hon = seasonHonours(d, 2026).find((h) => h.label.startsWith("Graduated to"))!;
  assert.match(hon.detail, /personal-best .* index -19\.2†/);
});

test("a player who never graduates has only their current rung", () => {
  const pb = personalBests(playerResults(ladderFixture(6), "p0"));
  assert.deepEqual(pb.map((b) => b.tier), ["cox45"]);
  assert.equal(pb[0].current, true);
});

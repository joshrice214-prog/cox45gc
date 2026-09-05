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

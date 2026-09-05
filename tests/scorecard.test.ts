import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJSON, normalise, validate, serious } from "../lib/scorecard";

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const SI = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 2, 16, 4, 12, 6, 18, 10, 14];

test("extractJSON strips fences and prose", () => {
  const j = extractJSON('Sure! ```json\n{"a":1}\n```') as { a: number };
  assert.equal(j.a, 1);
});

test("clean card validates with no issues", () => {
  const raw = {
    course: "Pinewood", date: "2026-09-05", holes: 18, pars: PARS, strokeIndex: SI, parTotal: 72,
    players: [{ name: "josh", scores: PARS.map((p) => p + 1), out: 45, in: 45, total: 90, confidence: "high" }],
  };
  const p = normalise(raw, ["Josh", "Owen"], []);
  assert.equal(p.players[0].name, "Josh");
  assert.equal(p.players[0].gross, 90);
  assert.deepEqual(validate(p), []);
});

test("checksums catch bad totals, pars and stroke index", () => {
  const raw = {
    holes: 18, pars: [...PARS.slice(0, 17), 9], strokeIndex: [...SI.slice(0, 17), 7], parTotal: 72,
    players: [{ name: "Owen", scores: PARS.map((p) => p + 1), total: 95, confidence: "low" }],
  };
  const issues = validate(normalise(raw, [], []));
  const msgs = issues.map((i) => i.m).join("\n");
  assert.match(msgs, /par value looks wrong/);
  assert.match(msgs, /Pars add up to/);
  assert.match(msgs, /duplicate/);
  assert.match(msgs, /holes add to 90 but the card's total says 95/);
  assert.match(msgs, /low confidence/);
  assert.ok(serious(issues).length >= 4);
});

test("known course fills in rating, pars and SI", () => {
  const p = normalise({ course: "pinewood", holes: 18, pars: [], players: [] }, [], [{ name: "Pinewood", holes: 18, pars: PARS, stroke_index: SI, course_rating: 70.8, slope: 121 }]);
  assert.equal(p.course, "Pinewood");
  assert.equal(p.courseRating, 70.8);
  assert.equal(p.slope, 121);
  assert.deepEqual(p.pars, PARS);
  assert.deepEqual(p.strokeIndex, SI);
});

test("nine-hole card is padded and typed as 9", () => {
  const p = normalise({ holes: 9, pars: PARS.slice(0, 9), players: [{ name: "Ed", scores: [5, 5, 4, 6, 5, 5, 4, 5, 6], total: 45 }] }, ["Ed"], []);
  assert.equal(p.holes, 9);
  assert.equal(p.pars.length, 9);
  assert.equal(p.players[0].gross, 45);
});

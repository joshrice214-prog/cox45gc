import { test } from "node:test";
import assert from "node:assert/strict";
import { findDuplicateRounds, strongDuplicates } from "../lib/duplicates";
import type { AppData } from "../lib/types";

function fixture(): AppData {
  return {
    players: [
      { id: "p1", name: "Josh", first_name: "Josh", last_name: null, photo_url: null },
      { id: "p2", name: "Owen", first_name: "Owen", last_name: null, photo_url: null },
      { id: "p3", name: "Matt", first_name: "Matt", last_name: null, photo_url: null },
    ],
    courses: [
      { id: "c1", name: "Pinewood", holes: 18, pars: [], stroke_index: [], course_rating: 71, slope: 125 },
      { id: "c2", name: "Pinewood", holes: 9, pars: [], stroke_index: [], course_rating: 35.5, slope: 125 },
    ],
    rounds: [
      { id: "r1", course_id: "c1", date: "2026-09-05", holes: 18, course_rating: 71, slope: 125, event_id: null },
      { id: "r2", course_id: "c1", date: "2026-09-06", holes: 18, course_rating: 71, slope: 125, event_id: null },
    ],
    scores: [
      { round_id: "r1", player_id: "p1", hole_scores: [], gross_total: 90 },
      { round_id: "r1", player_id: "p2", hole_scores: [], gross_total: 108 },
    ],
    events: [],
    rsvps: [],
    availability: [],
  };
}

test("no match on a different date", () => {
  const m = findDuplicateRounds(fixture(), "Pinewood", 18, "2026-09-07", ["Josh"]);
  assert.equal(m.length, 0);
});

test("no match on a different course name", () => {
  const m = findDuplicateRounds(fixture(), "Oakhill", 18, "2026-09-05", ["Josh"]);
  assert.equal(m.length, 0);
});

test("holes distinguishes an 18-hole card from a 9-hole card at the same course", () => {
  const m = findDuplicateRounds(fixture(), "Pinewood", 9, "2026-09-05", ["Josh"]);
  assert.equal(m.length, 0);
});

test("course name matching is case- and whitespace-insensitive", () => {
  const m = findDuplicateRounds(fixture(), "  pinewood ", 18, "2026-09-05", ["Josh"]);
  assert.equal(m.length, 1);
});

test("same course+date with no shared player is a weak match only", () => {
  const m = findDuplicateRounds(fixture(), "Pinewood", 18, "2026-09-05", ["Matt", "Ed"]);
  assert.equal(m.length, 1);
  assert.equal(m[0].overlap.length, 0);
  assert.equal(strongDuplicates(m).length, 0);
});

test("a shared player name is a strong match and reports existing scores", () => {
  const m = findDuplicateRounds(fixture(), "Pinewood", 18, "2026-09-05", ["josh", "Matt"]);
  const strong = strongDuplicates(m);
  assert.equal(strong.length, 1);
  assert.deepEqual(strong[0].overlap, ["Josh"]);
  assert.deepEqual(
    strong[0].players.map((p) => p.gross),
    [90, 108],
  );
});

test("two genuine tee times on different dates never collide", () => {
  const m1 = findDuplicateRounds(fixture(), "Pinewood", 18, "2026-09-05", ["Josh"]);
  const m2 = findDuplicateRounds(fixture(), "Pinewood", 18, "2026-09-07", ["Josh"]);
  assert.equal(m1.length, 1);
  assert.equal(m2.length, 0); // nothing at all logged on the 7th
});

test("an empty round on the target date is a weak match with no players to compare", () => {
  // r2 exists on 2026-09-06 at the same course but has no scores logged yet
  const m = findDuplicateRounds(fixture(), "Pinewood", 18, "2026-09-06", ["Josh"]);
  assert.equal(m.length, 1);
  assert.equal(m[0].players.length, 0);
  assert.equal(strongDuplicates(m).length, 0);
});

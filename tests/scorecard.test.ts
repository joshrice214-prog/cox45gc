import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJSON, normalise, validate, serious, normaliseStrokeIndexForStorage, parseCardDate, mergeSecondPass, canonicalCourseName, findCourse, suggestCourse, tidyCourseName, preSaveError } from "../lib/scorecard";

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
  assert.deepEqual(serious(validate(p)), []); // only the "no rating on the card" note remains, by design
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

test("18Birdies-style unlabelled rating/slope pair is un-swapped if backwards", () => {
  // e.g. "Yellow 3121 yds (121.0/35.4)" misread with rating and slope transposed
  const p = normalise({ holes: 9, pars: [5, 4, 4, 3, 5, 4, 4, 3, 4], courseRating: 121, slope: 35.4, players: [] }, [], []);
  assert.equal(p.slope, 121);
  assert.equal(p.courseRating, 35.4);
});

test("18Birdies HANDICAP row maps straight to stroke index, correctly ordered", () => {
  const raw = {
    course: "Edwalton Golf Club", date: "2024-09-14", holes: 9,
    pars: [5, 4, 4, 3, 5, 4, 4, 3, 4],
    strokeIndex: [5, 1, 3, 13, 11, 7, 17, 15, 9],
    courseRating: 35.4, slope: 121,
    players: [{ name: "Josh", scores: [8, 5, 7, 7, 10, 8, 5, 6, 10], total: 66, confidence: "high" }],
  };
  const p = normalise(raw, ["Josh"], []);
  assert.equal(p.holes, 9);
  assert.equal(p.courseRating, 35.4);
  assert.equal(p.slope, 121);
  assert.equal(p.players[0].gross, 66);
  assert.deepEqual(validate(p), []);
  // the card's printed 1–17 odd numbering is left untouched for review...
  assert.deepEqual(p.strokeIndex, [5, 1, 3, 13, 11, 7, 17, 15, 9]);
  // ...and converted to a plain 1–9 relative rank only at save time
  assert.deepEqual(normaliseStrokeIndexForStorage(p.strokeIndex, 9), [3, 1, 2, 7, 6, 4, 9, 8, 5]);
});

test("stroke index reranking leaves an already-1-9 card untouched", () => {
  const si = [7, 3, 5, 1, 9, 4, 8, 2, 6];
  assert.deepEqual(normaliseStrokeIndexForStorage(si, 9), si);
});

test("stroke index reranking skips an incomplete or invalid card", () => {
  assert.deepEqual(normaliseStrokeIndexForStorage([1, 2, null, 4, 5, 6, 7, 8, 9], 9), [1, 2, null, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(normaliseStrokeIndexForStorage([1, 1, 3, 4, 5, 6, 7, 8, 9], 9), [1, 1, 3, 4, 5, 6, 7, 8, 9]);
});

test("nine-hole card is padded and typed as 9", () => {
  const p = normalise({ holes: 9, pars: PARS.slice(0, 9), players: [{ name: "Ed", scores: [5, 5, 4, 6, 5, 5, 4, 5, 6], total: 45 }] }, ["Ed"], []);
  assert.equal(p.holes, 9);
  assert.equal(p.pars.length, 9);
  assert.equal(p.players[0].gross, 45);
});

test("UK-first date parsing: ambiguous numeric dates read as DD/MM, not American", () => {
  assert.equal(parseCardDate("14/09/2024", "x"), "2024-09-14");
  assert.equal(parseCardDate("04/05/2026", "x"), "2026-05-04"); // 4 May, not April 5th
  assert.equal(parseCardDate("1/2/2026", "x"), "2026-02-01"); // 1 Feb, not Jan 2nd
});

test("date parsing falls back to month-first only when day-first is impossible", () => {
  assert.equal(parseCardDate("05/13/2026", "x"), "2026-05-13"); // 13 can't be a month
});

test("date parsing handles ISO and spelled-out months, and dots/dashes", () => {
  assert.equal(parseCardDate("2024-09-14", "x"), "2024-09-14");
  assert.equal(parseCardDate("14 Sep 2024", "x"), "2024-09-14");
  assert.equal(parseCardDate("September 14, 2024", "x"), "2024-09-14");
  assert.equal(parseCardDate("14.09.2024", "x"), "2024-09-14");
  assert.equal(parseCardDate("14-09-2024", "x"), "2024-09-14");
});

test("date parsing falls back cleanly on nonsense or missing input", () => {
  assert.equal(parseCardDate(null, "2026-01-01"), "2026-01-01");
  assert.equal(parseCardDate("", "2026-01-01"), "2026-01-01");
  assert.equal(parseCardDate("not a date", "2026-01-01"), "2026-01-01");
  assert.equal(parseCardDate("32/13/2026", "2026-01-01"), "2026-01-01");
});

test("a solo card with no printed name is filled in with the importer's name", () => {
  const raw = { holes: 9, pars: [5, 4, 4, 3, 5, 4, 4, 3, 4], players: [{ scores: [8, 5, 7, 7, 10, 8, 5, 6, 10], total: 66 }] };
  const p = normalise(raw, ["Josh", "Owen", "Matt", "Ed"], [], "Josh");
  assert.equal(p.players[0].name, "Josh");
});

test("two unnamed players on one card are left blank, not both given the importer's name", () => {
  const raw = { holes: 9, pars: [5, 4, 4, 3, 5, 4, 4, 3, 4], players: [{ scores: Array(9).fill(5), total: 45 }, { scores: Array(9).fill(6), total: 54 }] };
  const p = normalise(raw, [], [], "Josh");
  assert.equal(p.players[0].name, "");
  assert.equal(p.players[1].name, "");
});

test("importer's name is not applied when the card already names its one player", () => {
  const raw = { holes: 9, pars: [5, 4, 4, 3, 5, 4, 4, 3, 4], players: [{ name: "Ed", scores: Array(9).fill(5), total: 45 }] };
  const p = normalise(raw, ["Josh", "Ed"], [], "Josh");
  assert.equal(p.players[0].name, "Ed");
});

/* ---------- review round 2 ---------- */

const P9 = [5, 4, 4, 3, 5, 4, 4, 3, 4];

test("a partly-read card never produces a gross from the holes that happen to be present", () => {
  const partial = { holes: 9, pars: P9, players: [{ name: "Josh", scores: [5, 4, null, 4, 5, null, 4, 3, 4], total: null }] };
  assert.equal(normalise(partial, ["Josh"], []).players[0].gross, null);
  const withPrinted = { holes: 9, pars: P9, players: [{ name: "Josh", scores: [5, 4, null, 4, 5, null, 4, 3, 4], total: 44 }] };
  assert.equal(normalise(withPrinted, ["Josh"], []).players[0].gross, 44);
});

test("pre-save refuses a partial card, a blank par, a missing course", () => {
  const ok = normalise({ course: "Edwalton", date: "14/09/2024", holes: 9, pars: P9, players: [{ name: "Josh", scores: P9.map((p) => p + 1), total: 45 }] }, ["Josh"], []);
  assert.equal(preSaveError(ok), null);
  const partial = { ...ok, players: [{ ...ok.players[0], scores: [5, null, 5, 4, 6, 5, 5, 4, 5], gross: 45 }] };
  assert.match(preSaveError(partial)!, /1 hole is blank/);
  const noPar = { ...ok, pars: [5, 4, null, 3, 5, 4, 4, 3, 4] };
  assert.match(preSaveError(noPar)!, /par/);
  assert.match(preSaveError({ ...ok, course: "" })!, /course a name/);
});

test("second pass merge keeps first-pass fields the second pass dropped", () => {
  const first = { course: "Edwalton Golf Club", date: "14/09/2024", holes: 9, tee: "Yellow", pars: P9, strokeIndex: [5, 1, 3, 13, 11, 7, 17, 15, 9], courseRating: 35.4, slope: 121, players: [{ name: "", scores: [8, 5, 7, 7, 10, 8, 5, 6, 10], total: 66 }] };
  const second = { course: "Edwalton Golf Club", holes: 9, pars: P9, strokeIndex: [5, 1, 3, 13, 11, 7, 17, 15, 9], players: [{ name: "", scores: [8, 5, 7, 7, 10, 8, 5, 6, 10], total: 66, confidence: "high" }] };
  const merged = mergeSecondPass(first, second);
  assert.equal(merged.date, "14/09/2024");
  assert.equal(merged.courseRating, 35.4);
  assert.equal(merged.slope, 121);
  assert.equal(merged.tee, "Yellow");
  const p = normalise(merged, ["Josh"], [], "Josh");
  assert.equal(p.date, "2024-09-14");
  assert.equal(p.courseRating, 35.4);
  assert.equal(p.players[0].name, "Josh");
});

test("second pass merge does take corrections the second pass made", () => {
  const first = { course: "X", date: "1/1/2025", holes: 9, pars: P9, strokeIndex: [3, 1, 2, 7, 6, 4, 9, 8, 5], courseRating: 35.4, slope: 121, players: [{ name: "Ed", scores: [5, 5, 5, 5, 5, 5, 5, 5, 9], total: 45 }] };
  const second = { ...first, players: [{ name: "Ed", scores: [5, 5, 5, 5, 5, 5, 5, 5, 5], total: 45 }] };
  const p = normalise(mergeSecondPass(first, second), [], []);
  assert.equal(p.players[0].gross, 45);
  assert.deepEqual(validate(p).filter((i) => i.t !== "note"), []);
});

test("course names match across the decoration cards put on them", () => {
  assert.equal(canonicalCourseName("EDWALTON GOLF CLUB (EDWALTON (9 HOLES))"), "edwalton");
  assert.equal(canonicalCourseName("Edwalton GC - Yellow tees"), "edwalton");
  assert.equal(canonicalCourseName("Edwalton Golf Course"), "edwalton");
  assert.equal(tidyCourseName("EDWALTON GOLF CLUB (EDWALTON (9 HOLES))"), "EDWALTON GOLF CLUB");
  const courses = [{ id: "1", name: "Edwalton Golf Club", holes: 9 }, { id: "2", name: "Edwalton Golf Club", holes: 18 }, { id: "3", name: "Wollaton Park", holes: 18 }];
  assert.equal(findCourse(courses, "edwalton golf club (9 holes)", 9)?.id, "1");
  assert.equal(findCourse(courses, "Edwalton", 18)?.id, "2");
  assert.equal(findCourse(courses, "Edwalton", 18)?.id, "2");
  assert.equal(findCourse(courses, "Bramcote", 18), undefined);
  assert.equal(suggestCourse(courses, "Wollaton", 18)?.id, "3");
  assert.equal(suggestCourse(courses, "Wollaton Park", 18), undefined); // exact match isn't a suggestion
});

test("a read card resolves to the stored course name, and takes its rating when the card has none", () => {
  const known = [{ name: "Edwalton Golf Club", holes: 9, pars: P9, stroke_index: [3, 1, 2, 7, 6, 4, 9, 8, 5], course_rating: 35.4, slope: 121 }];
  const p = normalise({ course: "EDWALTON GOLF CLUB (EDWALTON (9 HOLES))", holes: 9, pars: P9, players: [] }, [], known);
  assert.equal(p.course, "Edwalton Golf Club");
  assert.equal(p.slope, 121);
  assert.equal(p.ratingSource, "course");
});

test("unparseable or missing dates and missing ratings are said out loud", () => {
  const bad = normalise({ holes: 9, pars: P9, date: "yesterday-ish", players: [] }, [], []);
  assert.equal(bad.dateOk, false);
  assert.match(validate(bad).find((i) => i.t === "date")!.m, /yesterday-ish/);
  const none = normalise({ holes: 9, pars: P9, players: [] }, [], []);
  assert.equal(none.dateOk, true);
  assert.ok(validate(none).some((i) => i.t === "note" && /No date/.test(i.m)));
  assert.ok(validate(none).some((i) => i.t === "note" && /rating/.test(i.m)));
  // a missing rating is a note, not something that triggers a second read
  assert.ok(!serious(validate(none)).some((i) => /rating/.test(i.m)));
});

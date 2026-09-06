import { test } from "node:test";
import assert from "node:assert/strict";
import {
  whsRule,
  indexFromDifferentials,
  courseHandicap,
  strokesOnHole,
  differential,
  coxAdjustedRating,
  coxPar,
  coxCategory,
  computePlayer,
  round1,
  currentTier,
  houseIndex,
  promotions,
  tierAt,
  type RoundInput,
} from "../lib/handicap";

const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5]; // 72
const SI = [7, 3, 15, 1, 11, 5, 17, 9, 13, 8, 2, 16, 4, 12, 6, 18, 10, 14];

function mk(id: string, date: string, scores: number[], opts: Partial<RoundInput> = {}): RoundInput {
  return {
    id,
    date,
    holes: 18,
    pars: PARS,
    strokeIndex: SI,
    courseRating: 71.0,
    slope: 125,
    scores,
    grossTotal: scores.reduce((s, v) => s + v, 0),
    ...opts,
  };
}

test("WHS table", () => {
  assert.deepEqual(whsRule(3), { use: 1, adjust: -2 });
  assert.deepEqual(whsRule(4), { use: 1, adjust: -1 });
  assert.deepEqual(whsRule(5), { use: 1, adjust: 0 });
  assert.deepEqual(whsRule(6), { use: 2, adjust: -1 });
  assert.deepEqual(whsRule(7), { use: 2, adjust: 0 });
  assert.deepEqual(whsRule(9), { use: 2, adjust: 0 });
  assert.deepEqual(whsRule(10), { use: 3, adjust: 0 });
  assert.deepEqual(whsRule(11), { use: 3, adjust: 0 });
  assert.deepEqual(whsRule(12), { use: 4, adjust: 0 });
  assert.deepEqual(whsRule(14), { use: 4, adjust: 0 });
  assert.deepEqual(whsRule(15), { use: 5, adjust: 0 });
  assert.deepEqual(whsRule(16), { use: 5, adjust: 0 });
  assert.deepEqual(whsRule(17), { use: 6, adjust: 0 });
  assert.deepEqual(whsRule(18), { use: 6, adjust: 0 });
  assert.deepEqual(whsRule(19), { use: 7, adjust: 0 });
  assert.deepEqual(whsRule(20), { use: 8, adjust: 0 });
  assert.deepEqual(whsRule(25), { use: 8, adjust: 0 });
});

test("index from differentials", () => {
  assert.equal(indexFromDifferentials([10, 12]), null);
  assert.equal(indexFromDifferentials([10, 12, 14]), 8.0); // lowest 1 − 2
  assert.equal(indexFromDifferentials([10, 12, 14, 9]), 8.0); // lowest 1 − 1
  assert.equal(indexFromDifferentials([10, 12, 14, 9, 11]), 9.0);
  assert.equal(indexFromDifferentials([10, 12, 14, 9, 11, 13]), 8.5); // avg(9,10) − 1
  // 20+ uses only the most recent 20
  const diffs = [50, ...Array.from({ length: 20 }, (_, i) => 10 + i)];
  const recent = diffs.slice(-20);
  const exp = round1(recent.sort((a, b) => a - b).slice(0, 8).reduce((s, v) => s + v, 0) / 8);
  assert.equal(indexFromDifferentials(diffs), exp);
});

test("rounding to one decimal", () => {
  assert.equal(round1(8.45), 8.5);
  assert.equal(round1(8.44), 8.4);
  assert.equal(round1(-1.25), -1.3);
});

test("ratings", () => {
  assert.equal(coxAdjustedRating(70.8, 18), 106.8);
  assert.equal(coxAdjustedRating(35.2, 9), 53.2);
  assert.equal(coxPar(72, 18), 108);
});

test("course handicap", () => {
  assert.equal(courseHandicap(12.4, 125, 71.0, 72, 18), 13); // 13.72 − 1 = 12.72 → 13
  // cox: cox-adjusted rating vs real par → lands equal to world (−23.6 index ≈ 12.4 − 36×113/125)
  assert.equal(courseHandicap(-20.1, 125, 107.0, 72, 18), 13);
  assert.equal(courseHandicap(12.4, 125, 35.5, 36, 9), 6); // half index for 9
});

test("stroke allocation", () => {
  assert.equal(strokesOnHole(13, 1, 18), 1);
  assert.equal(strokesOnHole(13, 13, 18), 1);
  assert.equal(strokesOnHole(13, 14, 18), 0);
  assert.equal(strokesOnHole(20, 2, 18), 2);
  assert.equal(strokesOnHole(20, 3, 18), 1);
  assert.equal(strokesOnHole(36, 18, 18), 2);
  assert.equal(strokesOnHole(0, 1, 18), 0);
  assert.equal(strokesOnHole(-2, 18, 18), -1);
  assert.equal(strokesOnHole(-2, 17, 18), -1);
  assert.equal(strokesOnHole(-2, 16, 18), 0);
  assert.equal(strokesOnHole(5, 5, 9), 1);
  assert.equal(strokesOnHole(5, 6, 9), 0);
});

test("differential and 9-hole doubling", () => {
  assert.equal(differential(90, 71, 125, 18), ((90 - 71) * 113) / 125);
  assert.equal(differential(45, 35.5, 125, 9), (((45 - 35.5) * 113) / 125) * 2);
});

test("cox categories", () => {
  assert.equal(coxCategory(4, 4).label, "Cox Eagle");
  assert.equal(coxCategory(5, 4).label, "Cox Bird");
  assert.equal(coxCategory(6, 4).label, "Cox Par");
  assert.equal(coxCategory(7, 4).label, "Cox Bogey");
  assert.equal(coxCategory(8, 4).label, "Cox Double");
  assert.equal(coxCategory(9, 4).label, "Cox +3");
});

test("no cap for first three rounds, cap from round four using prior index", () => {
  const steady = PARS.map((p) => p + 1); // 90 gross
  const blowup = PARS.map((p, i) => (i === 0 ? p + 8 : p + 1)); // one disaster hole
  const rs = [
    mk("a", "2026-01-01", steady),
    mk("b", "2026-01-08", steady),
    mk("c", "2026-01-15", steady),
    mk("d", "2026-01-22", blowup),
  ];
  const res = computePlayer(rs);
  assert.equal(res[0].world.capApplied, false);
  assert.equal(res[2].world.capApplied, false);
  assert.equal(res[2].world.indexAfter, round1(((90 - 71) * 113) / 125 - 2)); // 17.176−2 = 15.2
  assert.equal(res[3].world.capApplied, true);
  assert.equal(res[3].world.indexBefore, res[2].world.indexAfter);
  // world CH = round(15.2*125/113 + (71-72)) = round(16.8-1)= 16 → SI 7 gets 1 stroke → cap 4+2+1=7
  assert.equal(res[3].world.courseHandicap, 16);
  assert.equal(res[3].world.holes[0].capped, 7);
  assert.equal(res[3].world.holes[0].wasCapped, true);
  assert.equal(res[3].world.holes[1].wasCapped, false);
  // cox cap on hole 1 = par + 4 + strokes = 4+4+1 = 9
  assert.equal(res[3].cox.holes[0].capped, 9);
  assert.equal(res[3].cox.holes[0].wasCapped, true);
  // cox CH uses cox index vs cox rating/par
  const coxIdx = res[2].cox.indexAfter!;
  assert.equal(res[3].cox.courseHandicap, Math.round((coxIdx * 125) / 113 + (107 - 72)));
  assert.equal(res[3].cox.courseHandicap, res[3].world.courseHandicap);
  // adjusted gross reflects the cap
  assert.equal(res[3].world.adjustedGross, 90 + 7 - 5);
  assert.equal(res[3].cox.adjustedGross, 90 + 9 - 5);
});

test("cox index equals world index minus the 36-stroke shift on differentials", () => {
  const rs = Array.from({ length: 5 }, (_, i) => mk("r" + i, `2026-02-0${i + 1}`, PARS.map((p) => p + 1)));
  const res = computePlayer(rs);
  const last = res[4];
  // (90−71)*113/125 vs (90−107)*113/125 → world 17.18, cox −15.37
  assert.equal(last.world.indexAfter, 17.2);
  assert.equal(last.cox.indexAfter, -15.4);
});

test("rounds without rating do not count but keep the index", () => {
  const rs = [
    mk("a", "2026-01-01", PARS.map((p) => p + 1)),
    mk("b", "2026-01-08", PARS.map((p) => p + 1)),
    mk("c", "2026-01-15", PARS.map((p) => p + 1)),
    mk("d", "2026-01-22", PARS.map((p) => p + 1), { courseRating: null }),
  ];
  const res = computePlayer(rs);
  assert.equal(res[3].counting, false);
  assert.equal(res[3].world.indexAfter, res[2].world.indexAfter);
});

test("nine-hole round doubles and stands alone", () => {
  const pars9 = PARS.slice(0, 9); // 36
  const si9 = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const r9 = mk("n", "2026-03-01", pars9.map((p) => p + 1), {
    holes: 9,
    pars: pars9,
    strokeIndex: si9,
    courseRating: 35.5,
    slope: 125,
  });
  const res = computePlayer([r9]);
  assert.equal(res[0].world.differential, (((45 - 35.5) * 113) / 125) * 2);
  assert.equal(res[0].cox.differential, (((45 - 53.5) * 113) / 125) * 2);
});

test("pro track pads +1 per hole and caps at Par+3", () => {
  const steady = PARS.map((p) => p + 1);
  const blowup = PARS.map((p, i) => (i === 0 ? p + 8 : p + 1));
  const res = computePlayer([
    mk("a", "2026-01-01", steady), mk("b", "2026-01-08", steady), mk("c", "2026-01-15", steady), mk("d", "2026-01-22", blowup),
  ]);
  // pro differential = (90 − (71+18)) × 113/125
  assert.equal(res[0].pro.differential, ((90 - 89) * 113) / 125);
  assert.equal(res[3].pro.courseHandicap, res[3].world.courseHandicap);
  assert.equal(res[3].pro.holes[0].capped, 4 + 3 + 1);
  assert.equal(res[3].pro.holes[0].wasCapped, true);
});

test("ladder: cox45 → pro at −10.5, pro → whs at −1.0, ratchets only", () => {
  // 90s every time: cox index after 3 = −17.4 (≤ −10.5 → Pro immediately);
  // pro index after 3 = 0.9−2 = −1.1 (≤ −1.0 → WHS in the same round)
  const steady = PARS.map((p) => p + 1);
  const res = computePlayer([mk("a", "2026-01-01", steady), mk("b", "2026-01-08", steady), mk("c", "2026-01-15", steady)]);
  assert.equal(res[1].tierAfter, "cox45");
  assert.equal(res[2].tierBefore, "cox45");
  assert.equal(res[2].tierAfter, "whs");
  assert.equal(res[2].promotedTo, "whs");
  assert.equal(currentTier(res), "whs");
  assert.equal(houseIndex(res).kind, "world");

  // a much worse golfer stays put, then climbs once and never drops
  const bad = PARS.map((p) => p + 4); // 144 → cox diff (144−107)×113/125 = 33.4
  const good = PARS.map((p) => p + 1);
  const rs2 = computePlayer([
    mk("1", "2026-01-01", bad), mk("2", "2026-01-02", bad), mk("3", "2026-01-03", bad), // cox idx 31.4
    mk("4", "2026-01-04", good), mk("5", "2026-01-05", good), // 5 rounds: lowest 1 → 90 capped? cap on from round 4
  ]);
  assert.equal(rs2[2].tierAfter, "cox45");
  // check it never goes backwards
  let seen: string[] = rs2.map((r) => r.tierAfter);
  const order = { cox45: 0, pro: 1, whs: 2 };
  for (let i = 1; i < seen.length; i++) assert.ok(order[seen[i] as keyof typeof order] >= order[seen[i - 1] as keyof typeof order]);
  assert.deepEqual(promotions(res).map((p) => p.tier), ["whs"]);
  assert.equal(tierAt(res, "2026-01-10"), "cox45");
  assert.equal(tierAt(res, "2026-01-20"), "whs");
});

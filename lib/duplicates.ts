import type { AppData, Course, Round } from "./types";
import { findCourse } from "./scorecard";

export interface DuplicateMatch {
  round: Round;
  course: Course;
  /** every player already logged against that round, name + gross */
  players: { name: string; gross: number }[];
  /** names from the candidate list that already appear on this round (case-insensitive) */
  overlap: string[];
}

/**
 * Rounds already on record for the same course + holes + date as the one
 * about to be saved. `overlap` is the stronger signal: a name shared between
 * the existing round and the one being saved usually means the same round
 * was photographed and uploaded twice, rather than two genuine tee times.
 * Matching is done on names as typed in the review screen, before they're
 * resolved to player ids (that resolution only happens at save time).
 */
export function findDuplicateRounds(data: AppData, courseName: string, holes: number, date: string, candidateNames: string[]): DuplicateMatch[] {
  if (!courseName.trim() || !date) return [];
  const course = findCourse(data.courses, courseName, holes);
  if (!course) return [];

  const wanted = new Set(candidateNames.map((n) => n.trim().toLowerCase()).filter(Boolean));

  return data.rounds
    .filter((r) => r.course_id === course.id && r.date === date)
    .map((r) => {
      const scores = data.scores.filter((s) => s.round_id === r.id);
      const players = scores.map((s) => ({
        name: data.players.find((p) => p.id === s.player_id)?.name ?? "?",
        gross: s.gross_total,
      }));
      const overlap = players.filter((p) => wanted.has(p.name.toLowerCase())).map((p) => p.name);
      return { round: r, course, players, overlap };
    });
}

/** The subset worth interrupting the save for — same course/date AND a shared player. */
export function strongDuplicates(matches: DuplicateMatch[]): DuplicateMatch[] {
  return matches.filter((m) => m.overlap.length > 0);
}

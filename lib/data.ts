import { supabase } from "./supabase";
import type { AppData, Course, GolfEvent, Player, Round, RoundScore, RsvpStatus } from "./types";
import { playerResults } from "./stats";
import { findCourse, normaliseStrokeIndexForStorage } from "./scorecard";

export async function loadAll(): Promise<AppData> {
  const sb = supabase();
  const [players, courses, rounds, scores, events, rsvps, availability] = await Promise.all([
    sb.from("players").select("*").order("created_at"),
    sb.from("courses").select("*").order("name"),
    sb.from("rounds").select("*").order("date"),
    sb.from("round_scores").select("*"),
    sb.from("events").select("*").order("date"),
    sb.from("rsvps").select("*"),
    sb.from("availability").select("*"),
  ]);
  const err = [players, courses, rounds, scores, events, rsvps, availability].find((r) => r.error)?.error;
  if (err) throw new Error(err.message);
  return {
    players: (players.data ?? []) as Player[],
    courses: (courses.data ?? []).map(normCourse),
    rounds: (rounds.data ?? []).map(normRound),
    scores: (scores.data ?? []) as RoundScore[],
    events: (events.data ?? []) as GolfEvent[],
    rsvps: (rsvps.data ?? []) as { event_id: string; player_id: string; status: RsvpStatus }[],
    availability: (availability.data ?? []).map((a: { player_id: string; month: string; dates: string[] }) => ({
      ...a,
      dates: (a.dates ?? []).map((d: string) => String(d).slice(0, 10)),
    })),
  };
}

function normCourse(c: Course): Course {
  return {
    ...c,
    course_rating: c.course_rating == null ? null : Number(c.course_rating),
    slope: c.slope == null ? null : Number(c.slope),
    pars: c.pars ?? [],
    stroke_index: c.stroke_index ?? [],
  };
}
function normRound(r: Round): Round {
  return {
    ...r,
    date: String(r.date).slice(0, 10),
    course_rating: r.course_rating == null ? null : Number(r.course_rating),
    slope: r.slope == null ? null : Number(r.slope),
  };
}

/* ---------- players / profile ---------- */

export async function upsertPlayer(p: Partial<Player> & { name: string }): Promise<Player> {
  const { data, error } = await supabase().from("players").upsert(p, { onConflict: "name" }).select().single();
  if (error) throw new Error(error.message);
  return data as Player;
}

export async function uploadAvatar(playerId: string, blob: Blob): Promise<string> {
  const sb = supabase();
  const path = `${playerId}.jpg`;
  const { error } = await sb.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from("avatars").getPublicUrl(path);
  const url = `${data.publicUrl}?v=${Date.now()}`;
  const { error: e2 } = await sb.from("players").update({ photo_url: url }).eq("id", playerId);
  if (e2) throw new Error(e2.message);
  return url;
}

/* ---------- rounds ---------- */

export interface SaveRoundInput {
  course: { id?: string; name: string; holes: 9 | 18; pars: number[]; strokeIndex: (number | null)[]; courseRating: number | null; slope: number | null };
  date: string;
  eventId?: string | null;
  players: { name: string; scores: (number | null)[]; gross: number }[];
  /**
   * By default an existing course only has its blanks filled in — one card
   * must never silently rewrite the pars/SI/rating every earlier round at that
   * course depends on. The review screen sets this when someone has looked at
   * the difference and chosen the card's values.
   */
  overwriteCourse?: boolean;
}

const fullPars = (a: (number | null)[] | undefined, holes: number) => !!a && a.length === holes && a.every((v) => v != null);

export async function saveRound(input: SaveRoundInput, data: AppData): Promise<string> {
  const sb = supabase();
  const existing = findCourse(data.courses, input.course.name, input.course.holes);
  const cardSI = normaliseStrokeIndexForStorage(input.course.strokeIndex, input.course.holes);
  const keep = !!existing && !input.overwriteCourse;
  const coursePayload = {
    name: existing?.name ?? input.course.name.trim(),
    holes: input.course.holes,
    pars: keep && fullPars(existing.pars, input.course.holes) ? existing.pars : input.course.pars,
    stroke_index: keep && fullPars(existing.stroke_index, input.course.holes) ? existing.stroke_index : cardSI,
    course_rating: keep ? existing.course_rating ?? input.course.courseRating : input.course.courseRating ?? existing?.course_rating ?? null,
    slope: keep ? existing.slope ?? input.course.slope : input.course.slope ?? existing?.slope ?? null,
  };
  const { data: course, error: ce } = existing
    ? await sb.from("courses").update(coursePayload).eq("id", existing.id).select().single()
    : await sb.from("courses").insert(coursePayload).select().single();
  if (ce) throw new Error(ce.message);

  // players — create any new names
  const ids = new Map(data.players.map((p) => [p.name.toLowerCase(), p.id]));
  for (const p of input.players) {
    if (!ids.has(p.name.toLowerCase())) {
      const np = await upsertPlayer({ name: p.name, first_name: p.name });
      ids.set(p.name.toLowerCase(), np.id);
    }
  }

  const { data: round, error: re } = await sb
    .from("rounds")
    .insert({
      course_id: course.id,
      date: input.date,
      holes: input.course.holes,
      course_rating: input.course.courseRating,
      slope: input.course.slope,
      event_id: input.eventId ?? null,
    })
    .select()
    .single();
  if (re) throw new Error(re.message);

  const { error: se } = await sb.from("round_scores").insert(
    input.players.map((p) => ({
      round_id: round.id,
      player_id: ids.get(p.name.toLowerCase()),
      hole_scores: p.scores,
      gross_total: p.gross,
    })),
  );
  if (se) {
    await sb.from("rounds").delete().eq("id", round.id); // don't leave an orphan round behind
    throw new Error(se.message);
  }

  await rebuildSnapshots(input.players.map((p) => ids.get(p.name.toLowerCase())!));
  return round.id as string;
}

export async function deleteRound(id: string, playerIds: string[]) {
  const { error } = await supabase().from("rounds").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await rebuildSnapshots(playerIds);
}

/**
 * handicap_snapshots is a cache: recompute the affected players from the
 * underlying rounds (always the source of truth) and rewrite their rows.
 */
export async function rebuildSnapshots(playerIds: string[]) {
  const fresh = await loadAll();
  const sb = supabase();
  for (const pid of playerIds) {
    const results = playerResults(fresh, pid);
    await sb.from("handicap_snapshots").delete().eq("player_id", pid);
    const rows = results
      .filter((r) => r.counting)
      .map((r) => ({ player_id: pid, round_id: r.roundId, date: r.date, world_index: r.world.indexAfter, pro_index: r.pro.indexAfter, cox_index: r.cox.indexAfter, tier: r.tierAfter }));
    if (rows.length) {
      const { error } = await sb.from("handicap_snapshots").insert(rows);
      if (error) throw new Error(error.message);
    }
  }
}

/* ---------- events / rsvps / availability ---------- */

export async function createEvent(e: { course_name: string; course_id: string | null; date: string; time: string | null; note: string | null; created_by: string | null }) {
  const { data, error } = await supabase().from("events").insert(e).select().single();
  if (error) throw new Error(error.message);
  return data as GolfEvent;
}
export async function deleteEvent(id: string) {
  const { error } = await supabase().from("events").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
export async function setRsvp(eventId: string, playerId: string, status: RsvpStatus) {
  const { error } = await supabase().from("rsvps").upsert({ event_id: eventId, player_id: playerId, status }, { onConflict: "event_id,player_id" });
  if (error) throw new Error(error.message);
}
export async function setAvailability(playerId: string, month: string, dates: string[]) {
  const { error } = await supabase().from("availability").upsert({ player_id: playerId, month, dates }, { onConflict: "player_id,month" });
  if (error) throw new Error(error.message);
}

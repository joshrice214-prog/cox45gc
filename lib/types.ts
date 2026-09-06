export interface Player {
  id: string;
  name: string; // display name (first name)
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  created_at?: string;
}
export interface Course {
  id: string;
  name: string;
  holes: number;
  pars: number[];
  stroke_index: (number | null)[];
  course_rating: number | null;
  slope: number | null;
}
export interface Round {
  id: string;
  course_id: string;
  date: string;
  holes: number;
  course_rating: number | null;
  slope: number | null;
  event_id: string | null;
  created_at?: string;
}
export interface RoundScore {
  round_id: string;
  player_id: string;
  hole_scores: (number | null)[];
  gross_total: number;
}
export interface HandicapSnapshot {
  player_id: string;
  round_id: string;
  date: string;
  world_index: number | null;
  pro_index: number | null;
  cox_index: number | null;
  tier: "cox45" | "pro" | "whs";
}
export interface GolfEvent {
  id: string;
  course_id: string | null;
  course_name: string | null;
  date: string;
  time: string | null;
  note: string | null;
  created_by: string | null;
  created_at?: string;
}
export type RsvpStatus = "in" | "maybe" | "out";
export interface Rsvp {
  event_id: string;
  player_id: string;
  status: RsvpStatus;
}
export interface Availability {
  player_id: string;
  month: string; // YYYY-MM
  dates: string[]; // YYYY-MM-DD
}
export interface AppData {
  players: Player[];
  courses: Course[];
  rounds: Round[];
  scores: RoundScore[];
  events: GolfEvent[];
  rsvps: Rsvp[];
  availability: Availability[];
}

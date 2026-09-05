# Cox 45™

A private members' handicap app for four friends. Next.js (App Router) on Vercel, Supabase for data and photos, installable PWA with web push. No login — pick your name once per phone.

```
app/                 pages (Clubhouse · Rounds · Add Round · Leaderboard · Events) + API routes
components/          shell, profile sheet, player sheet, UI primitives
lib/handicap.ts      the handicap engine — pure, tested, the thing that must be exactly right
lib/stats.ts         leaderboard, order of merit, honours, records
lib/scorecard.ts     vision prompt, JSON parsing, checksum validation (shared client/server)
lib/data.ts          Supabase reads/writes + snapshot rebuild
public/sw.js         service worker: app shell cache + push
supabase/schema.sql  tables, seed roster, open anon policies, avatars bucket
tests/               node:test suites (npm test)
```

## Setup

1. **Supabase** — create a project, open the SQL editor, paste `supabase/schema.sql`, run it. That creates every table, seeds Josh/Owen/Matt/Ed, opens the anon key to all tables (no auth by design), and creates the public `avatars` bucket.
2. **Anthropic** — get an API key. It only ever lives on the server (`/api/read-scorecard`).
3. **VAPID keys** — `npm run vapid` prints a public/private pair.
4. Copy `.env.example` to `.env.local` and fill it in.
5. `npm install && npm run dev`.

## Deploy to Vercel

- Import the repo, add the same env vars from `.env.example` (including `CRON_SECRET` — Vercel sends it as a bearer token to the cron routes).
- `vercel.json` schedules two crons: the availability prompt on the 1st of each month at 09:00 UTC, and the day-after-event scorecard nudge daily at 10:00 UTC.
- Push only works once the app is on the home screen (an iOS constraint). The profile sheet walks people through Add to Home Screen, then offers the notifications toggle.

## The maths (spec §3, implemented in `lib/handicap.ts`)

Two indices from the same rounds:

- **Cox Adjusted Rating** = Course Rating + 2 × holes. **Cox Par** = Par + 2 × holes.
- **Net double bogey cap**, from a player's 4th counting round onward, using the index they carried *into* the round (never the one it produces):
  - Course Handicap = round(Index × Slope/113 + (Rating − Par)). World uses the real rating; Cox uses the Cox Adjusted Rating against real par. Because the Cox index is lower by exactly the rating shift, the two course handicaps come out equal — which is what makes the cap shift by +2 rather than bite harder.
  - Strokes on a hole = one per full 18 (or 9) of course handicap, plus one if SI ≤ remainder. Plus handicaps give strokes back from SI 18 down.
  - World cap = Par + 2 + strokes. Cox cap = Par + 4 + strokes.
  - Raw scores are stored and shown; capped holes are outlined in brass on the Rounds tab with the capped value.
- **Differential** = (Adjusted Gross − Rating) × 113 / Slope. Nine-hole differentials are doubled and stand alone.
- **Index** from the WHS table (3 rounds: lowest 1 − 2.0 … 20+: average of lowest 8 of the most recent 20), rounded to one decimal.
- For 9-hole rounds the course handicap uses half the index against the 9-hole rating and par (WHS convention — the spec doesn't say otherwise).
- Without a stroke index the cap still applies using only the "full 18s" strokes; the review screen says so.

`handicap_snapshots` is a cache rebuilt from the rounds after every save or delete. Rounds are the source of truth.

## Order of merit

Best 6 rounds in the season. A round is worth `40 − (gross − Cox Par)`, floored at 0 (9 holes: `20 − …`). So a round played level with Cox Par is 40 points and playing more rounds never hurts until you have six. This is a house choice — the spec says "best 6 counting results" without defining the result, so it's stated on the leaderboard and easy to change in `roundPoints()` in `lib/stats.ts`.

## Scorecard pipeline

Photo → client-side prep (orient, ≤1568px, contrast lift) → `/api/read-scorecard` (Claude vision, strict JSON including pars and stroke index) → checksum validation (pars vs printed total, SI is a permutation of 1–18, each player's holes vs printed out/in/total) → second pass focused on the flagged rows if anything's off → fully editable review screen → save. Nothing is saved without a human looking at it.

## Duplicate round detection

Since rounds can be backdated, it's easy to upload the same card twice (two people photograph it separately) or to genuinely log two rounds at the same course on the same day (two tee times). `lib/duplicates.ts` distinguishes them:

- **Weak match** — same course + holes + date, no shared player names. No warning; this is normal for a group that plays the same course often.
- **Strong match** — same course + holes + date, and at least one player name on the new round already appears on an existing one. The review screen shows what's already logged ("Josh, Owen played 90, 108") and requires a second tap — **Save anyway** or **Cancel** — rather than blocking outright.

Matching happens client-side against the rounds already loaded (`data.rounds`), on the course name as typed (case/whitespace-insensitive) rather than a resolved course id, since the course isn't created or matched by id until save time. Player names are compared the same way, before they're turned into player ids.

## Guard rails worth knowing about

- **A course's pars, stroke index, rating and slope are set by the first card and then only ever have blanks filled in.** A later card that disagrees shows a warning on the review screen with a checkbox to update the record — nothing rewrites a course silently, because every earlier round at that course depends on it.
- **A name that isn't on the roster asks before adding a member**, so a misread name can't create a phantom player.
- **A partly-read card can't be saved with a made-up total.** Either every hole is filled in, or the row is cleared and the printed total used.
- **Dates are parsed day-first** (`04/05/2026` is 4 May). The reader transcribes the date as printed; the app does the parsing.
- **The second read never drops what the first one got.** It's merged over the first attempt, not swapped in.
- **"What the reader actually saw"** at the bottom of every review screen shows the raw model output, for when a read looks wrong.
- Rating/slope lookup online is a button on the review screen, not something that runs on every read.

## Tests

`npm test` runs the engine, validation, and stats suites. `npm run typecheck` and `npm run build` both pass clean.

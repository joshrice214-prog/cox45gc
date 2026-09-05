"use client";
import { useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Avatar, Sheet } from "@/components/ui";
import { createEvent, deleteEvent, setAvailability, setRsvp } from "@/lib/data";
import { fmtDate, today } from "@/lib/stats";
import type { GolfEvent, RsvpStatus } from "@/lib/types";

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}
function shiftMonth(key: string, by: number) {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + by, 1));
}

export default function Events() {
  const { data, me, refresh, toast } = useApp();
  const [month, setMonth] = useState(monthKey(new Date()));
  const [organise, setOrganise] = useState<string | null>(null); // prefilled date
  const [busy, setBusy] = useState(false);
  const t = today();

  const grid = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // Monday first
    const cells: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
    return cells;
  }, [month]);

  if (!data) return null;
  const avail = data.availability.filter((a) => a.month === month);
  const freeOn = (date: string) => avail.filter((a) => a.dates.includes(date)).map((a) => a.player_id);
  const myDates = me ? avail.find((a) => a.player_id === me.id)?.dates ?? [] : [];
  const suggestions = grid.filter((d): d is string => !!d && d >= t && freeOn(d).length >= 2).sort((a, b) => freeOn(b).length - freeOn(a).length || a.localeCompare(b)).slice(0, 5);

  const toggle = async (date: string) => {
    if (!me) return;
    const next = myDates.includes(date) ? myDates.filter((d) => d !== date) : [...myDates, date].sort();
    await setAvailability(me.id, month, next);
    await refresh();
  };

  const events = [...data.events].sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
  const up = events.filter((e) => e.date >= t);
  const past = events.filter((e) => e.date < t).reverse();

  return (
    <>
      <div className="sec-row">
        <div className="sec-title">Who's free in {monthLabel(month)}</div>
        <div className="seg">
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
        </div>
      </div>
      <div className="panel">
        <div className="muted small" style={{ marginBottom: 10 }}>
          {me ? "Tap the days you could play. Greener means more of you are free." : "Set your name to mark your free days."}
        </div>
        <div className="cal">
          {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
          {grid.map((d, i) => {
            if (!d) return <div key={"e" + i} />;
            const who = freeOn(d);
            const mine = !!me && who.includes(me.id);
            const others = who.filter((id) => id !== me?.id).length;
            const cls = ["", d < t ? "past" : "", mine ? "mine" : "", who.length >= 4 ? "o4" : who.length === 3 ? "o3" : who.length === 2 ? "o2" : ""].join(" ");
            return (
              <button key={d} className={cls} onClick={() => d >= t && toggle(d)} aria-pressed={mine} aria-label={`${fmtDate(d)}, ${who.length} free`} title={who.map((id) => data.players.find((p) => p.id === id)?.name).join(", ")}>
                {Number(d.slice(-2))}
                <span className="dots">{mine && <i className="me" />}{Array.from({ length: Math.min(others, 3) }).map((_, k) => <i key={k} />)}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {data.players.map((p) => {
            const n = avail.find((a) => a.player_id === p.id)?.dates.filter((d) => d >= t).length ?? 0;
            return <span key={p.id} className="rsvp"><Avatar p={p} size="sm" />{p.name} · {n} {n === 1 ? "day" : "days"}</span>;
          })}
        </div>
      </div>

      <div className="sec-title">Organise</div>
      <div className="panel">
        {suggestions.length > 0 && (
          <>
            <div className="muted small">Good days — {suggestions.length === 1 ? "tap it" : "tap one"} to start planning:</div>
            <div className="suggest">
              {suggestions.map((d) => (
                <button key={d} onClick={() => setOrganise(d)}>{fmtDate(d, { weekday: "short", day: "numeric", month: "short" })} · {freeOn(d).length} free</button>
              ))}
            </div>
          </>
        )}
        <button className="btn" onClick={() => setOrganise(suggestions[0] ?? nextSaturday())} disabled={!me}>Plan a round</button>
        {!me && <div className="muted small" style={{ marginTop: 8 }}>Set your name (top right) to organise a round.</div>}
      </div>

      {up.length > 0 && <div className="sec-title">Coming up</div>}
      {up.map((e, i) => <EventCard key={e.id} e={e} isNext={i === 0} past={false} busy={busy} setBusy={setBusy} />)}
      {past.length > 0 && <div className="sec-title">Been and gone</div>}
      {past.slice(0, 8).map((e) => <EventCard key={e.id} e={e} isNext={false} past busy={busy} setBusy={setBusy} />)}
      {events.length === 0 && <div className="empty"><strong>Nothing in the diary</strong>Mark your free days above, then plan a round.</div>}

      {organise && (
        <OrganiseSheet
          date={organise}
          onClose={() => setOrganise(null)}
          onSaved={async () => {
            setOrganise(null);
            await refresh();
            toast("Round added to the diary");
          }}
        />
      )}
    </>
  );
}

function nextSaturday() {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

function OrganiseSheet({ date: d0, onClose, onSaved }: { date: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { data, me } = useApp();
  const [course, setCourse] = useState("");
  const [date, setDate] = useState(d0);
  const [time, setTime] = useState("09:00");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!data) return null;
  const free = data.availability.filter((a) => a.month === date.slice(0, 7) && a.dates.includes(date)).map((a) => data.players.find((p) => p.id === a.player_id)?.name).filter(Boolean);

  return (
    <Sheet title="Plan a round" sub="It goes straight to the top of Coming up, and everyone can RSVP." onClose={onClose}>
      <label className="f"><span>Where</span>
        <input className="f" value={course} onChange={(e) => setCourse(e.target.value)} placeholder="Course" list="courselist" />
        <datalist id="courselist">{data.courses.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      </label>
      <div className="grid2">
        <label className="f"><span>Date</span><input className="f" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="f"><span>Tee time</span><input className="f" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
      </div>
      {free.length > 0 && <div className="muted small" style={{ marginBottom: 10 }}>Free that day: {free.join(", ")}</div>}
      <label className="f"><span>Anything else</span><input className="f" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></label>
      {err && <div className="err">{err}</div>}
      <div className="row-btns">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            if (!course.trim()) return setErr("Give it a course.");
            if (!date) return setErr("Pick a date.");
            setBusy(true);
            try {
              const known = data.courses.find((c) => c.name.toLowerCase() === course.trim().toLowerCase());
              const ev = await createEvent({ course_name: course.trim(), course_id: known?.id ?? null, date, time: time || null, note: note.trim() || null, created_by: me?.id ?? null });
              if (me) await setRsvp(ev.id, me.id, "in");
              await onSaved();
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Couldn't save");
              setBusy(false);
            }
          }}
        >
          Add to diary
        </button>
      </div>
    </Sheet>
  );
}

function EventCard({ e, isNext, past, busy, setBusy }: { e: GolfEvent; isNext: boolean; past: boolean; busy: boolean; setBusy: (b: boolean) => void }) {
  const { data, me, refresh, toast } = useApp();
  if (!data) return null;
  const my = me ? data.rsvps.find((r) => r.event_id === e.id && r.player_id === me.id)?.status : undefined;
  const status = (pid: string) => data.rsvps.find((r) => r.event_id === e.id && r.player_id === pid)?.status;
  const ins = data.players.filter((p) => status(p.id) === "in").length;
  const logged = data.rounds.some((r) => r.event_id === e.id);
  return (
    <div className={`ev ${past ? "past" : ""} ${isNext ? "next" : ""}`}>
      <div className="ev-when">{fmtDate(e.date, { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}{e.time ? ` · ${e.time}` : ""}</div>
      <div className="ev-title">{e.course_name ?? "Golf"}</div>
      <div className="muted">{e.note ? `${e.note} · ` : ""}{ins} in{past ? (logged ? " · round logged" : " · no round logged") : ""}</div>
      <div className="rsvps">
        {data.players.map((p) => {
          const s = status(p.id);
          return <span key={p.id} className={`rsvp ${s ?? ""}`}><Avatar p={p} size="sm" />{p.name} · {s === "in" ? "in" : s === "out" ? "can't" : s === "maybe" ? "maybe" : "?"}</span>;
        })}
      </div>
      {!past && me && (
        <div className="row-btns">
          {(["in", "maybe", "out"] as RsvpStatus[]).map((s) => (
            <button key={s} className={`btn ghost slim ${my === s ? "on" : ""}`} onClick={async () => { await setRsvp(e.id, me.id, s); await refresh(); }}>
              {s === "in" ? "I'm in" : s === "maybe" ? "Maybe" : "Can't"}
            </button>
          ))}
        </div>
      )}
      <button
        className="btn ghost slim danger"
        style={{ marginTop: 9 }}
        disabled={busy}
        onClick={async () => {
          if (!confirm("Remove this from the diary for everyone?")) return;
          setBusy(true);
          try {
            await deleteEvent(e.id);
            await refresh();
            toast("Removed from the diary");
          } finally {
            setBusy(false);
          }
        }}
      >
        Remove
      </button>
    </div>
  );
}

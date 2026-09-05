"use client";
import { useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Sheet } from "@/components/ui";
import { findDuplicateRounds, strongDuplicates, type DuplicateMatch } from "@/lib/duplicates";
import { sum, validate, type Issue, type Parsed, type ParsedPlayer } from "@/lib/scorecard";
import { fmtDate } from "@/lib/stats";

export function blankPlayer(name: string, holes: number): ParsedPlayer {
  return { name, scores: Array(holes).fill(null), out: null, in: null, printed: null, confidence: "high", gross: null };
}

/* ---------------- review ---------------- */

export function Review({ p, issues, secondPass, fromPhoto, busy, err, onChange, onCancel, onSave }: {
  p: Parsed;
  issues: Issue[];
  secondPass: boolean;
  fromPhoto: boolean;
  busy: string | null;
  err: string;
  onChange: (p: Parsed) => void;
  onCancel: () => void;
  onSave: (p: Parsed, eventId: string | null) => void;
}) {
  const { data } = useApp();
  const n = p.holes;
  const par = sum(p.pars);
  const coxCR = p.courseRating != null ? (p.courseRating + n * 2).toFixed(1) : null;
  const [looking, setLooking] = useState(false);
  const lookup = async () => {
    if (!p.course.trim()) return;
    setLooking(true);
    try {
      const res = await fetch("/api/lookup-course", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: p.course, holes: n, tee: p.tee }) });
      const j = await res.json();
      if (j.found) {
        onChange({
          ...p,
          courseRating: j.courseRating ?? p.courseRating,
          slope: j.slope ?? p.slope,
          ratingSource: "lookup",
          ratingNote: [j.tee ? `${j.tee} tees` : null, j.note, j.source].filter(Boolean).join(" · ") || null,
        });
      } else {
        onChange({ ...p, ratingNote: "Couldn't find a confident match online — enter it by hand if you know it." });
      }
    } finally {
      setLooking(false);
    }
  };
  const sameDayEvents = useMemo(() => (data?.events ?? []).filter((e) => e.date === p.date), [data, p.date]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [eventTouched, setEventTouched] = useState(false);
  const linkedEvent = eventTouched ? eventId : sameDayEvents[0]?.id ?? null;
  const [dupWarning, setDupWarning] = useState<DuplicateMatch[] | null>(null);

  const trySave = () => {
    if (data) {
      const matches = strongDuplicates(findDuplicateRounds(data, p.course, p.holes, p.date, p.players.map((pl) => pl.name)));
      if (matches.length) {
        setDupWarning(matches);
        return;
      }
    }
    onSave(p, linkedEvent);
  };

  const set = <K extends keyof Parsed>(k: K, v: Parsed[K]) => onChange({ ...p, [k]: v });
  const setHoles = (h: 9 | 18) => {
    const resize = <T,>(a: T[], fill: T) => { const o = a.slice(0, h); while (o.length < h) o.push(fill); return o; };
    onChange({
      ...p,
      holes: h,
      pars: resize(p.pars, null),
      strokeIndex: resize(p.strokeIndex, null),
      players: p.players.map((pl) => recompute({ ...pl, scores: resize(pl.scores, null) }, h)),
    });
  };
  const setPar = (i: number, v: number | null) => { const pars = [...p.pars]; pars[i] = v; onChange({ ...p, pars, parTotal: sum(pars) }); };
  const setSI = (i: number, v: number | null) => { const si = [...p.strokeIndex]; si[i] = v; set("strokeIndex", si); };
  const setPlayer = (i: number, pl: ParsedPlayer) => { const players = [...p.players]; players[i] = recompute(pl, n); set("players", players); };
  const pickCourse = (name: string) => {
    const known = data?.courses.find((c) => c.name.toLowerCase() === name.trim().toLowerCase() && c.holes === n);
    if (!known) return set("course", name);
    onChange({
      ...p,
      course: known.name,
      courseRating: p.courseRating ?? known.course_rating,
      slope: p.slope ?? known.slope,
      pars: p.pars.every((v) => v == null) && known.pars.length === n ? [...known.pars] : p.pars,
      strokeIndex: p.strokeIndex.every((v) => v == null) && known.stroke_index.length === n ? [...known.stroke_index] : p.strokeIndex,
    });
  };

  return (
    <>
      <div className="sec-title" style={{ marginTop: 0 }}>Check it before it counts</div>
      {err && <div className="err">{err}</div>}
      {issues.length > 0 ? (
        <div className="warn">
          <b>{issues.length} thing{issues.length === 1 ? "" : "s"} worth a look</b>
          <ul>{issues.slice(0, 8).map((i, k) => <li key={k}>{i.m}</li>)}</ul>
          {secondPass && <div style={{ marginTop: 7, opacity: 0.75 }}>Already had a second look at these.</div>}
        </div>
      ) : fromPhoto ? (
        <div className="ok">Read cleanly. Every player's holes match the totals printed on the card.</div>
      ) : null}

      <div className="panel">
        <label className="f"><span>Course</span>
          <input className="f" value={p.course} onChange={(e) => pickCourse(e.target.value)} placeholder="Course name" list="courselist" />
          <datalist id="courselist">{data?.courses.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        </label>
        <div className="grid2">
          <label className="f"><span>Date</span><input className="f" type="date" value={p.date} onChange={(e) => set("date", e.target.value)} /></label>
          <label className="f"><span>Holes</span>
            <select className="f" value={n} onChange={(e) => setHoles(Number(e.target.value) as 9 | 18)}><option value={18}>18</option><option value={9}>9</option></select>
          </label>
        </div>
        <div className="grid2">
          <label className="f"><span>Course rating</span><input className="f" type="number" step="0.1" inputMode="decimal" value={p.courseRating ?? ""} onChange={(e) => onChange({ ...p, courseRating: numv(e.target.value), ratingSource: "card" })} placeholder={n === 9 ? "35.4" : "70.8"} /></label>
          <label className="f"><span>Slope</span><input className="f" type="number" inputMode="numeric" value={p.slope ?? ""} onChange={(e) => onChange({ ...p, slope: numv(e.target.value), ratingSource: "card" })} placeholder="121" /></label>
        </div>
        <div className="muted">
          {coxCR ? <>Par {par || "?"} · Cox Par {par + n * 2} · Cox adjusted rating <b style={{ color: "var(--brass-soft)" }}>{coxCR}</b></> : "Rating and slope are needed for the handicap. Without them the round still saves, it just won't count."}
        </div>
        {p.ratingSource === "lookup" && (
          <div className="warn" style={{ marginTop: 10, marginBottom: 0 }}>
            Found online, not printed on the card{p.ratingNote ? ` — ${p.ratingNote}` : ""}. Worth a quick check against the card or the club's website.
          </div>
        )}
        {(p.courseRating == null || p.slope == null) && (
          <button className="btn ghost slim" style={{ marginTop: 10 }} onClick={lookup} disabled={looking || !p.course.trim()}>
            {looking ? <><span className="spinner" />Looking it up</> : "Look up rating & slope online"}
          </button>
        )}
        {p.ratingNote && p.ratingSource !== "lookup" && <div className="muted small" style={{ marginTop: 8 }}>{p.ratingNote}</div>}
        {sameDayEvents.length > 0 && (
          <label className="f" style={{ marginTop: 12, marginBottom: 0 }}><span>Played as part of</span>
            <select className="f" value={linkedEvent ?? ""} onChange={(e) => { setEventTouched(true); setEventId(e.target.value || null); }}>
              <option value="">Not an event round</option>
              {sameDayEvents.map((e) => <option key={e.id} value={e.id}>{e.course_name ?? "Golf"} · {fmtDate(e.date)}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="sec-title">Par and stroke index</div>
      <div className="pcard">
        <NineGrids n={n} rows={[
          { key: "par", cls: "pin", vals: p.pars, set: setPar, label: "Par" },
          { key: "si", cls: "si", vals: p.strokeIndex, set: setSI, label: "SI" },
        ]} />
        <div className="muted small" style={{ marginTop: 8 }}>Stroke index is what lets the app cap a blow-up hole at net double bogey. Leave it blank if the card doesn't have one.</div>
      </div>

      <div className="sec-title">Scores</div>
      {p.players.map((pl, i) => {
        const flagged = issues.some((x) => x.t === `p${i}`);
        const filled = pl.scores.filter((v) => v != null).length;
        return (
          <div key={i} className={`pcard ${flagged ? "flag" : ""}`}>
            <div className="phead">
              <span className={`conf ${pl.confidence}`} title="Read confidence" />
              <input value={pl.name} onChange={(e) => setPlayer(i, { ...pl, name: e.target.value })} placeholder="Name" list="playerlist" />
              <span className="ptot">{filled ? sum(pl.scores) : pl.gross ?? "–"}</span>
            </div>
            <NineGrids n={n} rows={[{ key: "s" + i, cls: "", vals: pl.scores, set: (h, v) => { const scores = [...pl.scores]; scores[h] = v; setPlayer(i, { ...pl, scores }); }, label: "" }]} />
            <div className="mismatch">{mismatchText(pl, n)}</div>
            {filled === 0 && (
              <label className="f" style={{ marginTop: 6 }}><span>Total only (no hole scores)</span>
                <input className="f" type="number" inputMode="numeric" value={pl.printed ?? ""} onChange={(e) => setPlayer(i, { ...pl, printed: numv(e.target.value) })} />
              </label>
            )}
            <button className="btn ghost slim" style={{ marginTop: 9 }} onClick={() => set("players", p.players.filter((_, k) => k !== i))}>Remove player</button>
          </div>
        );
      })}
      <datalist id="playerlist">{data?.players.map((x) => <option key={x.id} value={x.name} />)}</datalist>
      <button className="btn ghost" onClick={() => set("players", [...p.players, blankPlayer("", n)])}>Add another player</button>
      <div className="row-btns">
        <button className="btn ghost" onClick={onCancel} disabled={!!busy}>Start again</button>
        <button className="btn" onClick={trySave} disabled={!!busy}>{busy ? <><span className="spinner" />{busy}</> : "Save round"}</button>
      </div>

      {dupWarning && (
        <Sheet
          title="Already logged?"
          sub={`${dupWarning.length === 1 ? "A round" : `${dupWarning.length} rounds`} at ${p.course} on ${fmtDate(p.date)} already ${dupWarning.length === 1 ? "exists" : "exist"} with a player in common.`}
          onClose={() => setDupWarning(null)}
        >
          {dupWarning.map((m) => (
            <div key={m.round.id} className="panel">
              <div className="muted small">{fmtDate(m.round.date)} · {m.course.name}</div>
              {m.players.length > 0 ? (
                <div>{m.players.map((pl) => `${pl.name} played ${pl.gross}`).join(", ")}</div>
              ) : (
                <div className="muted">No scores logged against it yet.</div>
              )}
            </div>
          ))}
          <div className="muted small" style={{ margin: "4px 4px 14px" }}>
            If this is a genuine second round — a different tee time, or someone playing twice — save it anyway. If it's the same card uploaded twice, cancel and delete the other one from Rounds instead.
          </div>
          <div className="row-btns">
            <button className="btn ghost" onClick={() => setDupWarning(null)} disabled={!!busy}>Cancel</button>
            <button
              className="btn"
              disabled={!!busy}
              onClick={() => {
                setDupWarning(null);
                onSave(p, linkedEvent);
              }}
            >
              {busy ? <><span className="spinner" />{busy}</> : "Save anyway"}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function recompute(pl: ParsedPlayer, n: number): ParsedPlayer {
  const filled = pl.scores.filter((v) => v != null).length;
  return { ...pl, gross: filled === n ? sum(pl.scores) : filled ? sum(pl.scores) : pl.printed ?? null };
}
function mismatchText(pl: ParsedPlayer, n: number) {
  const s = sum(pl.scores), filled = pl.scores.filter((v) => v != null).length;
  if (filled === 0) return pl.printed ? "Total only — no hole-by-hole scores, so this round can't be capped." : "";
  if (filled < n) return `${n - filled} hole${n - filled === 1 ? "" : "s"} still blank.`;
  if (pl.printed && pl.printed !== s) return `Card says ${pl.printed}, holes add to ${s}.`;
  return "";
}
const numv = (v: string): number | null => (v === "" || isNaN(Number(v)) ? null : Number(v));

function NineGrids({ n, rows }: { n: number; rows: { key: string; cls: string; vals: (number | null)[]; set: (h: number, v: number | null) => void; label: string }[] }) {
  const out = [];
  for (let start = 0; start < n; start += 9) {
    const end = Math.min(start + 9, n);
    out.push(
      <div key={start}>
        <div className="ninelabel">{start === 0 ? (n > 9 ? "Front nine" : "Holes") : "Back nine"}</div>
        <div className="hlabels">{Array.from({ length: end - start }, (_, k) => <span key={k}>{start + k + 1}</span>)}</div>
        {rows.map((r) => (
          <div key={r.key}>
            {r.label && <div className="rowlabel">{r.label}</div>}
            <div className="hgrid">
              {Array.from({ length: end - start }, (_, k) => {
                const idx = start + k;
                return <input key={idx} type="number" inputMode="numeric" className={r.cls} value={r.vals[idx] ?? ""} onChange={(e) => r.set(idx, numv(e.target.value))} aria-label={`${r.label || "Score"} hole ${idx + 1}`} />;
              })}
            </div>
          </div>
        ))}
      </div>,
    );
  }
  return <>{out}</>;
}

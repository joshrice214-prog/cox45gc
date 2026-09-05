"use client";
import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Avatar, Sparkline, Trend } from "@/components/ui";
import PlayerSheet from "@/components/PlayerSheet";
import type { Player } from "@/lib/types";
import { birdieCounts, courseRecords, fmtDate, fmtIdx, leaderboard, orderOfMerit, seasonsAvailable } from "@/lib/stats";

const WINDOWS = [30, 90, 365] as const;

export default function Leaderboard() {
  const { data } = useApp();
  const [win, setWin] = useState<(typeof WINDOWS)[number]>(90);
  const [season, setSeason] = useState<number>(new Date().getFullYear());
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return null;

  const board = leaderboard(data, win);
  const ready = board.filter((b) => b.cox != null);
  const waiting = board.filter((b) => b.cox == null);
  const merit = orderOfMerit(data, season).filter((m) => m.played > 0);
  const records = courseRecords(data, season);
  const birds = birdieCounts(data, season);
  const pl = (id: string) => data.players.find((p) => p.id === id);
  const mv = (v: number | null) => (v == null ? <span className="muted">—</span> : <span className={`trend ${v < 0 ? "up" : v > 0 ? "down" : "flat"}`}>{v > 0 ? "+" : ""}{v.toFixed(1)}</span>);

  return (
    <>
      <div className="sec-row">
        <div className="sec-title">Handicap indices</div>
        <div className="seg" role="group" aria-label="Movement window">
          {WINDOWS.map((w) => (
            <button key={w} className={w === win ? "on" : ""} onClick={() => setWin(w)}>{w}d</button>
          ))}
        </div>
      </div>
      <div className="muted small" style={{ margin: "0 4px 9px" }}>Ranked by Cox 45. Movement is over the last {win} days. The index is a rolling WHS number — it never resets by season.</div>

      {ready.length === 0 && <div className="empty"><strong>No handicaps yet</strong>Each player needs three counting rounds (course rating and slope filled in).</div>}
      {ready.map((p, i) => (
        <button key={p.playerId} className={`lb-row ${i === 0 ? "top" : ""}`} onClick={() => setOpen(p.playerId)}>
          <div className="pos">{i + 1}</div>
          <Avatar p={pl(p.playerId)} />
          <div className="lb-mid">
            <div className="lb-name">{p.name} <Trend t={p.trend} /></div>
            <div className="lb-sub">{p.counting} counting rounds · {win}d: Cox {mv(p.movement.cox)} · World {mv(p.movement.world)}</div>
            <Sparkline hist={p.history} />
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <div className="lb-idx">{fmtIdx(p.cox)}<small>Cox 45</small></div>
            <div className="lb-idx" style={{ color: "var(--cream-dim)" }}>{fmtIdx(p.world)}<small>World</small></div>
          </div>
        </button>
      ))}
      {waiting.length > 0 && (
        <>
          <div className="sec-title">Not enough rounds yet</div>
          {waiting.map((p) => (
            <button key={p.playerId} className="lb-row" onClick={() => setOpen(p.playerId)}>
              <div className="pos">–</div>
              <Avatar p={pl(p.playerId)} />
              <div className="lb-mid">
                <div className="lb-name">{p.name}</div>
                <div className="lb-sub">{p.needed} more counting {p.needed === 1 ? "round" : "rounds"} needed</div>
              </div>
            </button>
          ))}
        </>
      )}

      <div className="sec-row">
        <div className="sec-title">Season</div>
        <select className="season" value={season} onChange={(e) => setSeason(Number(e.target.value))} aria-label="Season">
          {seasonsAvailable(data).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="sec-title" style={{ marginTop: 6 }}>Order of merit</div>
      <div className="muted small" style={{ margin: "0 4px 9px" }}>Best 6 rounds count. A round is worth 40 minus your score against Cox Par (9 holes: 20), so a level round is 40 points.</div>
      {merit.length === 0 ? (
        <div className="panel muted">No rounds in {season} yet.</div>
      ) : (
        merit.map((m, i) => (
          <button key={m.playerId} className="lb-row" onClick={() => setOpen(m.playerId)}>
            <div className="pos">{i + 1}</div>
            <Avatar p={pl(m.playerId)} />
            <div className="lb-mid">
              <div className="lb-name">{m.name}</div>
              <div className="lb-sub">{m.counted} of 6 counting · {m.played} played · best {m.best.slice(0, 3).join(", ")}</div>
            </div>
            <div className="lb-idx">{m.points}<small>pts</small></div>
          </button>
        ))
      )}

      <div className="sec-title">Birdies in {season}</div>
      <div className="panel">
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "6px 16px", alignItems: "center" }}>
          <span className="muted small">Player</span><span className="muted small">Real</span><span className="muted small">Cox Birds</span>
          {birds.map((b) => (
            <FragmentRow key={b.playerId} name={b.name} a={b.birdies} b={b.coxBirds} p={pl(b.playerId)} />
          ))}
        </div>
        <div className="muted small" style={{ marginTop: 10 }}>Real birdies are one under the printed par. Cox Birds are one under Cox Par (par + 2). Different things, kept apart.</div>
      </div>

      <div className="sec-title">Course records in {season}</div>
      {records.length === 0 ? (
        <div className="panel muted">No course records yet.</div>
      ) : (
        <div className="panel">
          {records.map((r) => (
            <div key={r.course.id} className="honour">
              <span className="l">{r.course.name}<br /><span className="small">{fmtDate(r.date)}</span></span>
              <span className="r"><b>{r.holder}</b><span>{r.gross}{r.vsCox != null ? ` (${r.vsCox > 0 ? "+" : ""}${r.vsCox} vs Cox Par)` : ""}</span></span>
            </div>
          ))}
        </div>
      )}

      {open && <PlayerSheet playerId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function FragmentRow({ name, a, b, p }: { name: string; a: number; b: number; p: Player | undefined }) {
  return (
    <>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar p={p} size="sm" />{name}</span>
      <b style={{ textAlign: "right" }}>{a}</b>
      <b style={{ textAlign: "right", color: "var(--good)" }}>{b}</b>
    </>
  );
}

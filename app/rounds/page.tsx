"use client";
import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Avatar, HoleCell, VsChip } from "@/components/ui";
import { deleteRound } from "@/lib/data";
import { coxParOf, fmtDate, roundResultFor, scoreRows } from "@/lib/stats";

export default function Rounds() {
  const { data, refresh, toast } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  if (!data.rounds.length)
    return (
      <div className="empty"><strong>No rounds in the book</strong>Every round you add shows up here, hole by hole.<br /><Link href="/add" className="btn slim" style={{ marginTop: 12 }}>Add a round</Link></div>
    );
  const rows = scoreRows(data);
  const rounds = [...data.rounds].sort((a, b) => b.date.localeCompare(a.date) || (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  return (
    <>
      {rounds.map((r) => {
        const c = data.courses.find((x) => x.id === r.course_id);
        const cp = coxParOf(c, r);
        const mine = rows.filter((x) => x.round.id === r.id).sort((a, b) => a.score.gross_total - b.score.gross_total);
        const isOpen = open === r.id;
        return (
          <div key={r.id} className="round-card">
            <button className="round-head" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
              <div>
                <div className="round-course">{c?.name ?? "Unknown course"}</div>
                <div className="round-date">
                  {fmtDate(r.date)} · {r.holes} holes{cp ? ` · Cox Par ${cp}` : ""}{r.course_rating ? "" : " · no rating, doesn't count"}
                </div>
              </div>
              <span className="muted small">{isOpen ? "Hide" : "Holes"}</span>
            </button>
            <div style={{ marginTop: 10 }}>
              {mine.map((row) => {
                const p = data.players.find((x) => x.id === row.playerId);
                const res = isOpen ? roundResultFor(data, row.playerId, r.id) : undefined;
                const capped = res?.cox.holes.filter((h) => h.wasCapped).length ?? 0;
                return (
                  <div key={row.playerId}>
                    <div className="score-line">
                      <span className="n"><Avatar p={p} size="sm" />{p?.name ?? "?"}</span>
                      <VsChip v={row.vsCox} />
                      <span className="g">{row.score.gross_total}</span>
                    </div>
                    {isOpen && c && c.pars.length > 0 && row.score.hole_scores?.length > 0 && (
                      <>
                        <HoleGrid scores={row.score.hole_scores} pars={c.pars} caps={res?.cox.holes} />
                        {res?.counting && (
                          <div className="legend">
                            {capped ? <><i />{capped} hole{capped === 1 ? "" : "s"} capped at net double bogey for the handicap (Cox: {res.cox.adjustedGross}, World: {res.world.adjustedGross}). The card itself is untouched.</> : res.cox.capApplied ? "Nothing needed capping." : "No cap yet — first three rounds count in full."}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {isOpen && (
              <button
                className="btn ghost slim danger"
                style={{ marginTop: 10 }}
                disabled={busy}
                onClick={async () => {
                  if (!confirm("Delete this round for everyone? This can't be undone.")) return;
                  setBusy(true);
                  try {
                    await deleteRound(r.id, mine.map((m) => m.playerId));
                    await refresh();
                    toast("Round deleted");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete round
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

function HoleGrid({ scores, pars, caps }: { scores: (number | null)[]; pars: number[]; caps?: { wasCapped: boolean; capped: number | null }[] }) {
  return (
    <div className="holes">
      {scores.map((s, i) => (
        <HoleCell key={i} score={s} par={pars[i]} capped={caps?.[i]?.wasCapped} capTo={caps?.[i]?.capped} />
      ))}
    </div>
  );
}

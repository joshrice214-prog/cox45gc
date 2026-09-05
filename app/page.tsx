"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Avatar, Trend } from "@/components/ui";
import PlayerSheet from "@/components/PlayerSheet";
import { setRsvp } from "@/lib/data";
import { allTimeRecords, fmtDate, fmtIdx, leaderboard, orderOfMerit, seasonHonours, seasonsAvailable, today } from "@/lib/stats";
import type { RsvpStatus } from "@/lib/types";

export default function Clubhouse() {
  const { data, me, refresh, toast } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const year = new Date().getFullYear();

  const next = useMemo(() => {
    if (!data) return null;
    const t = today();
    return [...data.events].filter((e) => e.date >= t).sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")))[0] ?? null;
  }, [data]);

  if (!data) return null;
  const board = leaderboard(data, 90);
  const merit = orderOfMerit(data, year);
  const myMerit = me ? merit.findIndex((m) => m.playerId === me.id) : -1;
  const mine = me ? board.find((b) => b.playerId === me.id) : null;
  const myRounds = me ? data.scores.filter((s) => s.player_id === me.id && data.rounds.find((r) => r.id === s.round_id && r.date.startsWith(String(year)))).length : 0;
  const myRsvp = next && me ? data.rsvps.find((r) => r.event_id === next.id && r.player_id === me.id)?.status : undefined;
  const ins = next ? data.rsvps.filter((r) => r.event_id === next.id && r.status === "in").map((r) => data.players.find((p) => p.id === r.player_id)).filter(Boolean) : [];
  const seasons = seasonsAvailable(data).filter((s) => s !== year);
  const records = allTimeRecords(data);
  const live = seasonHonours(data, year);

  const rsvp = async (s: RsvpStatus) => {
    if (!next || !me) return;
    await setRsvp(next.id, me.id, s);
    await refresh();
    toast(s === "in" ? "You're in" : s === "maybe" ? "Marked as maybe" : "Marked as can't");
  };

  return (
    <>
      {next ? (
        <section className="fixture">
          <div className="kicker">Next on the tee</div>
          <div className="when">{fmtDate(next.date, { weekday: "short", day: "numeric", month: "short" })}{next.time ? ` · ${next.time}` : ""}</div>
          <div className="where">{next.course_name ?? "Golf"}</div>
          {next.note && <div className="muted">{next.note}</div>}
          <div className="who">
            {ins.map((p) => <Avatar key={p!.id} p={p} size="sm" />)}
            <span className="muted" style={{ marginLeft: 6 }}>{ins.length} in</span>
          </div>
          {me && (
            <div className="row-btns">
              {(["in", "maybe", "out"] as RsvpStatus[]).map((s) => (
                <button key={s} className={`btn ghost slim ${myRsvp === s ? "on" : ""}`} style={{ flex: 1 }} onClick={() => rsvp(s)}>
                  {s === "in" ? "I'm in" : s === "maybe" ? "Maybe" : "Can't"}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="fixture">
          <div className="kicker">Next on the tee</div>
          <div className="when">Nothing booked</div>
          <div className="muted">Check who's free and get one in the diary.</div>
          <Link href="/events" className="btn ghost slim" style={{ marginTop: 12 }}>Go to Events</Link>
        </section>
      )}

      {me && (
        <div className="stats3">
          <div className="stat"><b>{myMerit >= 0 && merit[myMerit].played ? `${myMerit + 1}${ord(myMerit + 1)}` : "—"}</b><span>Order of merit</span></div>
          <div className="stat"><b>{fmtIdx(mine?.cox)}</b><span>Cox 45 index</span></div>
          <div className="stat"><b>{myRounds}</b><span>Rounds in {year}</span></div>
        </div>
      )}

      <div className="sec-row">
        <div className="sec-title">Cox 45 handicaps</div>
        <Link href="/leaderboard" className="muted small">Full leaderboard</Link>
      </div>
      {board.filter((b) => b.cox != null).length === 0 ? (
        <div className="empty"><strong>No handicaps yet</strong>Three counting rounds each and the table fills itself in.<br /><Link href="/add" className="btn slim" style={{ marginTop: 12 }}>Add a round</Link></div>
      ) : (
        board.filter((b) => b.cox != null).slice(0, 3).map((p, i) => (
          <button key={p.playerId} className={`lb-row ${i === 0 ? "top" : ""}`} onClick={() => setOpen(p.playerId)}>
            <div className="pos">{i + 1}</div>
            <Avatar p={data.players.find((x) => x.id === p.playerId)} />
            <div className="lb-mid">
              <div className="lb-name">{p.name} <Trend t={p.trend} /></div>
              <div className="lb-sub">World {fmtIdx(p.world)}</div>
            </div>
            <div className="lb-idx">{fmtIdx(p.cox)}</div>
          </button>
        ))
      )}

      <div className="sec-title">Hall of fame</div>
      <div className="hof-season">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px" }}>
          <span className="yr">{year}</span>
          <span className="live">In progress</span>
        </div>
        <div className="hof-body">
          {live.length ? live.map((h) => <Honour key={h.label} {...h} />) : <div className="muted">Nothing on the board yet this season.</div>}
        </div>
      </div>
      {seasons.map((s) => {
        const hon = seasonHonours(data, s);
        return (
          <div key={s} className="hof-season">
            <button onClick={() => setExpanded(expanded === s ? null : s)} aria-expanded={expanded === s}>
              <span className="yr">{s}</span>
              <span className="muted">{hon[0] ? `${hon[0].name} — order of merit` : "No rounds"}</span>
            </button>
            {expanded === s && <div className="hof-body">{hon.map((h) => <Honour key={h.label} {...h} />)}</div>}
          </div>
        );
      })}

      <div className="sec-title">All-time records</div>
      <div className="panel">
        {records.length ? records.map((r) => <Honour key={r.label} {...r} />) : <div className="muted">Records appear once there's a round in the book.</div>}
      </div>

      {open && <PlayerSheet playerId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Honour({ label, name, detail }: { label: string; name: string; detail: string }) {
  return (
    <div className="honour">
      <span className="l">{label}</span>
      <span className="r"><b>{name}</b><span>{detail}</span></span>
    </div>
  );
}
const ord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");

"use client";
import { useApp } from "./AppProvider";
import { Avatar, Sheet, VsChip, Sparkline } from "./ui";
import { currentIndex, indexHistory } from "@/lib/handicap";
import { fmtIdx, formGuide, headToHead, playerResults, scoreRows } from "@/lib/stats";

export default function PlayerSheet({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const { data } = useApp();
  if (!data) return null;
  const p = data.players.find((x) => x.id === playerId);
  if (!p) return null;
  const res = playerResults(data, playerId);
  const rows = scoreRows(data).filter((r) => r.playerId === playerId);
  const best = [...rows].sort((a, b) => a.score.gross_total - b.score.gross_total)[0];
  const bestVs = rows.filter((r) => r.vsCox != null).sort((a, b) => a.vsCox! - b.vsCox!)[0];
  const mostCoxPars = Math.max(0, ...rows.map((r) => r.coxParsOrBetter));
  const form = formGuide(data, playerId);
  const others = data.players.filter((x) => x.id !== playerId);
  const hist = indexHistory(res, "cox");

  return (
    <Sheet title={[p.first_name, p.last_name].filter(Boolean).join(" ") || p.name} sub="Cox 45 record" onClose={onClose}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
        <Avatar p={p} size="lg" />
        <div className="grid2" style={{ flex: 1 }}>
          <div className="stat"><b>{fmtIdx(currentIndex(res, "cox"))}</b><span>Cox 45 index</span></div>
          <div className="stat"><b>{fmtIdx(currentIndex(res, "world"))}</b><span>World index</span></div>
        </div>
      </div>
      {hist.length >= 2 && <div className="panel" style={{ padding: "10px 14px" }}><div className="muted small">Cox 45 index over time</div><Sparkline hist={hist} /></div>}
      {form.length > 0 && (
        <>
          <div className="sec-title" style={{ marginTop: 0 }}>Last {form.length} rounds vs Cox Par</div>
          <div className="panel" style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{form.map((v, i) => <VsChip key={i} v={v} />)}</div>
        </>
      )}
      {rows.length > 0 && (
        <>
          <div className="sec-title">Personal bests</div>
          <div className="panel">
            <Line l="Best gross" v={`${best.score.gross_total} at ${best.course?.name ?? "?"}`} />
            {bestVs && <Line l="Best vs Cox Par" v={bestVs.vsCox! > 0 ? `+${bestVs.vsCox}` : String(bestVs.vsCox)} />}
            {mostCoxPars > 0 && <Line l="Most Cox Pars or better in a round" v={String(mostCoxPars)} />}
            <Line l="Rounds logged" v={String(rows.length)} />
          </div>
        </>
      )}
      {others.length > 0 && (
        <>
          <div className="sec-title">Head to head</div>
          <div className="panel">
            {others.map((o) => {
              const h = headToHead(data, playerId, o.id);
              return (
                <div key={o.id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}>
                  <span>vs {o.name}</span>
                  {h.n ? <b>{h.aw}–{h.bw}{h.tie ? ` (${h.tie} tied)` : ""}</b> : <span className="muted">no shared rounds</span>}
                </div>
              );
            })}
          </div>
        </>
      )}
      <button className="btn ghost" onClick={onClose} style={{ marginTop: 14 }}>Close</button>
    </Sheet>
  );
}
function Line({ l, v }: { l: string; v: string }) {
  return <div style={{ marginBottom: 7 }}><span className="muted">{l}</span> — <b>{v}</b></div>;
}

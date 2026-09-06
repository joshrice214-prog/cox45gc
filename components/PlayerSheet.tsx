"use client";
import { useApp } from "./AppProvider";
import { Avatar, Sheet, VsChip, Sparkline, TierBadge } from "./ui";
import { currentIndex, houseHistory, houseIndex, personalBests, promotions, PRO_THRESHOLD, WHS_THRESHOLD, RECORD_MIN_ROUNDS, TIER_LABEL, type Tier } from "@/lib/handicap";
import { fmtDate, fmtIdx, formGuide, headToHead, playerResults, scoreRows } from "@/lib/stats";

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
  const hist = houseHistory(res);
  const house = houseIndex(res);
  const proms = promotions(res);
  const bests = personalBests(res);
  const pbText = (t: Tier) => {
    const b = bests.find((x) => x.tier === t);
    return b ? `best ${b.value.toFixed(1)}${b.early ? "†" : ""}` : "Graduated";
  };
  const anyEarly = bests.some((b) => b.early && !b.current);
  const cox = currentIndex(res, "cox"), pro = currentIndex(res, "pro");
  const toPro = cox == null ? null : Math.round((cox - PRO_THRESHOLD) * 10) / 10;
  const toWhs = pro == null ? null : Math.round((pro - WHS_THRESHOLD) * 10) / 10;

  return (
    <Sheet title={[p.first_name, p.last_name].filter(Boolean).join(" ") || p.name} sub={TIER_LABEL[house.tier]} onClose={onClose}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
        <Avatar p={p} size="lg" />
        <div className="grid2" style={{ flex: 1 }}>
          {house.tier !== "whs" && <div className="stat"><b>{fmtIdx(house.value)}</b><span>{TIER_LABEL[house.tier]} index</span></div>}
          <div className="stat" style={house.tier === "whs" ? { gridColumn: "1 / -1" } : undefined}><b>{fmtIdx(currentIndex(res, "world"))}</b><span>World index <TierBadge tier={house.tier} /></span></div>
        </div>
      </div>
      <div className="ladder" aria-label="Handicap ladder">
        <div className={`rung ${house.tier !== "cox45" ? "done" : "now"}`}><b>Cox 45</b>{house.tier === "cox45" && toPro != null ? (toPro > 0 ? `${toPro.toFixed(1)} to Pro` : "Pro next round") : house.tier === "cox45" ? "3 rounds to start" : pbText("cox45")}</div>
        <div className={`rung ${house.tier === "whs" ? "done" : house.tier === "pro" ? "now" : ""}`}><b>Pro</b>{house.tier === "pro" && toWhs != null ? (toWhs > 0 ? `${toWhs.toFixed(1)} to WHS` : "WHS next round") : house.tier === "whs" ? pbText("pro") : `at ${PRO_THRESHOLD}`}</div>
        <div className={`rung ${house.tier === "whs" ? "now" : ""}`}><b>WHS</b>{house.tier === "whs" ? "Top rung" : `at ${WHS_THRESHOLD.toFixed(1)}`}</div>
      </div>
      {proms.length > 0 && <div className="muted small" style={{ marginTop: 8 }}>{proms.map((x) => `${TIER_LABEL[x.tier]} on ${fmtDate(x.date)}`).join(" · ")}</div>}
      {anyEarly && <div className="muted small" style={{ marginTop: 4 }}>† set before round {RECORD_MIN_ROUNDS} — real, but not a settled number</div>}
      {hist.length >= 2 && (
        <div className="panel" style={{ padding: "10px 14px", marginTop: 12 }}>
          <div className="muted small">House index over time{proms.length ? " — brass ticks mark a promotion (new ruler, not a bad week)" : ""}</div>
          <Sparkline hist={hist} width={300} height={44} />
        </div>
      )}
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

"use client";
import type { Player } from "@/lib/types";
import { coxCategory } from "@/lib/handicap";

export function Avatar({ p, name, size }: { p?: Player | null; name?: string; size?: "sm" | "lg" | "xl" }) {
  const n = p?.name ?? name ?? "?";
  return (
    <span className={`avatar ${size ?? ""}`} aria-hidden="true">
      {p?.photo_url ? <img src={p.photo_url} alt="" /> : n.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Sheet({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet">
        <h3>{title}</h3>
        {sub && <div className="sub">{sub}</div>}
        {children}
      </div>
    </div>
  );
}

export function VsChip({ v }: { v: number | null }) {
  if (v == null) return null;
  const cls = v < 0 ? "c-bird" : v === 0 ? "c-par" : v <= 3 ? "c-bogey" : "c-double";
  return <span className={`chip ${cls}`}>{v > 0 ? `+${v}` : v === 0 ? "level" : v}</span>;
}

export function HoleCell({ score, par, capped, capTo }: { score: number | null; par: number | undefined; capped?: boolean; capTo?: number | null }) {
  if (score == null || par == null) return <div className="hole c-par" style={{ opacity: 0.35 }}>–</div>;
  const c = coxCategory(score, par);
  return (
    <div className={`hole c-${c.cat} ${capped ? "capped" : ""}`} data-cap={capped && capTo != null ? capTo : undefined} title={c.label}>
      {score}
    </div>
  );
}

/**
 * Index-over-time. A promotion changes the ruler, so the line is broken there and a
 * brass tick marks it — the jump is not form, it's a new scale.
 */
export function Sparkline({ hist, width = 140, height = 22 }: { hist: { value: number; promoted?: boolean }[]; width?: number; height?: number }) {
  if (hist.length < 2) return null;
  const w = width, h = height;
  const vals = hist.map((x) => x.value);
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1;
  const X = (i: number) => (i / (vals.length - 1)) * w;
  const Y = (v: number) => h - (((v - mn) / rng) * (h - 4) + 2);
  // split into segments at each promotion
  const segs: string[][] = [[]];
  const ticks: number[] = [];
  hist.forEach((p, i) => {
    if (p.promoted && i > 0) {
      segs.push([]);
      ticks.push(X(i));
    }
    segs[segs.length - 1].push(`${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`);
  });
  const good = vals[vals.length - 1] <= vals[0];
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {ticks.map((x, i) => <line key={i} x1={x} x2={x} y1={0} y2={h} stroke="#C9A227" strokeWidth="1" strokeDasharray="2 2" />)}
      {segs.map((pts, i) => (
        <polyline key={i} points={pts.join(" ")} fill="none" stroke={good ? "#7CC47F" : "#D2593F"} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      ))}
    </svg>
  );
}

export function TierBadge({ tier }: { tier: "cox45" | "pro" | "whs" }) {
  if (tier === "cox45") return null;
  return <span className={`tier ${tier}`} title={tier === "pro" ? "Cox 45 Pro" : "WHS Only"}>{tier === "pro" ? "PRO" : "WHS"}</span>;
}

export function Trend({ t }: { t: { dir: "up" | "down" | "flat"; delta: number } | null }) {
  if (!t) return null;
  if (t.dir === "up") return <span className="trend up">▼ {Math.abs(t.delta).toFixed(1)}</span>;
  if (t.dir === "down") return <span className="trend down">▲ {Math.abs(t.delta).toFixed(1)}</span>;
  return <span className="trend flat">— steady</span>;
}

export function Crest() {
  return (
    <svg viewBox="0 0 34 38" aria-hidden="true">
      <path d="M17 1 L32 6 V19 C32 28 25 34 17 37 C9 34 2 28 2 19 V6 Z" fill="#122E23" stroke="#C9A227" strokeWidth="1.6" />
      <path d="M17 5 L28 8.6 V19 C28 25.5 23 30.5 17 33 C11 30.5 6 25.5 6 19 V8.6 Z" fill="none" stroke="#C9A227" strokeWidth="0.8" opacity=".6" />
      <circle cx="17" cy="15.5" r="4.2" fill="none" stroke="#EFE7D2" strokeWidth="1.3" />
      <path d="M17 19.7 V27 M13.5 27 H20.5" stroke="#EFE7D2" strokeWidth="1.3" strokeLinecap="round" />
      <text x="17" y="17" textAnchor="middle" fontFamily="Anton, Impact, sans-serif" fontSize="6" fill="#EFE7D2">45</text>
    </svg>
  );
}

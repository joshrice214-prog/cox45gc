"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Review } from "@/components/RoundReview";
import { saveRound } from "@/lib/data";
import { prepScorecardImage } from "@/lib/image";
import { validate, type Issue, type Parsed } from "@/lib/scorecard";

type Shot = { b64: string; mime: string; preview: string; name: string };
type Status = "queued" | "reading" | "ready" | "failed" | "saved" | "skipped";
interface Item {
  shot: Shot;
  status: Status;
  parsed: Parsed | null;
  issues: Issue[];
  secondPass: boolean;
  error: string | null;
}

/**
 * Each screenshot here is treated as its own complete round — unlike Add
 * Round, where multiple images are pages of ONE card. Order of import
 * doesn't matter: the handicap engine always re-sorts by date and
 * recomputes from every round on record.
 */
export default function BulkImport() {
  const { data, me, refresh, toast } = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState(0); // index of the round currently under review
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!data) return null;

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    // Snapshot immediately: e.target.files is a *live* FileList tied to the
    // input element. The caller clears the input right after calling this
    // (so the same photos can be picked again later), and since this
    // function is async, that reset can otherwise empty the very list
    // we're still iterating over — silently dropping everything after the
    // first file. Copying it to a plain array up front avoids that.
    const files = Array.from(fileList);
    setBusy("Preparing images…");
    const added: Item[] = [];
    for (const f of files) {
      try {
        const shot = { ...(await prepScorecardImage(f)), name: f.name };
        added.push({ shot, status: "queued", parsed: null, issues: [], secondPass: false, error: null });
      } catch {
        added.push({ shot: { b64: "", mime: "", preview: "", name: f.name }, status: "failed", parsed: null, issues: [], secondPass: false, error: "Couldn't open this image." });
      }
    }
    setItems((prev) => [...prev, ...added]);
    setBusy(null);
  };

  const readOne = async (idx: number, list: Item[]): Promise<Item> => {
    const it = list[idx];
    if (it.status === "failed") return it;
    try {
      const res = await fetch("/api/read-scorecard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: [{ mime: it.shot.mime, b64: it.shot.b64 }],
          players: data.players.map((p) => p.name),
          courses: data.courses.map((c) => ({ name: c.name, holes: c.holes, pars: c.pars, stroke_index: c.stroke_index, course_rating: c.course_rating, slope: c.slope })),
          importerName: me?.name ?? null,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "read failed");
      return { ...it, status: "ready", parsed: j.parsed, issues: j.issues, secondPass: j.secondPassDone };
    } catch (e) {
      return { ...it, status: "failed", error: e instanceof Error ? e.message : "Couldn't read this one" };
    }
  };

  const readAll = async () => {
    const queued = items.map((it, i) => ({ it, i })).filter((x) => x.it.status === "queued");
    if (!queued.length) return;
    let working = [...items];
    for (let n = 0; n < queued.length; n++) {
      const { i } = queued[n];
      working = working.map((it, k) => (k === i ? { ...it, status: "reading" } : it));
      setItems(working);
      setBusy(`Reading ${n + 1} of ${queued.length}…`);
      const done = await readOne(i, working);
      working = working.map((it, k) => (k === i ? done : it));
      setItems(working);
    }
    setBusy(null);
    setCursor((c) => {
      const firstReady = working.findIndex((it, k) => k >= c && (it.status === "ready" || it.status === "failed"));
      return firstReady >= 0 ? firstReady : c;
    });
  };

  const advance = () => setCursor((c) => Math.min(items.length, c + 1));

  const saveCurrent = async (p: Parsed) => {
    setBusy("Saving…");
    try {
      const valid = p.players.filter((x) => x.name.trim() && x.gross);
      if (!p.course.trim() || !valid.length) throw new Error("Needs at least a course and one player's score");
      await saveRound(
        { course: { name: p.course, holes: p.holes, pars: p.pars as number[], strokeIndex: p.strokeIndex, courseRating: p.courseRating, slope: p.slope }, date: p.date, eventId: null, players: valid.map((x) => ({ name: x.name.trim(), scores: x.scores, gross: x.gross! })) },
        data,
      );
      setItems((prev) => prev.map((it, k) => (k === cursor ? { ...it, status: "saved" } : it)));
      toast(`Saved · ${cursor + 1} of ${items.length}`);
      advance();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save that one");
    } finally {
      setBusy(null);
    }
  };

  const done = items.length > 0 && items.every((it) => it.status === "saved" || it.status === "skipped");
  const savedCount = items.filter((it) => it.status === "saved").length;
  const current = items[cursor];
  const anyQueued = items.some((it) => it.status === "queued");

  // ---- the review-one-round screen ----
  if (current && (current.status === "ready" || current.status === "reading")) {
    if (current.status === "reading" || !current.parsed) {
      return (
        <div className="empty">
          <span className="spinner" style={{ marginRight: 8 }} />Reading {current.shot.name || `image ${cursor + 1}`}…
        </div>
      );
    }
    return (
      <>
        <Progress items={items} cursor={cursor} />
        <img src={current.shot.preview} alt="" style={{ width: "100%", maxHeight: 160, objectFit: "cover", borderRadius: 12, marginBottom: 12, border: "1px solid var(--line)" }} />
        <Review
          p={current.parsed}
          issues={current.issues}
          secondPass={current.secondPass}
          fromPhoto
          busy={busy}
          err=""
          onChange={(np) => setItems((prev) => prev.map((it, k) => (k === cursor ? { ...it, parsed: np, issues: validate(np) } : it)))}
          onCancel={() => {
            setItems((prev) => prev.map((it, k) => (k === cursor ? { ...it, status: "skipped" } : it)));
            advance();
          }}
          onSave={(p) => saveCurrent(p)}
        />
        <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => { setItems((prev) => prev.map((it, k) => (k === cursor ? { ...it, status: "skipped" } : it))); advance(); }}>
          Skip this one for now
        </button>
      </>
    );
  }

  if (current && current.status === "failed") {
    return (
      <>
        <Progress items={items} cursor={cursor} />
        <img src={current.shot.preview} alt="" style={{ width: "100%", maxHeight: 200, objectFit: "cover", borderRadius: 12, marginBottom: 12, border: "1px solid var(--line)" }} />
        <div className="err">Couldn't read {current.shot.name || "this image"}{current.error ? `: ${current.error}` : ""}.</div>
        <div className="muted small" style={{ marginBottom: 12 }}>Usually a brighter or straighter screenshot fixes it. Skip it here and come back with a better one later.</div>
        <div className="row-btns">
          <button className="btn ghost" onClick={() => { setItems((prev) => prev.map((it, k) => (k === cursor ? { ...it, status: "skipped" } : it))); advance(); }}>Skip</button>
          <button className="btn" onClick={async () => { setItems((prev) => prev.map((it, k) => (k === cursor ? { ...it, status: "reading" } : it))); const done = await readOne(cursor, items); setItems((prev) => prev.map((it, k) => (k === cursor ? done : it))); }}>Try again</button>
        </div>
      </>
    );
  }

  // ---- the intake screen ----
  return (
    <>
      <div className="sec-title" style={{ marginTop: 0 }}>Bulk import old rounds</div>
      <div className="muted" style={{ marginBottom: 14, lineHeight: 1.55 }}>
        Add every screenshot you've got — 18Birdies, Golfshot, whatever. Each one is read as its own complete round, then you step through and confirm each before it saves. Import order doesn't matter; the handicaps recompute from the dates either way.
      </div>

      {items.length === 0 || anyQueued ? (
        <>
          <button className="drop" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 15l4.5-4.5 3.5 3.5 3-3L21 17" /><circle cx="8.5" cy="9" r="1.3" /></svg>
            <div className="t">Add scorecard screenshots</div>
            <div className="s">Select as many as you like at once — each becomes one round.</div>
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        </>
      ) : null}

      {items.length > 0 && (
        <>
          <div className="thumbs">
            {items.map((it, i) => (
              <div key={i} className="thumb">
                {it.shot.preview && <img src={it.shot.preview} alt="" style={{ opacity: it.status === "saved" || it.status === "skipped" ? 0.4 : 1 }} />}
                {it.status !== "queued" && <StatusDot status={it.status} />}
                {it.status === "queued" && (
                  <button onClick={() => setItems((prev) => prev.filter((_, k) => k !== i))} aria-label="Remove">×</button>
                )}
              </div>
            ))}
          </div>
          {anyQueued ? (
            <button className="btn" onClick={readAll} disabled={!!busy}>
              {busy ? <><span className="spinner" />{busy}</> : `Read ${items.filter((it) => it.status === "queued").length} scorecard${items.filter((it) => it.status === "queued").length === 1 ? "" : "s"}`}
            </button>
          ) : done ? (
            <div className="ok">
              {savedCount} round{savedCount === 1 ? "" : "s"} imported{items.some((it) => it.status === "skipped") ? `, ${items.filter((it) => it.status === "skipped").length} skipped` : ""}. <Link href="/rounds">See them in Rounds</Link> or <Link href="/leaderboard">check the leaderboard</Link>.
            </div>
          ) : (
            <button className="btn" onClick={() => setCursor(0)}>Review {items.filter((it) => it.status === "ready" || it.status === "failed").length} read scorecards</button>
          )}
        </>
      )}
    </>
  );
}

function Progress({ items, cursor }: { items: Item[]; cursor: number }) {
  const saved = items.filter((it) => it.status === "saved").length;
  return (
    <div className="sec-row" style={{ marginTop: 0 }}>
      <div className="sec-title" style={{ margin: 0 }}>Round {cursor + 1} of {items.length}</div>
      <div className="muted small">{saved} saved</div>
    </div>
  );
}

function StatusDot({ status }: { status: Status }) {
  const map: Record<string, string> = { ready: "var(--brass)", failed: "var(--bad)", saved: "var(--good)", skipped: "var(--cream-dim)", reading: "var(--amber)" };
  return <span style={{ position: "absolute", bottom: -4, right: -4, width: 14, height: 14, borderRadius: "50%", background: map[status] ?? "var(--cream-dim)", border: "2px solid var(--pine-2)" }} />;
}

"use client";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/AppProvider";
import { Review, blankPlayer } from "@/components/RoundReview";
import { saveRound } from "@/lib/data";
import { prepScorecardImage } from "@/lib/image";
import { validate, type Issue, type Parsed } from "@/lib/scorecard";
import { today } from "@/lib/stats";

type Shot = { b64: string; mime: string; preview: string };

export default function AddRound() {
  const { data, refresh, toast } = useApp();
  const router = useRouter();
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [pending, setPending] = useState<Parsed | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [secondPass, setSecondPass] = useState(false);
  const [fromPhoto, setFromPhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!data) return null;

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setErr("");
    setBusy("Preparing…");
    const next = [...shots];
    for (const f of [...files].slice(0, 4 - shots.length)) {
      try {
        next.push(await prepScorecardImage(f));
      } catch {
        setErr("One of those images wouldn't open. Try a different photo.");
      }
    }
    setShots(next);
    setBusy(null);
  };

  const read = async () => {
    setErr("");
    setBusy("Reading the card…");
    try {
      const res = await fetch("/api/read-scorecard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: shots.map((s) => ({ mime: s.mime, b64: s.b64 })),
          players: data.players.map((p) => p.name),
          courses: data.courses.map((c) => ({ name: c.name, holes: c.holes, pars: c.pars, stroke_index: c.stroke_index, course_rating: c.course_rating, slope: c.slope })),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "read failed");
      setPending(j.parsed);
      setIssues(j.issues);
      setSecondPass(j.secondPassDone);
      setFromPhoto(true);
    } catch (e) {
      setErr(`Couldn't read that one${e instanceof Error && e.message ? ` (${e.message})` : ""}. A straighter, brighter shot of the whole card usually fixes it — or type the round in by hand.`);
    } finally {
      setBusy(null);
    }
  };

  const manual = () => {
    setPending({
      course: "",
      date: today(),
      holes: 18,
      tee: null,
      pars: Array(18).fill(4),
      strokeIndex: Array(18).fill(null),
      parOut: null,
      parIn: null,
      parTotal: 72,
      courseRating: null,
      slope: null,
      players: data.players.slice(0, 4).map((p) => blankPlayer(p.name, 18)),
      unreadable: [],
      ratingSource: null,
      ratingNote: null,
    });
    setIssues([]);
    setSecondPass(false);
    setFromPhoto(false);
  };

  if (pending)
    return (
      <Review
        p={pending}
        issues={issues}
        secondPass={secondPass}
        fromPhoto={fromPhoto}
        busy={busy}
        err={err}
        onChange={(np) => {
          setPending(np);
          setIssues(validate(np));
        }}
        onCancel={() => {
          setPending(null);
          setShots([]);
          setIssues([]);
          setErr("");
        }}
        onSave={async (p, eventId) => {
          setErr("");
          if (!p.course.trim()) return setErr("Give the course a name so the round can be saved.");
          const valid = p.players.filter((x) => x.name.trim() && x.gross);
          if (!valid.length) return setErr("At least one player needs a name and a score.");
          if (p.pars.some((v) => v == null)) return setErr("Every hole needs a par.");
          setBusy("Saving…");
          try {
            await saveRound(
              {
                course: { name: p.course, holes: p.holes, pars: p.pars as number[], strokeIndex: p.strokeIndex, courseRating: p.courseRating, slope: p.slope },
                date: p.date,
                eventId,
                players: valid.map((x) => ({ name: x.name.trim(), scores: x.scores, gross: x.gross! })),
              },
              data,
            );
            await refresh();
            toast("Round saved");
            setPending(null);
            setShots([]);
            router.push("/rounds");
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Couldn't save");
          } finally {
            setBusy(null);
          }
        }}
      />
    );

  return (
    <>
      {err && <div className="err">{err}</div>}
      <button className="drop" onClick={() => fileRef.current?.click()} disabled={!!busy || shots.length >= 4}>
        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 15l4.5-4.5 3.5 3.5 3-3L21 17" /><circle cx="8.5" cy="9" r="1.3" /></svg>
        <div className="t">{shots.length ? "Add another page" : "Add your scorecard"}</div>
        <div className="s">Photo of the card, or a screenshot from your golf app.<br />Front and back nine? Add both together.</div>
      </button>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      {shots.length > 0 && (
        <>
          <div className="thumbs">
            {shots.map((s, i) => (
              <div key={i} className="thumb">
                <img src={s.preview} alt={`Scorecard page ${i + 1}`} />
                <button onClick={() => setShots(shots.filter((_, k) => k !== i))} aria-label="Remove">×</button>
              </div>
            ))}
          </div>
          <button className="btn" onClick={read} disabled={!!busy}>
            {busy ? <><span className="spinner" />{busy}</> : "Read this scorecard"}
          </button>
        </>
      )}
      <div className="panel" style={{ marginTop: 14 }}>
        <div className="muted" style={{ lineHeight: 1.6 }}>
          Getting a clean read: fill the frame with the card, keep it flat and square on, and let there be plenty of light. Make sure the par and stroke index rows are in shot — they're what make the handicap maths work.
        </div>
      </div>
      <button className="btn ghost" onClick={manual}>Type the round in by hand</button>
      <div className="panel" style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div className="muted small">Got a backlog of old rounds on 18Birdies or another app?</div>
        <Link href="/import" className="btn ghost slim">Bulk import</Link>
      </div>
    </>
  );
}

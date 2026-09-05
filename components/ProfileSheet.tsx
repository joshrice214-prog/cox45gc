"use client";
import { useEffect, useRef, useState } from "react";
import { useApp } from "./AppProvider";
import { Avatar, Sheet } from "./ui";
import { upsertPlayer, uploadAvatar } from "@/lib/data";
import { prepAvatar } from "@/lib/image";
import { currentSubscription, isInstalled, isIOS, pushSupported, subscribeToPush, unsubscribeFromPush } from "@/lib/push";

export default function ProfileSheet({ forced, onClose }: { forced: boolean; onClose: () => void }) {
  const { data, me, setMeId, refresh, toast } = useApp();
  const [first, setFirst] = useState(me?.first_name ?? "");
  const [last, setLast] = useState(me?.last_name ?? "");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [push, setPush] = useState<"on" | "off" | "checking">("checking");
  const [installed, setInstalled] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // keyed on the id, not the object: background refreshes must not wipe what's being typed
  const meId = me?.id;
  useEffect(() => {
    setFirst(me?.first_name ?? me?.name ?? "");
    setLast(me?.last_name ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);

  useEffect(() => {
    setInstalled(isInstalled());
    currentSubscription().then((s) => setPush(s ? "on" : "off")).catch(() => setPush("off"));
  }, []);

  const close = () => {
    if (!forced) onClose();
  };

  if (!me) {
    return (
      <Sheet title="Who are you?" sub="So your rounds, RSVPs and availability are yours. Remembered on this phone." onClose={close}>
        {data?.players.map((p) => (
          <button key={p.id} className="btn ghost" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 10, textAlign: "left" }} onClick={() => setMeId(p.id)}>
            <Avatar p={p} /> {p.name}
          </button>
        ))}
        <label className="f" style={{ marginTop: 14 }}>
          <span>Someone new</span>
          <input className="f" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="First name" />
        </label>
        {err && <div className="err">{err}</div>}
        <button
          className="btn"
          disabled={busy || !newName.trim()}
          onClick={async () => {
            setBusy(true);
            setErr("");
            try {
              const p = await upsertPlayer({ name: newName.trim(), first_name: newName.trim() });
              await refresh();
              setMeId(p.id);
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Couldn't save");
            } finally {
              setBusy(false);
            }
          }}
        >
          Join the club
        </button>
      </Sheet>
    );
  }

  const save = async () => {
    if (!first.trim() || !last.trim()) {
      setErr("First and last name, please — it's a members' club.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await upsertPlayer({ id: me.id, name: me.name, first_name: first.trim(), last_name: last.trim() });
      await refresh();
      toast("Profile saved");
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setErr("");
    try {
      const blob = await prepAvatar(f);
      await uploadAvatar(me.id, blob);
      await refresh();
      toast("Photo updated");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't upload the photo");
    } finally {
      setBusy(false);
    }
  };

  const togglePush = async () => {
    if (push === "on") {
      await unsubscribeFromPush();
      setPush("off");
      toast("Notifications off");
      return;
    }
    const r = await subscribeToPush(me.id);
    if (r === "ok") {
      setPush("on");
      toast("Notifications on");
    } else if (r === "denied") setErr("Notifications were blocked. Allow them in your phone's settings for Cox 45.");
    else if (r === "unsupported") setErr(isIOS() && !installed ? "On iPhone, add Cox 45 to your Home Screen first, then turn notifications on from there." : "This browser can't do push notifications.");
    else setErr("Couldn't turn notifications on. Check the VAPID keys are set.");
  };

  return (
    <Sheet title={forced ? "Welcome to the club" : me.name} sub={forced ? "Set your name and photo once — it's remembered from here on." : "Your profile"} onClose={close}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        <Avatar p={me} size="xl" />
        <div>
          <button className="btn ghost slim" onClick={() => fileRef.current?.click()} disabled={busy}>
            {me.photo_url ? "Change photo" : "Add a photo"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
        </div>
      </div>
      <div className="grid2">
        <label className="f"><span>First name</span><input className="f" value={first} onChange={(e) => setFirst(e.target.value)} /></label>
        <label className="f"><span>Last name</span><input className="f" value={last} onChange={(e) => setLast(e.target.value)} /></label>
      </div>
      {err && <div className="err">{err}</div>}

      {!installed && (
        <div className="install-banner">
          <b>Add Cox 45 to your Home Screen</b>
          It becomes a real app — its own icon, no browser bars, and notifications can be switched on.
          {isIOS() ? (
            <ol><li>Tap the Share button in Safari</li><li>Choose “Add to Home Screen”</li><li>Open Cox 45 from the icon</li></ol>
          ) : (
            <ol><li>Open the browser menu (⋮)</li><li>Choose “Add to Home screen” or “Install app”</li></ol>
          )}
        </div>
      )}
      {pushSupported() && installed && (
        <button className={`btn ghost ${push === "on" ? "on" : ""}`} style={{ marginBottom: 9 }} onClick={togglePush} disabled={push === "checking"}>
          {push === "on" ? "Notifications are on" : "Turn notifications on"}
        </button>
      )}

      <div className="row-btns">
        <button className="btn ghost" onClick={() => { setMeId(null); onClose(); }}>
          Not you?
        </button>
        <button className="btn" onClick={save} disabled={busy}>
          {busy ? <><span className="spinner" />Saving</> : "Save"}
        </button>
      </div>
    </Sheet>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { Avatar, Crest } from "./ui";
import ProfileSheet from "./ProfileSheet";
import { registerServiceWorker } from "@/lib/push";

const TABS: [string, string, string][] = [
  ["/", "Clubhouse", "M3 11 12 3l9 8v10H3z M10 21v-6h4v6"],
  ["/rounds", "Rounds", "M4 5h16M4 12h16M4 19h10"],
  ["/add", "Add round", "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8v8M8 12h8"],
  ["/leaderboard", "Leaderboard", "M4 20V10h4v10zM10 20V4h4v16zM16 20v-7h4v7zM2 20h20"],
  ["/events", "Events", "M3 5h18v16H3z M8 3v4M16 3v4M3 10h18"],
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { me, data, loading, error } = useApp();
  const [profile, setProfile] = useState(false);

  useEffect(() => {
    registerServiceWorker();
  }, []);

  // first-run: pick who you are
  const needsMe = !loading && data && !me;
  const needsProfile = !!me && (!me.first_name || !me.last_name);

  return (
    <div id="app">
      <header className="topbar">
        <Link href="/" className="crest" aria-label="Cox 45 clubhouse">
          <Crest />
          <div className="wordmark">
            COX <em>45</em>
            <span className="tm">™</span>
            <small>GOLF CLUB</small>
          </div>
        </Link>
        <button className="whoami" onClick={() => setProfile(true)} aria-label="Your profile">
          <Avatar p={me} size="sm" />
          {me ? me.name : "Who are you?"}
        </button>
      </header>
      <main className="view">
        {error && <div className="err">Couldn't reach the clubhouse: {error}</div>}
        {loading ? <div className="empty">Opening the clubhouse…</div> : children}
      </main>
      <nav className="tabs" aria-label="Main">
        {TABS.map(([href, label, d]) => (
          <Link key={href} href={href} className={path === href || (href !== "/" && path.startsWith(href)) ? "on" : ""}>
            <svg viewBox="0 0 24 24"><path d={d} /></svg>
            {label}
          </Link>
        ))}
      </nav>
      {(profile || needsMe || needsProfile) && <ProfileSheet forced={!!(needsMe || needsProfile)} onClose={() => setProfile(false)} />}
    </div>
  );
}

"use client";

import { useState, useEffect, useRef } from "react";

interface Org {
  id: string;
  name: string;
  slug: string;
}

export default function OrgSwitcher() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Org | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = document.cookie
      .split("; ")
      .find((r) => r.startsWith("token="))
      ?.split("=")[1];
    if (!token) return;

    // Decode JWT to get current orgId
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      const currentOrgId = payload.orgId;

      fetch(`${process.env.NEXT_PUBLIC_API_URL}/organizations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((data: Org[]) => {
          if (!Array.isArray(data)) return;
          setOrgs(data);
          const active = data.find((o) => o.id === currentOrgId) ?? data[0] ?? null;
          setCurrentOrg(active);
        })
        .catch(() => {});
    } catch {}
  }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function switchOrg(org: Org) {
    if (org.id === currentOrg?.id || switching) return;
    setSwitching(true);
    const token = document.cookie
      .split("; ")
      .find((r) => r.startsWith("token="))
      ?.split("=")[1];
    if (!token) return;

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/organizations/${org.id}/switch`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const { accessToken } = await res.json();
        // Overwrite cookie
        document.cookie = `token=${accessToken}; path=/; max-age=900`;
        setCurrentOrg(org);
        setOpen(false);
        window.location.reload();
      }
    } finally {
      setSwitching(false);
    }
  }

  if (!currentOrg) return null;

  const initials = currentOrg.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "6px 12px 6px 8px",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: "10px",
          cursor: "pointer",
          color: "var(--color-text-primary)",
          fontFamily: "var(--font-sans)",
          fontSize: "0.875rem",
          fontWeight: 500,
          transition: "all 0.2s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(99,102,241,0.5)";
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(99,102,241,0.08)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.10)";
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
        }}
      >
        {/* Avatar */}
        <span style={{
          width: "26px",
          height: "26px",
          borderRadius: "6px",
          background: "linear-gradient(135deg, var(--color-primary), var(--color-secondary))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.7rem",
          fontWeight: 700,
          color: "#fff",
          flexShrink: 0,
        }}>
          {initials}
        </span>

        <span style={{ maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {currentOrg.name}
        </span>

        {/* Chevron */}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 0.2s",
          opacity: 0.6,
        }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          left: 0,
          minWidth: "220px",
          background: "rgba(18,18,26,0.95)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "12px",
          backdropFilter: "blur(20px)",
          boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
          zIndex: 1000,
          overflow: "hidden",
          animation: "slideDown 0.15s ease-out",
        }}>
          <div style={{
            padding: "8px 12px 6px",
            fontSize: "0.7rem",
            color: "var(--color-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 600,
          }}>
            Your Organizations
          </div>

          {orgs.map((org) => {
            const active = org.id === currentOrg.id;
            const orgInitials = org.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
            return (
              <button
                key={org.id}
                onClick={() => switchOrg(org)}
                disabled={switching}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 12px",
                  background: active ? "rgba(99,102,241,0.1)" : "transparent",
                  border: "none",
                  borderLeft: active ? "2px solid var(--color-primary)" : "2px solid transparent",
                  cursor: switching ? "wait" : "pointer",
                  color: "var(--color-text-primary)",
                  fontFamily: "var(--font-sans)",
                  fontSize: "0.875rem",
                  textAlign: "left",
                  transition: "background 0.15s",
                  opacity: switching && !active ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!active) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseLeave={(e) => {
                  if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                <span style={{
                  width: "24px",
                  height: "24px",
                  borderRadius: "6px",
                  background: active
                    ? "linear-gradient(135deg, var(--color-primary), var(--color-secondary))"
                    : "rgba(255,255,255,0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  color: "#fff",
                  flexShrink: 0,
                }}>
                  {orgInitials}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {org.name}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                    /{org.slug}
                  </div>
                </div>
                {active && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7l3.5 3.5L12 3" stroke="var(--color-primary)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            );
          })}

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "4px 0" }} />
          <a
            href="/dashboard/team"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 12px",
              color: "var(--color-text-secondary)",
              textDecoration: "none",
              fontSize: "0.875rem",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-secondary)")}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="9" cy="4" r="2" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M1 11c0-2.21 1.79-4 4-4M9 7c2.21 0 4 1.79 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Manage Team
          </a>
        </div>
      )}

      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

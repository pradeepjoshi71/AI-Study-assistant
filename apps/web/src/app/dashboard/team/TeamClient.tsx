"use client";

import { useState } from "react";

interface Member {
  id: string;
  role: string;
  joinedAt: string;
  user: { id: string; name: string; email: string; avatar: string | null };
}

interface TeamClientProps {
  members: Member[];
  orgId: string;
  currentUserId: string;
  currentUserRole: string;
  token: string;
}

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  OWNER:  { bg: "rgba(251,191,36,0.12)",  text: "#fbbf24", border: "rgba(251,191,36,0.3)"  },
  ADMIN:  { bg: "rgba(99,102,241,0.12)",  text: "#818cf8", border: "rgba(99,102,241,0.3)"  },
  MEMBER: { bg: "rgba(16,185,129,0.12)",  text: "#34d399", border: "rgba(16,185,129,0.3)"  },
  VIEWER: { bg: "rgba(107,114,128,0.12)", text: "#9ca3af", border: "rgba(107,114,128,0.3)" },
};

const ROLES_ASSIGNABLE = ["ADMIN", "MEMBER", "VIEWER"] as const;

export default function TeamClient({
  members: initial,
  orgId,
  currentUserId,
  currentUserRole,
  token,
}: TeamClientProps) {
  const [members, setMembers] = useState<Member[]>(initial);
  const [removing, setRemoving] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
  const canManage = currentUserRole === "OWNER" || currentUserRole === "ADMIN";

  function notify(msg: string, isError = false) {
    if (isError) setError(msg);
    else setSuccess(msg);
    setTimeout(() => { setError(null); setSuccess(null); }, 4000);
  }

  async function removeMember(memberId: string, memberUserId: string) {
    if (!confirm("Remove this member from the organization?")) return;
    setRemoving(memberUserId);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/organizations/${orgId}/members/${memberUserId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        notify(body.message || "Failed to remove member", true);
        return;
      }
      setMembers((m) => m.filter((x) => x.user.id !== memberUserId));
      notify("Member removed successfully");
    } catch {
      notify("Network error", true);
    } finally {
      setRemoving(null);
    }
  }

  async function changeRole(memberUserId: string, newRole: string) {
    setUpdating(memberUserId);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/organizations/${orgId}/members/${memberUserId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        notify(body.message || "Failed to update role", true);
        return;
      }
      const updated = await res.json();
      setMembers((m) => m.map((x) => x.user.id === memberUserId ? { ...x, role: updated.role } : x));
      notify("Role updated");
    } catch {
      notify("Network error", true);
    } finally {
      setUpdating(null);
    }
  }

  return (
    <div>
      {/* Toast */}
      {(error || success) && (
        <div style={{
          position: "fixed", bottom: "24px", right: "24px", zIndex: 1000,
          padding: "14px 20px", borderRadius: "10px", fontSize: "0.875rem", fontWeight: 500,
          background: error ? "rgba(244,63,94,0.15)" : "rgba(16,185,129,0.15)",
          border: `1px solid ${error ? "rgba(244,63,94,0.3)" : "rgba(16,185,129,0.3)"}`,
          color: error ? "#f43f5e" : "#10b981",
          backdropFilter: "blur(10px)",
          animation: "slideInRight 0.25s ease",
        }}>
          {error || success}
        </div>
      )}

      {/* Member list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {members.map((m) => {
          const rc = ROLE_COLORS[m.role] ?? ROLE_COLORS.VIEWER;
          const isSelf = m.user.id === currentUserId;
          const isOwner = m.role === "OWNER";

          return (
            <div key={m.id} style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              padding: "14px 18px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "12px",
              transition: "border-color 0.2s",
            }}>
              {/* Avatar */}
              <div style={{
                width: "40px", height: "40px", borderRadius: "10px", flexShrink: 0,
                background: "linear-gradient(135deg, var(--color-primary), var(--color-secondary))",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.875rem", fontWeight: 700, color: "#fff",
              }}>
                {(m.user.name || m.user.email).slice(0, 1).toUpperCase()}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "6px" }}>
                  {m.user.name || "—"}
                  {isSelf && (
                    <span style={{ fontSize: "0.7rem", padding: "1px 6px", background: "rgba(99,102,241,0.12)", color: "var(--color-primary)", borderRadius: "4px" }}>You</span>
                  )}
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>{m.user.email}</div>
              </div>

              {/* Role */}
              <div>
                {canManage && !isOwner && !isSelf ? (
                  <select
                    value={m.role}
                    disabled={updating === m.user.id}
                    onChange={(e) => changeRole(m.user.id, e.target.value)}
                    style={{
                      padding: "4px 10px", borderRadius: "8px", fontSize: "0.8rem", fontWeight: 600,
                      background: rc.bg, color: rc.text, border: `1px solid ${rc.border}`,
                      cursor: "pointer", fontFamily: "var(--font-sans)",
                    }}
                  >
                    {ROLES_ASSIGNABLE.map((r) => (
                      <option key={r} value={r} style={{ background: "#121216", color: "#f4f4f7" }}>{r}</option>
                    ))}
                  </select>
                ) : (
                  <span style={{
                    padding: "4px 12px", borderRadius: "8px", fontSize: "0.8rem", fontWeight: 600,
                    background: rc.bg, color: rc.text, border: `1px solid ${rc.border}`,
                    textTransform: "uppercase", letterSpacing: "0.05em",
                  }}>
                    {m.role}
                  </span>
                )}
              </div>

              {/* Actions */}
              {canManage && !isOwner && (
                <button
                  onClick={() => removeMember(m.id, m.user.id)}
                  disabled={removing === m.user.id}
                  title="Remove member"
                  style={{
                    width: "32px", height: "32px", borderRadius: "8px", border: "1px solid rgba(244,63,94,0.2)",
                    background: "rgba(244,63,94,0.08)", color: "#f43f5e", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.2s", flexShrink: 0,
                    opacity: removing === m.user.id ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(244,63,94,0.2)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(244,63,94,0.08)"; }}
                >
                  {removing === m.user.id ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8" strokeLinecap="round" style={{ animation: "spin 0.8s linear infinite" }}/></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2h4v2M6 7v4M8 7v4M3 4l.8 8h6.4L11 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        select option { background: #121216; color: #f4f4f7; }
      `}</style>
    </div>
  );
}

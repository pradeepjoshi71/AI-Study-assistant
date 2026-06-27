"use client";

import { useState } from "react";

interface InviteFormProps {
  orgId: string;
  token: string;
  onInvited: () => void;
}

export default function InviteForm({ orgId, token, onInvited }: InviteFormProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/organizations/${orgId}/invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.message || "Failed to send invite");
        return;
      }
      setSent(true);
      setEmail("");
      onInvited();
      setTimeout(() => setSent(false), 4000);
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {sent && (
        <div style={{
          padding: "12px 16px", marginBottom: "16px",
          background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)",
          borderRadius: "10px", color: "#34d399", fontSize: "0.875rem", fontWeight: 500,
        }}>
          ✓ Invitation sent! The link expires in 48 hours.
        </div>
      )}
      {error && (
        <div style={{
          padding: "12px 16px", marginBottom: "16px",
          background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.25)",
          borderRadius: "10px", color: "#f43f5e", fontSize: "0.875rem",
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <input
          type="email"
          required
          placeholder="colleague@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{
            flex: "1 1 240px",
            padding: "10px 14px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "10px",
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-sans)",
            fontSize: "0.875rem",
            outline: "none",
            transition: "border-color 0.2s",
          }}
          onFocus={(e) => { e.target.style.borderColor = "rgba(99,102,241,0.5)"; }}
          onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.1)"; }}
        />

        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          style={{
            padding: "10px 14px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "10px",
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-sans)",
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          <option value="ADMIN">Admin</option>
          <option value="MEMBER">Member</option>
          <option value="VIEWER">Viewer</option>
        </select>

        <button
          type="submit"
          disabled={loading || !email.trim()}
          style={{
            padding: "10px 20px",
            background: loading ? "rgba(99,102,241,0.4)" : "var(--color-primary)",
            border: "none",
            borderRadius: "10px",
            color: "#fff",
            fontFamily: "var(--font-sans)",
            fontSize: "0.875rem",
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
            transition: "all 0.2s",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          {loading ? (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ animation: "spin 0.8s linear infinite" }}>
                <circle cx="7" cy="7" r="5" stroke="white" strokeWidth="1.5" strokeDasharray="8" strokeLinecap="round"/>
              </svg>
              Sending…
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 7h12M8 2l5 5-5 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Send Invite
            </>
          )}
        </button>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </form>
  );
}

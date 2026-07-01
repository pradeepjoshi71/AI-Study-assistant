"use client";

import { useState } from "react";

interface Referral {
  id: string;
  code: string;
  ip: string | null;
  deviceFingerprint: string | null;
  status: string;
  createdAt: string;
  referrer: {
    id: string;
    name: string | null;
    email: string;
  };
  referee: {
    id: string;
    name: string | null;
    email: string;
  } | null;
}

interface AdminReferralsClientProps {
  token: string;
  initialFraudReferrals: Referral[];
}

export default function AdminReferralsClient({
  token,
  initialFraudReferrals,
}: AdminReferralsClientProps) {
  const [referrals, setReferrals] = useState<Referral[]>(initialFraudReferrals);
  const [loadingPayout, setLoadingPayout] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const triggerPayout = async () => {
    setLoadingPayout(true);
    setMessage(null);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
      const res = await fetch(`${apiUrl}/admin/referrals/payout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error("Failed to trigger payout");
      const data = await res.json();
      setMessage({ text: data.message || "Payout triggered successfully", type: "success" });
    } catch (err: any) {
      setMessage({ text: err.message || "Failed to trigger payout", type: "error" });
    } finally {
      setLoadingPayout(false);
    }
  };

  const handleApprove = async (id: string) => {
    if (!confirm("Are you sure you want to approve this referral and clear the fraud flag? This will queue a reward payout.")) {
      return;
    }
    setActionLoading(id);
    setMessage(null);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
      const res = await fetch(`${apiUrl}/admin/referrals/${id}/approve`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error("Failed to approve referral");
      const data = await res.json();
      setMessage({ text: data.message || "Referral approved successfully", type: "success" });
      setReferrals(referrals.filter((r) => r.id !== id));
    } catch (err: any) {
      setMessage({ text: err.message || "Failed to approve referral", type: "error" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm("Are you sure you want to reject this referral permanently?")) {
      return;
    }
    setActionLoading(id);
    setMessage(null);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
      const res = await fetch(`${apiUrl}/admin/referrals/${id}/reject`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error("Failed to reject referral");
      const data = await res.json();
      setMessage({ text: data.message || "Referral permanently rejected", type: "success" });
      setReferrals(referrals.filter((r) => r.id !== id));
    } catch (err: any) {
      setMessage({ text: err.message || "Failed to reject referral", type: "error" });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "30px", marginTop: "24px" }}>
      {message && (
        <div className="glass-panel" style={{
          backgroundColor: message.type === "success" ? "rgba(16, 185, 129, 0.1)" : "var(--color-error-glow)",
          border: `1px solid ${message.type === "success" ? "var(--color-success)" : "var(--color-error)"}`,
          color: "var(--color-text-primary)",
          padding: "16px",
          borderRadius: "12px",
        }}>
          {message.text}
        </div>
      )}

      {/* Manual Payout Run Trigger */}
      <section className="glass-panel" style={{ padding: "30px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "20px" }}>
        <div>
          <h2 style={{ fontSize: "1.4rem", color: "#fff", marginBottom: "4px" }}>Trigger Payout Run</h2>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem" }}>
            Force a manual run of the Daily Payout Cron. This will transition held/expired rewards to pending and process eligible Stripe Connect transfers immediately.
          </p>
        </div>
        <button
          onClick={triggerPayout}
          disabled={loadingPayout}
          style={{
            padding: "12px 24px",
            background: "linear-gradient(135deg, var(--color-primary) 0%, #4f46e5 100%)",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(99,102,241,0.2)",
            minWidth: "180px",
          }}
        >
          {loadingPayout ? "Processing..." : "Run Payout Cron Now"}
        </button>
      </section>

      {/* Fraud Flagged Referrals Table */}
      <section className="glass-panel" style={{ padding: "30px" }}>
        <h2 style={{ fontSize: "1.4rem", color: "#fff", marginBottom: "20px" }}>Fraud-Flagged Referrals</h2>
        {referrals.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)", fontSize: "0.95rem" }}>
            No fraud-flagged referrals found. Keep up the clean security metrics!
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.95rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", color: "var(--color-text-muted)" }}>
                  <th style={{ padding: "12px 8px" }}>Created</th>
                  <th style={{ padding: "12px 8px" }}>Referrer (Domain)</th>
                  <th style={{ padding: "12px 8px" }}>Referee (Domain)</th>
                  <th style={{ padding: "12px 8px" }}>Ref IP Address</th>
                  <th style={{ padding: "12px 8px" }}>Device Fingerprint Signature</th>
                  <th style={{ padding: "12px 8px", textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((referral) => (
                  <tr key={referral.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <td style={{ padding: "12px 8px", color: "var(--color-text-secondary)" }}>
                      {new Date(referral.createdAt).toLocaleString()}
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <div>{referral.referrer.name || "N/A"}</div>
                      <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>{referral.referrer.email}</div>
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <div>{referral.referee?.name || "N/A"}</div>
                      <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>{referral.referee?.email || "N/A"}</div>
                    </td>
                    <td style={{ padding: "12px 8px", color: "var(--color-text-secondary)", fontFamily: "monospace" }}>
                      {referral.ip || "N/A"}
                    </td>
                    <td style={{ padding: "12px 8px", color: "var(--color-text-muted)", fontSize: "0.85rem", maxWidth: "250px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={referral.deviceFingerprint || "N/A"}>
                      {referral.deviceFingerprint || "N/A"}
                    </td>
                    <td style={{ padding: "12px 8px", display: "flex", gap: "8px", justifyContent: "center" }}>
                      <button
                        onClick={() => handleApprove(referral.id)}
                        disabled={actionLoading !== null}
                        style={{
                          padding: "6px 12px",
                          background: "var(--color-success)",
                          color: "#fff",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontWeight: 600,
                          fontSize: "0.85rem",
                        }}
                      >
                        {actionLoading === referral.id ? "..." : "Approve"}
                      </button>
                      <button
                        onClick={() => handleReject(referral.id)}
                        disabled={actionLoading !== null}
                        style={{
                          padding: "6px 12px",
                          background: "var(--color-error)",
                          color: "#fff",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontWeight: 600,
                          fontSize: "0.85rem",
                        }}
                      >
                        {actionLoading === referral.id ? "..." : "Reject"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

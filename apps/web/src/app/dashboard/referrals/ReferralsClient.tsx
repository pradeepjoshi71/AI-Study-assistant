"use client";

import { useState } from "react";

interface ReferralsClientProps {
  token: string;
  initialCode: string;
  initialStats: {
    clicks: number;
    signups: number;
    conversions: number;
  };
  initialPayouts: {
    affiliate: {
      balance: number;
      totalEarned: number;
      stripeConnectId: string | null;
    };
    rewards: any[];
  };
}

export default function ReferralsClient({
  token,
  initialCode,
  initialStats,
  initialPayouts,
}: ReferralsClientProps) {
  const [code, setCode] = useState(initialCode);
  const [stats, setStats] = useState(initialStats);
  const [payouts, setPayouts] = useState(initialPayouts);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getShareLink = () => {
    if (typeof window !== "undefined") {
      return `${window.location.origin}/r/${code}`;
    }
    return `http://localhost:3000/r/${code}`;
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(getShareLink());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const regenerateCode = async () => {
    if (!confirm("Are you sure you want to generate a new referral code? Your old code will no longer work.")) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
      const res = await fetch(`${apiUrl}/referrals/code`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error("Failed to regenerate referral code");
      const data = await res.json();
      setCode(data.code);
    } catch (err: any) {
      setError(err.message || "Failed to regenerate code");
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "PAID":
        return "var(--color-success)";
      case "HELD":
        return "#f59e0b"; // Amber/Orange
      case "PENDING":
        return "var(--color-primary)";
      case "REJECTED":
        return "var(--color-error)";
      default:
        return "var(--color-text-secondary)";
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "30px", marginTop: "24px" }}>
      {error && (
        <div className="glass-panel" style={{
          backgroundColor: "var(--color-error-glow)",
          border: "1px solid var(--color-error)",
          color: "var(--color-text-primary)",
          padding: "16px",
          borderRadius: "12px",
        }}>
          {error}
        </div>
      )}

      {/* Share Link Generation Card */}
      <section className="glass-panel" style={{ padding: "30px" }}>
        <h2 style={{ fontSize: "1.4rem", color: "#fff", marginBottom: "16px" }}>Your Referral Link</h2>
        <p style={{ color: "var(--color-text-secondary)", fontSize: "0.95rem", marginBottom: "20px" }}>
          Share this link with friends. When they sign up and make their first subscription purchase, you get $10.00 cash/credit, and they get 20% off their next invoice!
        </p>

        <div style={{
          display: "flex",
          gap: "12px",
          alignItems: "center",
          flexWrap: "wrap",
          background: "rgba(255,255,255,0.05)",
          padding: "12px 16px",
          borderRadius: "8px",
          border: "1px solid rgba(255,255,255,0.1)",
        }}>
          <span style={{
            fontFamily: "monospace",
            color: "var(--color-primary)",
            fontWeight: 600,
            fontSize: "1.1rem",
            flexGrow: 1,
            wordBreak: "break-all",
          }}>
            {getShareLink()}
          </span>
          <button
            onClick={copyLink}
            style={{
              padding: "10px 20px",
              background: copied ? "var(--color-success)" : "var(--color-primary)",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 600,
              minWidth: "120px",
              transition: "background 0.2s",
            }}
          >
            {copied ? "Copied! ✓" : "Copy Link"}
          </button>
        </div>

        <div style={{ marginTop: "16px", display: "flex", gap: "10px", alignItems: "center" }}>
          <span style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem" }}>
            Referral Code: <strong style={{ color: "#fff", fontSize: "0.95rem" }}>{code}</strong>
          </span>
          <button
            onClick={regenerateCode}
            disabled={loading}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-text-muted)",
              cursor: "pointer",
              fontSize: "0.85rem",
              textDecoration: "underline",
              padding: 0,
            }}
          >
            {loading ? "Generating..." : "Regenerate code"}
          </button>
        </div>
      </section>

      {/* Stats Cards Grid */}
      <section style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "20px",
      }}>
        <div className="glass-panel" style={{ textAlign: "center", padding: "20px" }}>
          <h3 style={{ fontSize: "1rem", color: "var(--color-text-secondary)", marginBottom: "8px" }}>Clicks</h3>
          <div style={{ fontSize: "2.5rem", fontWeight: 700, color: "#fff" }}>{stats.clicks}</div>
        </div>
        <div className="glass-panel" style={{ textAlign: "center", padding: "20px" }}>
          <h3 style={{ fontSize: "1rem", color: "var(--color-text-secondary)", marginBottom: "8px" }}>Signups</h3>
          <div style={{ fontSize: "2.5rem", fontWeight: 700, color: "var(--color-primary)" }}>{stats.signups}</div>
        </div>
        <div className="glass-panel" style={{ textAlign: "center", padding: "20px" }}>
          <h3 style={{ fontSize: "1rem", color: "var(--color-text-secondary)", marginBottom: "8px" }}>Conversions</h3>
          <div style={{ fontSize: "2.5rem", fontWeight: 700, color: "var(--color-success)" }}>{stats.conversions}</div>
        </div>
      </section>

      {/* Earnings Summary & Payout Table */}
      <section className="glass-panel" style={{ padding: "30px" }}>
        <h2 style={{ fontSize: "1.4rem", color: "#fff", marginBottom: "20px" }}>Affiliate Earnings</h2>

        <div style={{
          display: "flex",
          gap: "40px",
          marginBottom: "30px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          paddingBottom: "20px",
          flexWrap: "wrap",
        }}>
          <div>
            <div style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", marginBottom: "4px" }}>Available Balance</div>
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--color-success)" }}>
              {formatCurrency(payouts.affiliate.balance)}
            </div>
          </div>
          <div>
            <div style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", marginBottom: "4px" }}>Total Earned</div>
            <div style={{ fontSize: "2rem", fontWeight: 700, color: "#fff" }}>
              {formatCurrency(payouts.affiliate.totalEarned)}
            </div>
          </div>
          <div>
            <div style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", marginBottom: "4px" }}>Payout Account</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "#fff", marginTop: "8px" }}>
              {payouts.affiliate.stripeConnectId ? (
                <span className="status-badge online" style={{ background: "rgba(16, 185, 129, 0.1)", color: "var(--color-success)" }}>
                  Linked: {payouts.affiliate.stripeConnectId}
                </span>
              ) : (
                <span className="status-badge offline" style={{ background: "rgba(239, 68, 68, 0.1)", color: "var(--color-error)" }}>
                  No Stripe Connect Linked
                </span>
              )}
            </div>
          </div>
        </div>

        <h3 style={{ fontSize: "1.2rem", color: "#fff", marginBottom: "16px" }}>Payout History</h3>
        {payouts.rewards.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)", fontSize: "0.95rem" }}>
            No reward history recorded yet. Share your link to start earning!
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.95rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", color: "var(--color-text-muted)" }}>
                  <th style={{ padding: "12px 8px" }}>Date</th>
                  <th style={{ padding: "12px 8px" }}>Referee</th>
                  <th style={{ padding: "12px 8px" }}>Type</th>
                  <th style={{ padding: "12px 8px" }}>Amount</th>
                  <th style={{ padding: "12px 8px" }}>Status</th>
                  <th style={{ padding: "12px 8px" }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {payouts.rewards.map((reward) => (
                  <tr key={reward.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <td style={{ padding: "12px 8px", color: "var(--color-text-secondary)" }}>
                      {new Date(reward.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      {reward.referral.referee?.name || reward.referral.referee?.email || "N/A"}
                    </td>
                    <td style={{ padding: "12px 8px", color: "var(--color-text-secondary)" }}>{reward.type}</td>
                    <td style={{ padding: "12px 8px", fontWeight: 600, color: "#fff" }}>
                      {formatCurrency(reward.amount)}
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <span style={{
                        color: getStatusColor(reward.status),
                        fontWeight: 600,
                        fontSize: "0.85rem",
                      }}>
                        {reward.status}
                      </span>
                    </td>
                    <td style={{ padding: "12px 8px", color: "var(--color-text-muted)", fontSize: "0.85rem" }}>
                      {reward.status === "HELD" && `Hold until ${new Date(reward.holdUntil).toLocaleDateString()}`}
                      {reward.status === "PAID" && `Paid on ${reward.paidAt ? new Date(reward.paidAt).toLocaleDateString() : "N/A"}`}
                      {reward.status === "PENDING" && "Awaiting payout threshold ($50.00)"}
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

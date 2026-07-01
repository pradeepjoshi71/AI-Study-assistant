"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Reseller {
  userId: string;
  name: string;
  email: string;
  stripeConnectId: string | null;
  commissionRate: number;
  isActive: boolean;
  tenantCount: number;
  mrr: number;
  createdAt: string;
}

export default function ResellerAdministration() {
  const [token, setToken] = useState<string | null>(null);
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Inline edit state
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editCommission, setEditCommission] = useState<number>(0.7);
  const [savingCommission, setSavingCommission] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (savedToken) {
      setToken(savedToken);
      loadResellers(savedToken);
    } else {
      setLoading(false);
    }
  }, []);

  const loadResellers = async (activeToken: string) => {
    setLoading(true);
    setError("");
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

    try {
      const res = await fetch(`${apiUrl}/admin/resellers`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      if (!res.ok) throw new Error("Failed to retrieve reseller directory");

      const data = await res.json();
      setResellers(data);
    } catch (err: any) {
      setError(err.message || "Unauthorized: Platform Super Admin permission required.");
    } finally {
      setLoading(false);
    }
  };

  const handleEditCommission = (reseller: Reseller) => {
    setEditingUserId(reseller.userId);
    setEditCommission(reseller.commissionRate);
  };

  const handleSaveCommission = async (userId: string) => {
    setSavingCommission(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

    try {
      const res = await fetch(`${apiUrl}/admin/resellers/${userId}/commission`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ commissionRate: editCommission }),
      });

      if (!res.ok) throw new Error("Update failed");

      setEditingUserId(null);
      if (token) loadResellers(token);
    } catch (err: any) {
      alert(`Save Failed: ${err.message}`);
    } finally {
      setSavingCommission(false);
    }
  };

  const handleToggleSuspension = async (userId: string) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    try {
      const res = await fetch(`${apiUrl}/admin/resellers/${userId}/suspend`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok && token) loadResellers(token);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "40px 20px" }}>
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "40px" }}>
        <div>
          <Link href="/admin/orgs" style={{ color: "var(--color-text-secondary)", textDecoration: "none", fontSize: "0.9rem" }}>
            ← Back to System Control
          </Link>
          <h1 style={{ fontSize: "2.2rem", color: "#fff", fontFamily: "var(--font-display)", fontWeight: 700, marginTop: "10px" }}>
            Reseller Administration
          </h1>
          <p style={{ color: "var(--color-text-secondary)", marginTop: "4px" }}>
            Oversee active reseller account commissions, referred portfolio counts, and platform distributions.
          </p>
        </div>
      </div>

      {error && (
        <div className="glass-panel" style={{ borderColor: "var(--color-error)", color: "var(--color-error)", padding: "20px" }}>
          ⚠️ {error}
        </div>
      )}

      {!error && (
        <div className="glass-panel" style={{ padding: "30px" }}>
          <h3 style={{ color: "#fff", fontSize: "1.2rem", marginBottom: "20px" }}>Platform Resellers Directory</h3>

          {loading ? (
            <p style={{ color: "var(--color-text-secondary)" }}>Loading reseller list...</p>
          ) : resellers.length === 0 ? (
            <p style={{ color: "var(--color-text-muted)" }}>No registered resellers exist on this platform.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.9rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--glass-border)", color: "var(--color-text-secondary)" }}>
                    <th style={{ padding: "12px 8px" }}>Name / Email</th>
                    <th style={{ padding: "12px 8px" }}>Commission Rate</th>
                    <th style={{ padding: "12px 8px" }}>Referred Tenants</th>
                    <th style={{ padding: "12px 8px" }}>Total Portfolio MRR</th>
                    <th style={{ padding: "12px 8px" }}>Stripe Connect</th>
                    <th style={{ padding: "12px 8px" }}>Status</th>
                    <th style={{ padding: "12px 8px", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {resellers.map((r) => (
                    <tr key={r.userId} style={{ borderBottom: "1px solid var(--glass-border)", color: "var(--color-text-primary)" }}>
                      <td style={{ padding: "16px 8px" }}>
                        <strong style={{ color: "#fff", display: "block" }}>{r.name}</strong>
                        <span style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)" }}>{r.email}</span>
                      </td>
                      <td style={{ padding: "16px 8px" }}>
                        {editingUserId === r.userId ? (
                          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <input
                              type="number"
                              step="0.05"
                              min="0"
                              max="1"
                              value={editCommission}
                              onChange={(e) => setEditCommission(parseFloat(e.target.value))}
                              style={{
                                width: "65px",
                                padding: "6px",
                                background: "var(--bg-primary)",
                                border: "1px solid var(--glass-border)",
                                borderRadius: "4px",
                                color: "#fff"
                              }}
                            />
                            <button onClick={() => handleSaveCommission(r.userId)} disabled={savingCommission} style={{ padding: "6px 10px", borderRadius: "4px", background: "var(--color-success)", color: "#fff", border: "none", cursor: "pointer", fontSize: "0.85rem" }}>
                              {savingCommission ? "..." : "Save"}
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <span>{(r.commissionRate * 100).toFixed(0)}%</span>
                            <button onClick={() => handleEditCommission(r)} style={{ background: "none", border: "none", color: "var(--color-secondary)", cursor: "pointer", fontSize: "0.8rem" }}>
                              ✎
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "16px 8px" }}>{r.tenantCount} tenants</td>
                      <td style={{ padding: "16px 8px" }}>${(r.mrr / 100).toFixed(2)}</td>
                      <td style={{ padding: "16px 8px" }}>
                        {r.stripeConnectId ? (
                          <span style={{ color: "var(--color-success)" }}>✓ Connected ({r.stripeConnectId.substring(0, 10)}...)</span>
                        ) : (
                          <span style={{ color: "var(--color-error)" }}>⚠️ Missing Stripe Connect</span>
                        )}
                      </td>
                      <td style={{ padding: "16px 8px" }}>
                        <span style={{
                          padding: "4px 8px",
                          borderRadius: "6px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          background: r.isActive ? "var(--color-success-glow)" : "var(--color-error-glow)",
                          color: r.isActive ? "var(--color-success)" : "var(--color-error)"
                        }}>
                          {r.isActive ? "ACTIVE" : "SUSPENDED"}
                        </span>
                      </td>
                      <td style={{ padding: "16px 8px", textAlign: "right" }}>
                        <button
                          onClick={() => handleToggleSuspension(r.userId)}
                          style={{
                            padding: "6px 14px",
                            borderRadius: "6px",
                            background: r.isActive ? "var(--color-error-glow)" : "var(--color-success-glow)",
                            color: r.isActive ? "var(--color-error)" : "var(--color-success)",
                            border: "none",
                            cursor: "pointer",
                            fontWeight: 600
                          }}
                        >
                          {r.isActive ? "Suspend" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

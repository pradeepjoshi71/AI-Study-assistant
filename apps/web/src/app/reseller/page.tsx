"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Plan {
  id: string;
  name: string;
  maxOrgs: number;
  maxUsersPerOrg: number;
  maxDocsPerOrg: number;
  aiTokensPerMonth: number;
  price: number;
}

interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  customDomain: string | null;
  status: "ACTIVE" | "SUSPENDED" | "TRIAL";
  billingStatus: string;
  userCount: number;
  aiTokensUsed: number;
  plan: Plan;
}

export default function ResellerDashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ activeTenants: 0, trialCount: 0, totalMRR: 0 });
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState("");

  // Wizard States
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wName, setWName] = useState("");
  const [wSubdomain, setWSubdomain] = useState("");
  const [subAvailable, setSubAvailable] = useState<boolean | null>(null);
  const [checkingSub, setCheckingSub] = useState(false);
  const [wPlanId, setWPlanId] = useState("");
  const [wAppName, setWAppName] = useState("");
  const [wSupportEmail, setWSupportEmail] = useState("");
  const [wPrimaryColor, setWPrimaryColor] = useState("#6366f1");
  const [wSecondaryColor, setWSecondaryColor] = useState("#8b5cf6");
  const [submittingTenant, setSubmittingTenant] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (savedToken) {
      setToken(savedToken);
      loadDashboard(savedToken);
    } else {
      setLoading(false);
    }
  }, []);

  const loadDashboard = async (activeToken: string) => {
    setLoading(true);
    setError("");
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

    try {
      const res = await fetch(`${apiUrl}/reseller/dashboard`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      if (!res.ok) throw new Error("Failed to load reseller dashboard");

      const data = await res.json();
      setStats(data.stats);
      setTenants(data.tenants);
      setPlans(data.plans || []);
      if (data.plans?.length > 0 && !wPlanId) {
        setWPlanId(data.plans[0].id);
      }
    } catch (err: any) {
      setError(err.message || "Error fetching dashboard metrics");
    } finally {
      setLoading(false);
    }
  };

  // Availability check
  const checkSubdomainAvailability = async (sub: string) => {
    if (!sub || sub.length < 3) return;
    setCheckingSub(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    try {
      const res = await fetch(`${apiUrl}/reseller/tenants/check-subdomain?subdomain=${sub}`);
      const data = await res.json();
      setSubAvailable(data.available);
    } catch (err) {
      console.error(err);
    } finally {
      setCheckingSub(false);
    }
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingTenant(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

    try {
      const res = await fetch(`${apiUrl}/reseller/tenants`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: wName,
          subdomain: wSubdomain,
          planId: wPlanId,
          appName: wAppName || wName,
          supportEmail: wSupportEmail,
          primaryColor: wPrimaryColor,
          secondaryColor: wSecondaryColor,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Failed to create tenant");
      }

      // Reset wizard
      setShowWizard(false);
      setWizardStep(1);
      setWName("");
      setWSubdomain("");
      setWAppName("");
      setWSupportEmail("");
      setSubAvailable(null);

      if (token) loadDashboard(token);
    } catch (err: any) {
      alert(`Tenant Onboarding Failed: ${err.message}`);
    } finally {
      setSubmittingTenant(false);
    }
  };

  const handleToggleSuspend = async (tenantId: string) => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    try {
      const res = await fetch(`${apiUrl}/reseller/tenants/${tenantId}/suspend`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok && token) loadDashboard(token);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTenant = async (tenantId: string) => {
    if (!confirm("Are you absolutely sure you want to delete this tenant and all related workspaces? This action is irreversible.")) {
      return;
    }
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    try {
      const res = await fetch(`${apiUrl}/reseller/tenants/${tenantId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok && token) loadDashboard(token);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "40px 20px" }}>
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "40px" }}>
        <div>
          <h1 style={{ fontSize: "2.2rem", color: "#fff", fontFamily: "var(--font-display)", fontWeight: 700 }}>
            Reseller Center
          </h1>
          <p style={{ color: "var(--color-text-secondary)", marginTop: "4px" }}>
            Provision standalone client workspaces, customize branding suites, and track MRR performance.
          </p>
        </div>
        <button onClick={() => setShowWizard(true)} className="glass-panel" style={{ padding: "10px 20px", color: "var(--color-primary)", borderColor: "rgba(99, 102, 241, 0.4)", fontWeight: 600, cursor: "pointer" }}>
          🚀 New Tenant Setup
        </button>
      </div>

      {error && <div className="glass-panel" style={{ borderColor: "var(--color-error)", color: "var(--color-error)", padding: "16px", marginBottom: "20px" }}>⚠️ {error}</div>}

      {/* Stats Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "24px", marginBottom: "40px" }}>
        <div className="glass-panel" style={{ padding: "20px" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Active Subscriptions</span>
          <h2 style={{ fontSize: "2rem", color: "#fff", fontWeight: 700, marginTop: "8px" }}>{stats.activeTenants}</h2>
        </div>
        <div className="glass-panel" style={{ padding: "20px" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Total Monthly Revenue</span>
          <h2 style={{ fontSize: "2rem", color: "#fff", fontWeight: 700, marginTop: "8px" }}>${(stats.totalMRR / 100).toFixed(2)}</h2>
        </div>
        <div className="glass-panel" style={{ padding: "20px" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Active Trial Period Accounts</span>
          <h2 style={{ fontSize: "2rem", color: "#fff", fontWeight: 700, marginTop: "8px" }}>{stats.trialCount}</h2>
        </div>
      </div>

      {/* Tenants Table */}
      <div className="glass-panel" style={{ padding: "30px" }}>
        <h3 style={{ color: "#fff", fontSize: "1.2rem", marginBottom: "20px" }}>My Provisioned Tenants</h3>

        {loading ? (
          <p style={{ color: "var(--color-text-secondary)" }}>Loading tenant directory...</p>
        ) : tenants.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)" }}>No clients mapped yet. Launch the wizard above to get started.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--glass-border)", color: "var(--color-text-secondary)" }}>
                  <th style={{ padding: "12px 8px" }}>Tenant Name</th>
                  <th style={{ padding: "12px 8px" }}>Subdomain</th>
                  <th style={{ padding: "12px 8px" }}>Billing</th>
                  <th style={{ padding: "12px 8px" }}>Users</th>
                  <th style={{ padding: "12px 8px" }}>AI Tokens</th>
                  <th style={{ padding: "12px 8px" }}>Status</th>
                  <th style={{ padding: "12px 8px", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid var(--glass-border)", color: "var(--color-text-primary)" }}>
                    <td style={{ padding: "16px 8px", fontWeight: 600 }}>{t.name}</td>
                    <td style={{ padding: "16px 8px", color: "var(--color-secondary)" }}>{t.subdomain}.studyapp.com</td>
                    <td style={{ padding: "16px 8px" }}>{t.billingStatus}</td>
                    <td style={{ padding: "16px 8px" }}>{t.userCount} / {t.plan.maxUsersPerOrg}</td>
                    <td style={{ padding: "16px 8px" }}>{t.aiTokensUsed} / {t.plan.aiTokensPerMonth}</td>
                    <td style={{ padding: "16px 8px" }}>
                      <span style={{
                        padding: "4px 8px",
                        borderRadius: "6px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background: t.status === "ACTIVE" ? "var(--color-success-glow)" : t.status === "TRIAL" ? "var(--color-primary-glow)" : "var(--color-error-glow)",
                        color: t.status === "ACTIVE" ? "var(--color-success)" : t.status === "TRIAL" ? "var(--color-primary)" : "var(--color-error)"
                      }}>
                        {t.status}
                      </span>
                    </td>
                    <td style={{ padding: "16px 8px", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                        <Link href={`/reseller/${t.id}`} style={{ color: "var(--color-primary)", textDecoration: "none", fontWeight: 600 }}>
                          Branding Setup
                        </Link>
                        <button onClick={() => handleToggleSuspend(t.id)} style={{ background: "none", border: "none", color: "var(--color-secondary)", cursor: "pointer" }}>
                          {t.status === "SUSPENDED" ? "Reactivate" : "Suspend"}
                        </button>
                        <button onClick={() => handleDeleteTenant(t.id)} style={{ background: "none", border: "none", color: "var(--color-error)", cursor: "pointer" }}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MULTI-STEP WIZARD MODAL */}
      {showWizard && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999
        }}>
          <div className="glass-panel" style={{ width: "550px", padding: "40px", position: "relative" }}>
            <button onClick={() => setShowWizard(false)} style={{ position: "absolute", top: "20px", right: "20px", background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: "1.2rem" }}>
              ✕
            </button>

            <h3 style={{ color: "#fff", fontSize: "1.35rem", marginBottom: "6px" }}>New Tenant Wizard</h3>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem", marginBottom: "24px" }}>
              Step {wizardStep} of 3
            </p>

            <form onSubmit={handleCreateTenant} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              
              {/* STEP 1: Name and Subdomain */}
              {wizardStep === 1 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Tenant Workspace Name</label>
                    <input
                      type="text"
                      value={wName}
                      onChange={(e) => setWName(e.target.value)}
                      placeholder="e.g. Acme Medical University"
                      required
                      style={{ padding: "10px", background: "var(--bg-primary)", border: "1px solid var(--glass-border)", borderRadius: "6px", color: "#fff", outline: "none" }}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Subdomain Prefix</label>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <input
                        type="text"
                        value={wSubdomain}
                        onChange={(e) => {
                          setWSubdomain(e.target.value);
                          setSubAvailable(null);
                        }}
                        onBlur={() => checkSubdomainAvailability(wSubdomain)}
                        placeholder="acme"
                        required
                        style={{ padding: "10px", background: "var(--bg-primary)", border: "1px solid var(--glass-border)", borderRadius: "6px 0 0 6px", color: "#fff", outline: "none", width: "100%" }}
                      />
                      <span style={{ padding: "10px", background: "var(--bg-secondary)", border: "1px solid var(--glass-border)", borderLeft: "none", borderRadius: "0 6px 6px 0", fontSize: "0.9rem", color: "var(--color-text-muted)" }}>
                        .studyapp.com
                      </span>
                    </div>
                    {checkingSub && <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>Verifying uniqueness...</span>}
                    {subAvailable === true && <span style={{ fontSize: "0.8rem", color: "var(--color-success)" }}>✓ Subdomain available</span>}
                    {subAvailable === false && <span style={{ fontSize: "0.8rem", color: "var(--color-error)" }}>✗ Subdomain already taken</span>}
                  </div>

                  <button
                    type="button"
                    disabled={!wName || !wSubdomain || subAvailable !== true}
                    onClick={() => setWizardStep(2)}
                    style={{ padding: "12px", borderRadius: "8px", background: "var(--color-primary)", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer", marginTop: "12px" }}
                  >
                    Next Step
                  </button>
                </div>
              )}

              {/* STEP 2: Plan Selector */}
              {wizardStep === 2 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Select a Billing Profile</label>
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {plans.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => setWPlanId(p.id)}
                        style={{
                          padding: "16px",
                          borderRadius: "8px",
                          border: "1px solid",
                          borderColor: wPlanId === p.id ? "var(--color-primary)" : "var(--glass-border)",
                          background: wPlanId === p.id ? "var(--color-primary-glow)" : "var(--bg-primary)",
                          cursor: "pointer",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center"
                        }}
                      >
                        <div>
                          <strong style={{ color: "#fff", display: "block" }}>{p.name}</strong>
                          <span style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)" }}>
                            Up to {p.maxOrgs} clients | {p.aiTokensPerMonth} AI tokens/mo
                          </span>
                        </div>
                        <span style={{ fontWeight: 700, color: "#fff" }}>${(p.price / 100).toFixed(0)}/mo</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
                    <button type="button" onClick={() => setWizardStep(1)} style={{ width: "50%", padding: "12px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "none", color: "#fff", cursor: "pointer" }}>
                      Back
                    </button>
                    <button type="button" onClick={() => setWizardStep(3)} style={{ width: "50%", padding: "12px", borderRadius: "8px", background: "var(--color-primary)", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer" }}>
                      Next Step
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: Config & Colors */}
              {wizardStep === 3 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>App Custom Title</label>
                    <input
                      type="text"
                      value={wAppName}
                      onChange={(e) => setWAppName(e.target.value)}
                      placeholder="e.g. Acme Study Dashboard"
                      style={{ padding: "10px", background: "var(--bg-primary)", border: "1px solid var(--glass-border)", borderRadius: "6px", color: "#fff", outline: "none" }}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Support Email</label>
                    <input
                      type="email"
                      value={wSupportEmail}
                      onChange={(e) => setWSupportEmail(e.target.value)}
                      placeholder="support@acme.edu"
                      required
                      style={{ padding: "10px", background: "var(--bg-primary)", border: "1px solid var(--glass-border)", borderRadius: "6px", color: "#fff", outline: "none" }}
                    />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Primary Color</label>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <input
                          type="color"
                          value={wPrimaryColor}
                          onChange={(e) => setWPrimaryColor(e.target.value)}
                          style={{ border: "none", background: "none", width: "40px", height: "40px", cursor: "pointer" }}
                        />
                        <span style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>{wPrimaryColor}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>Secondary Color</label>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <input
                          type="color"
                          value={wSecondaryColor}
                          onChange={(e) => setWSecondaryColor(e.target.value)}
                          style={{ border: "none", background: "none", width: "40px", height: "40px", cursor: "pointer" }}
                        />
                        <span style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>{wSecondaryColor}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
                    <button type="button" onClick={() => setWizardStep(2)} style={{ width: "50%", padding: "12px", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "none", color: "#fff", cursor: "pointer" }}>
                      Back
                    </button>
                    <button type="submit" disabled={submittingTenant} style={{ width: "50%", padding: "12px", borderRadius: "8px", background: "var(--color-success)", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer" }}>
                      {submittingTenant ? "Deploying..." : "Onboard Client"}
                    </button>
                  </div>
                </div>
              )}

            </form>
          </div>
        </div>
      )}

    </div>
  );
}

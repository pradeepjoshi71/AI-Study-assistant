import { cookies } from "next/headers";
import Link from "next/link";
import { TokenSyncClient, TokenClearClient } from "./TokenComponents";
import BillingClientActions from "./BillingClientActions";

// Fetchers
async function fetchBillingSummary(token: string) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
  try {
    const res = await fetch(`${apiUrl}/billing/summary`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Error fetching billing summary:", err);
    return null;
  }
}

async function fetchPlans() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
  try {
    const res = await fetch(`${apiUrl}/billing/plans`, {
      cache: "force-cache",
    });
    if (!res.ok) throw new Error("Failed to fetch plans");
    return await res.json();
  } catch (err) {
    console.error("Error fetching plans:", err);
    return [];
  }
}

export default async function BillingDashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  if (!token) {
    return <TokenSyncClient />;
  }

  const summary = await fetchBillingSummary(token);
  if (!summary) {
    return <TokenClearClient />;
  }

  const plans = await fetchPlans();

  const { plan, subscription, usage, invoices, orgId } = summary;

  // Formatting helpers
  const tokenPercent = Math.min(100, Math.round((usage.tokensUsed / usage.tokensLimit) * 100));
  const uploadPercent = Math.min(100, Math.round((usage.uploadsUsed / usage.uploadsLimit) * 100));
  const seatPercent = usage.seatLimit
    ? Math.min(100, Math.round((usage.seatCount / usage.seatLimit) * 100))
    : null;

  const formatPeriodEnd = (dateStr: string) => {
    if (!dateStr) return "N/A";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  };

  return (
    <main style={{
      padding: "40px 20px",
      maxWidth: "1200px",
      margin: "0 auto",
      position: "relative",
      zIndex: 10,
    }}>
      {/* Header */}
      <header style={{ marginBottom: "40px" }}>
        <Link href="/" style={{
          color: "var(--color-primary)",
          textDecoration: "none",
          fontWeight: 600,
          fontSize: "0.9rem",
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "16px"
        }}>
          ← Back to Dashboard
        </Link>
        <h1 style={{
          fontSize: "2.5rem",
          fontWeight: 700,
          background: "linear-gradient(135deg, #ffffff 30%, #a5a6c2 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}>
          Billing & Subscriptions
        </h1>
        <p style={{ color: "var(--color-text-secondary)", fontSize: "1rem", marginTop: "4px" }}>
          Manage your plan, check usage quotas, and download past invoices.
        </p>
      </header>

      {/* Main Grid: Plan Summary & Quotas */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
        gap: "30px",
        marginBottom: "40px"
      }}>
        {/* Current Plan Card */}
        <section className="glass-panel" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontSize: "1.4rem", color: "#fff", marginBottom: "16px" }}>Subscription Details</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
              <span style={{ color: "var(--color-text-secondary)", fontSize: "0.95rem" }}>Active Plan:</span>
              <span className="status-badge online" style={{
                background: plan.type !== "FREE" ? "var(--color-primary-glow)" : undefined,
                color: plan.type !== "FREE" ? "var(--color-primary)" : undefined,
                border: plan.type !== "FREE" ? "1px solid rgba(99, 102, 241, 0.2)" : undefined
              }}>
                {plan.name}
              </span>
            </div>
            {subscription && (
              <div style={{ color: "var(--color-text-secondary)", fontSize: "0.95rem", lineHeight: 1.6 }}>
                <div>Status: <span style={{ color: "var(--color-success)", fontWeight: 600 }}>{subscription.status}</span></div>
                <div>Renewal Date: <span style={{ color: "#fff" }}>{formatPeriodEnd(subscription.currentPeriodEnd)}</span></div>
                {subscription.cancelAtPeriodEnd && (
                  <div style={{ color: "var(--color-error)", fontWeight: 500, marginTop: "8px" }}>
                    ⚠️ Cancels at end of current period
                  </div>
                )}
              </div>
            )}
            {!subscription && (
              <p style={{ color: "var(--color-text-muted)", fontSize: "0.95rem" }}>
                You are on the default lifetime free plan. Upgrade below to unlock premium limits.
              </p>
            )}
          </div>
          {/* Team link */}
          {orgId && (
            <Link href="/dashboard/team" style={{
              display: "inline-flex", alignItems: "center", gap: "6px", marginTop: "16px",
              padding: "8px 14px", borderRadius: "8px",
              background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)",
              color: "var(--color-primary)", textDecoration: "none", fontSize: "0.875rem", fontWeight: 600,
            }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.4"/>
                <circle cx="9" cy="4" r="2" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M1 11c0-2.21 1.79-4 4-4M9 7c2.21 0 4 1.79 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              Manage Team
            </Link>
          )}
        </section>

        {/* Quotas & Progress Bars */}
        <section className="glass-panel">
          <h2 style={{ fontSize: "1.4rem", color: "#fff", marginBottom: "20px" }}>Monthly Quota Usage</h2>
          
          {/* Progress: Tokens */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem", marginBottom: "8px" }}>
              <span style={{ color: "var(--color-text-secondary)" }}>AI Tokens Used</span>
              <span style={{ color: "#fff", fontWeight: 600 }}>
                {usage.tokensUsed.toLocaleString()} / {usage.tokensLimit.toLocaleString()}
              </span>
            </div>
            <div style={{
              height: "8px",
              width: "100%",
              backgroundColor: "rgba(255,255,255,0.05)",
              borderRadius: "4px",
              overflow: "hidden"
            }}>
              <div style={{
                height: "100%",
                width: `${tokenPercent}%`,
                background: "linear-gradient(90deg, var(--color-primary) 0%, #818cf8 100%)",
                borderRadius: "4px",
                transition: "width 0.5s ease-out"
              }} />
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginTop: "6px", textAlign: "right" }}>
              {tokenPercent}% utilized
            </div>
          </div>

          {/* Progress: Uploads */}
          <div style={{ marginBottom: seatPercent !== null ? "24px" : "0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem", marginBottom: "8px" }}>
              <span style={{ color: "var(--color-text-secondary)" }}>Daily Document Uploads</span>
              <span style={{ color: "#fff", fontWeight: 600 }}>
                {usage.uploadsUsed} / {usage.uploadsLimit}
              </span>
            </div>
            <div style={{
              height: "8px", width: "100%",
              backgroundColor: "rgba(255,255,255,0.05)",
              borderRadius: "4px", overflow: "hidden",
            }}>
              <div style={{
                height: "100%", width: `${uploadPercent}%`,
                background: "linear-gradient(90deg, var(--color-secondary) 0%, #22d3ee 100%)",
                borderRadius: "4px", transition: "width 0.5s ease-out",
              }} />
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginTop: "6px", textAlign: "right" }}>
              {uploadPercent}% utilized
            </div>
          </div>

          {/* Progress: Seats */}
          {seatPercent !== null && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem", marginBottom: "8px" }}>
                <span style={{ color: "var(--color-text-secondary)" }}>Team Seats</span>
                <span style={{ color: "#fff", fontWeight: 600 }}>
                  {usage.seatCount} / {usage.seatLimit}
                </span>
              </div>
              <div style={{
                height: "8px", width: "100%",
                backgroundColor: "rgba(255,255,255,0.05)",
                borderRadius: "4px", overflow: "hidden",
              }}>
                <div style={{
                  height: "100%", width: `${seatPercent}%`,
                  background: seatPercent >= 90
                    ? "linear-gradient(90deg, #f43f5e, #fb7185)"
                    : "linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)",
                  borderRadius: "4px", transition: "width 0.5s ease-out",
                }} />
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginTop: "6px", textAlign: "right" }}>
                {seatPercent}% of seats used
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Plan Selections (Interactive CTAs) */}
      <section style={{ marginBottom: "40px" }}>
        <h2 style={{ fontSize: "1.8rem", color: "#fff", marginBottom: "20px" }}>Available Subscriptions</h2>
        <BillingClientActions token={token} currentPlanType={plan.type} plans={plans} />
      </section>

      {/* Invoice History Table */}
      <section className="glass-panel" style={{ padding: "30px 24px" }}>
        <h2 style={{ fontSize: "1.5rem", color: "#fff", marginBottom: "20px" }}>Invoice History</h2>
        {invoices.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)", textAlign: "center", padding: "20px" }}>
            No past invoices found.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "600px", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", color: "var(--color-text-muted)", fontSize: "0.85rem" }}>
                  <th style={{ padding: "12px 16px" }}>Date</th>
                  <th style={{ padding: "12px 16px" }}>Invoice ID</th>
                  <th style={{ padding: "12px 16px" }}>Amount</th>
                  <th style={{ padding: "12px 16px" }}>Status</th>
                  <th style={{ padding: "12px 16px" }}>Action</th>
                </tr>
              </thead>
              <tbody style={{ fontSize: "0.95rem" }}>
                {invoices.map((inv: any) => (
                  <tr key={inv.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", color: "var(--color-text-primary)" }}>
                    <td style={{ padding: "16px" }}>{new Date(inv.createdAt).toLocaleDateString()}</td>
                    <td style={{ padding: "16px", fontFamily: "monospace", color: "var(--color-text-secondary)" }}>
                      {inv.stripeInvoiceId || inv.id.slice(0, 12)}
                    </td>
                    <td style={{ padding: "16px", fontWeight: 600 }}>
                      ${(inv.amountPaidUsdCents / 100).toFixed(2)}
                    </td>
                    <td style={{ padding: "16px" }}>
                      <span className="status-badge online" style={{
                        background: inv.status !== "PAID" ? "var(--color-error-glow)" : undefined,
                        color: inv.status !== "PAID" ? "var(--color-error)" : undefined,
                        border: inv.status !== "PAID" ? "1px solid rgba(244, 63, 94, 0.2)" : undefined,
                        fontSize: "0.75rem",
                        padding: "2px 8px"
                      }}>
                        {inv.status}
                      </span>
                    </td>
                    <td style={{ padding: "16px" }}>
                      {inv.invoicePdfUrl ? (
                        <a
                          href={inv.invoicePdfUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            color: "var(--color-primary)",
                            textDecoration: "none",
                            fontWeight: 600
                          }}
                        >
                          Download PDF
                        </a>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>N/A</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

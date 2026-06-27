"use client";

import { useState } from "react";

interface BillingClientActionsProps {
  token: string;
  currentPlanType: string;
  plans: any[];
}

export default function BillingClientActions({ token, currentPlanType, plans }: BillingClientActionsProps) {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = async (planType: string) => {
    setLoadingPlan(planType);
    setError(null);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
      const res = await fetch(`${apiUrl}/billing/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          planType,
          cycle: "MONTHLY",
          successUrl: window.location.origin + "/dashboard/billing?status=success",
          cancelUrl: window.location.origin + "/dashboard/billing?status=cancel",
        }),
      });

      if (!res.ok) throw new Error("Failed to initiate checkout");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err: any) {
      setError(err.message || "An error occurred");
      setLoadingPlan(null);
    }
  };

  const handlePortal = async () => {
    setLoadingPortal(true);
    setError(null);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
      const res = await fetch(`${apiUrl}/billing/portal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          returnUrl: window.location.href,
        }),
      });

      if (!res.ok) throw new Error("Failed to access customer portal");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No portal URL returned");
      }
    } catch (err: any) {
      setError(err.message || "An error occurred");
      setLoadingPortal(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", marginTop: "24px" }}>
      {error && (
        <div style={{
          backgroundColor: "var(--color-error-glow)",
          border: "1px solid var(--color-error)",
          color: "var(--color-text-primary)",
          padding: "16px",
          borderRadius: "12px",
          fontSize: "0.9rem"
        }}>
          {error}
        </div>
      )}

      {/* Plan Cards Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: "24px"
      }}>
        {plans.map((p) => {
          const isCurrent = p.type === currentPlanType;
          const isFree = p.type === "FREE";
          return (
            <div
              key={p.type}
              className="glass-panel"
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                border: isCurrent ? "1px solid var(--color-primary)" : undefined,
                boxShadow: isCurrent ? "0 0 20px var(--color-primary-glow)" : undefined
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <h3 style={{ fontSize: "1.3rem", color: "#fff" }}>{p.name}</h3>
                  {isCurrent && (
                    <span className="status-badge online" style={{ fontSize: "0.7rem", padding: "4px 8px" }}>
                      Active
                    </span>
                  )}
                </div>
                <p style={{
                  color: "var(--color-text-secondary)",
                  fontSize: "0.9rem",
                  lineHeight: 1.5,
                  marginBottom: "16px"
                }}>
                  {p.description || `Access to platform ${p.name} tier limits.`}
                </p>
                <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "#fff", marginBottom: "24px" }}>
                  ${(p.priceMonthlyUsdCents / 100).toFixed(2)}
                  <span style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", fontWeight: 500 }}> /mo</span>
                </div>
              </div>

              {isCurrent ? (
                <button
                  disabled
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "8px",
                    background: "rgba(99, 102, 241, 0.15)",
                    border: "1px solid rgba(99, 102, 241, 0.2)",
                    color: "var(--color-primary)",
                    fontWeight: 600,
                    cursor: "not-allowed"
                  }}
                >
                  Current Plan
                </button>
              ) : isFree ? (
                <button
                  disabled
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "8px",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    color: "var(--color-text-muted)",
                    fontWeight: 600,
                    cursor: "not-allowed"
                  }}
                >
                  Free Tier
                </button>
              ) : (
                <button
                  onClick={() => handleCheckout(p.type)}
                  disabled={loadingPlan !== null || loadingPortal}
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "8px",
                    background: "linear-gradient(135deg, var(--color-primary) 0%, #4f46e5 100%)",
                    border: "none",
                    color: "#fff",
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(99,102,241,0.2)",
                    transition: "all 0.2s"
                  }}
                >
                  {loadingPlan === p.type ? "Redirecting..." : "Choose Plan"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Customer Portal Button (Manage/Cancel) */}
      {currentPlanType !== "FREE" && (
        <div className="glass-panel" style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px"
        }}>
          <div>
            <h4 style={{ color: "#fff", fontSize: "1.1rem", marginBottom: "4px" }}>Manage Billing or Cancel</h4>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem" }}>
              Update payment methods, view invoices, or cancel your active plan on Stripe.
            </p>
          </div>
          <button
            onClick={handlePortal}
            disabled={loadingPortal || loadingPlan !== null}
            style={{
              padding: "12px 24px",
              borderRadius: "8px",
              background: "rgba(244, 63, 94, 0.1)",
              border: "1px solid rgba(244, 63, 94, 0.3)",
              color: "var(--color-error)",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            {loadingPortal ? "Loading..." : "Manage / Cancel Subscription"}
          </button>
        </div>
      )}
    </div>
  );
}

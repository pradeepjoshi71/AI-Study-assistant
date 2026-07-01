import { cookies } from "next/headers";
import Link from "next/link";
import { TokenSyncClient, TokenClearClient } from "../../dashboard/billing/TokenComponents";
import AdminReferralsClient from "./AdminReferralsClient";

async function fetchFraudReferrals(token: string) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
  try {
    const res = await fetch(`${apiUrl}/admin/referrals/fraud`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Error fetching fraud referrals:", err);
    return null;
  }
}

export default async function AdminReferralsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  if (!token) {
    return <TokenSyncClient />;
  }

  const fraudReferrals = await fetchFraudReferrals(token);

  if (!fraudReferrals) {
    return <TokenClearClient />;
  }

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
        <Link href="/admin/system" style={{
          color: "var(--color-primary)",
          textDecoration: "none",
          fontWeight: 600,
          fontSize: "0.9rem",
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "16px"
        }}>
          ← Back to Admin Control Center
        </Link>
        <h1 style={{
          fontSize: "2.5rem",
          fontWeight: 700,
          background: "linear-gradient(135deg, #ffffff 30%, #a5a6c2 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}>
          Affiliate & Referral Admin
        </h1>
        <p style={{ color: "var(--color-text-secondary)", fontSize: "1rem", marginTop: "4px" }}>
          Monitor security logs, resolve flagged fraud referrals, and manage manual payouts.
        </p>
      </header>

      <AdminReferralsClient
        token={token}
        initialFraudReferrals={fraudReferrals}
      />
    </main>
  );
}

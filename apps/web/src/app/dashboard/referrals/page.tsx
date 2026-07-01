import { cookies } from "next/headers";
import Link from "next/link";
import { TokenSyncClient, TokenClearClient } from "../billing/TokenComponents";
import ReferralsClient from "./ReferralsClient";

async function fetchReferralCode(token: string) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
  try {
    const res = await fetch(`${apiUrl}/referrals/code`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Error fetching referral code:", err);
    return null;
  }
}

async function fetchReferralStats(token: string) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
  try {
    const res = await fetch(`${apiUrl}/referrals/stats`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Error fetching referral stats:", err);
    return null;
  }
}

async function fetchReferralPayouts(token: string) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
  try {
    const res = await fetch(`${apiUrl}/referrals/payouts`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Error fetching referral payouts:", err);
    return null;
  }
}

export default async function ReferralsDashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  if (!token) {
    return <TokenSyncClient />;
  }

  const codeData = await fetchReferralCode(token);
  const stats = await fetchReferralStats(token);
  const payouts = await fetchReferralPayouts(token);

  if (!codeData || !stats || !payouts) {
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
          Refer & Earn
        </h1>
        <p style={{ color: "var(--color-text-secondary)", fontSize: "1rem", marginTop: "4px" }}>
          Invite your colleagues to join and earn affiliate rewards.
        </p>
      </header>

      <ReferralsClient
        token={token}
        initialCode={codeData.code}
        initialStats={stats}
        initialPayouts={payouts}
      />
    </main>
  );
}

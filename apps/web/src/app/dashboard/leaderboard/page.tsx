import { cookies } from "next/headers";
import Link from "next/link";
import LeaderboardDashboardClient from "./LeaderboardDashboardClient";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

async function fetchLeaderboardData(token: string, orgId: string) {
  try {
    const res = await fetch(`${apiUrl}/leaderboard/${orgId}?period=weekly`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Failed to load leaderboard data:", err);
    return null;
  }
}

export const metadata = {
  title: "Leaderboard — AI Study Assistant",
  description: "View organization rankings and scores.",
};

export default async function LeaderboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  if (!token) {
    return (
      <main style={{ padding: "80px 20px", textAlign: "center" }}>
        <p style={{ color: "var(--color-text-muted)" }}>Please log in to view the leaderboard.</p>
        <Link href="/" style={{ color: "var(--color-primary)" }}>Go home</Link>
      </main>
    );
  }

  // Deduce user's current org context
  let orgId = "personal";
  try {
    // Basic JWT parsing to read orgId context
    const parts = token.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
      orgId = payload.orgId || "personal";
    }
  } catch (e) {
    // fallback
  }

  const initialData = await fetchLeaderboardData(token, orgId);

  if (!initialData) {
    return (
      <main style={{ padding: "80px 20px", textAlign: "center" }}>
        <p style={{ color: "var(--color-text-muted)" }}>Failed to load leaderboard statistics.</p>
      </main>
    );
  }

  return <LeaderboardDashboardClient initialData={initialData} token={token} orgId={orgId} />;
}

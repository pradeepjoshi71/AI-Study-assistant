import { cookies } from "next/headers";
import Link from "next/link";
import ProgressDashboardClient from "./ProgressDashboardClient";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

async function fetchProgressData(token: string) {
  try {
    const res = await fetch(`${apiUrl}/progress/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Failed to load progress data:", err);
    return null;
  }
}

export const metadata = {
  title: "My Progress — AI Study Assistant",
  description: "Track your study XP, levels, and badges.",
};

export default async function ProgressPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  if (!token) {
    return (
      <main style={{ padding: "80px 20px", textAlign: "center" }}>
        <p style={{ color: "var(--color-text-muted)" }}>Please log in to view your progress.</p>
        <Link href="/" style={{ color: "var(--color-primary)" }}>Go home</Link>
      </main>
    );
  }

  const data = await fetchProgressData(token);

  if (!data) {
    return (
      <main style={{ padding: "80px 20px", textAlign: "center" }}>
        <p style={{ color: "var(--color-text-muted)" }}>Failed to load progress data.</p>
      </main>
    );
  }

  return <ProgressDashboardClient data={data} />;
}

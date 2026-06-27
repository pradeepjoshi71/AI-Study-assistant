import { cookies } from "next/headers";
import Link from "next/link";
import TeamClient from "./TeamClient";
import InviteForm from "./InviteForm";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

async function fetchMembers(orgId: string, token: string) {
  try {
    const res = await fetch(`${apiUrl}/organizations/${orgId}/members`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function fetchOrg(orgId: string, token: string) {
  try {
    const res = await fetch(`${apiUrl}/organizations/${orgId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function decodeJwt(token: string): any {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

export const metadata = {
  title: "Team — AI Study Assistant",
  description: "Manage your organization members and invitations.",
};

export default async function TeamPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  if (!token) {
    return (
      <main style={{ padding: "80px 20px", textAlign: "center" }}>
        <p style={{ color: "var(--color-text-muted)" }}>Please log in to view your team.</p>
        <Link href="/" style={{ color: "var(--color-primary)" }}>Go home</Link>
      </main>
    );
  }

  const payload = decodeJwt(token);
  const userId: string = payload?.sub ?? "";
  const orgId: string = payload?.orgId ?? "";

  if (!orgId) {
    return (
      <main style={{ padding: "80px 20px", textAlign: "center" }}>
        <p style={{ color: "var(--color-text-muted)" }}>No active organization found in your session.</p>
        <Link href="/dashboard/billing" style={{ color: "var(--color-primary)" }}>
          Switch to an organization first →
        </Link>
      </main>
    );
  }

  const [members, org] = await Promise.all([
    fetchMembers(orgId, token),
    fetchOrg(orgId, token),
  ]);

  const currentMember = members.find((m: any) => m.user.id === userId);
  const currentUserRole: string = currentMember?.role ?? "VIEWER";
  const canManage = currentUserRole === "OWNER" || currentUserRole === "ADMIN";

  const seatCount = members.length;
  const seatLimit = org?.plan?.maxUsers ?? null;
  const seatPercent = seatLimit ? Math.min(100, Math.round((seatCount / seatLimit) * 100)) : null;

  return (
    <main style={{ padding: "40px 20px", maxWidth: "900px", margin: "0 auto", position: "relative", zIndex: 10 }}>
      {/* Header */}
      <header style={{ marginBottom: "36px" }}>
        <Link href="/" style={{
          color: "var(--color-primary)", textDecoration: "none", fontWeight: 600,
          fontSize: "0.875rem", display: "inline-flex", alignItems: "center", gap: "6px", marginBottom: "20px",
        }}>
          ← Back to Dashboard
        </Link>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "6px" }}>
              Team Management
            </h1>
            <p style={{ color: "var(--color-text-muted)", fontSize: "0.95rem" }}>
              {org?.name ?? "Your Organization"} · {seatCount} member{seatCount !== 1 ? "s" : ""}
              {seatLimit ? ` of ${seatLimit} seats` : ""}
            </p>
          </div>

          {/* Seat usage pill */}
          {seatLimit && (
            <div style={{
              padding: "8px 16px",
              background: seatPercent! >= 90 ? "rgba(244,63,94,0.12)" : "rgba(99,102,241,0.12)",
              border: `1px solid ${seatPercent! >= 90 ? "rgba(244,63,94,0.3)" : "rgba(99,102,241,0.3)"}`,
              borderRadius: "10px",
              fontSize: "0.875rem",
              fontWeight: 600,
              color: seatPercent! >= 90 ? "#f43f5e" : "var(--color-primary)",
            }}>
              {seatCount} / {seatLimit} seats used
            </div>
          )}
        </div>
      </header>

      {/* Seat progress bar */}
      {seatLimit && (
        <div style={{ marginBottom: "32px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
            <span>Seat Usage</span>
            <span>{seatPercent}%</span>
          </div>
          <div style={{ height: "6px", borderRadius: "999px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${seatPercent}%`,
              borderRadius: "999px",
              background: seatPercent! >= 90
                ? "linear-gradient(90deg, #f43f5e, #fb7185)"
                : "linear-gradient(90deg, var(--color-primary), var(--color-secondary))",
              transition: "width 0.8s cubic-bezier(0.16,1,0.3,1)",
            }} />
          </div>
        </div>
      )}

      {/* Invite form (ADMIN+) */}
      {canManage && (
        <div className="glass-panel" style={{ marginBottom: "28px" }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 600, marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="7" cy="6" r="3" stroke="var(--color-primary)" strokeWidth="1.5"/>
              <path d="M1 15c0-3.31 2.69-6 6-6" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M13 10v6M10 13h6" stroke="var(--color-secondary)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Invite a Member
          </h2>
          <InviteForm orgId={orgId} token={token} onInvited={() => {}} />
        </div>
      )}

      {/* Member list */}
      <div className="glass-panel">
        <h2 style={{ fontSize: "1.05rem", fontWeight: 600, marginBottom: "20px", display: "flex", alignItems: "center", gap: "8px" }}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="6" cy="5" r="3" stroke="var(--color-primary)" strokeWidth="1.5"/>
            <circle cx="12" cy="5" r="3" stroke="var(--color-primary)" strokeWidth="1.5"/>
            <path d="M0 15c0-3.31 2.69-6 6-6M12 9c3.31 0 6 2.69 6 6" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Members ({seatCount})
        </h2>

        {members.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)", textAlign: "center", padding: "32px 0" }}>
            No members found.
          </p>
        ) : (
          <TeamClient
            members={members}
            orgId={orgId}
            currentUserId={userId}
            currentUserRole={currentUserRole}
            token={token}
          />
        )}
      </div>
    </main>
  );
}

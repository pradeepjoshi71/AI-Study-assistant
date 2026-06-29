"use client";

import React, { useState, useEffect } from "react";

interface LeaderboardUser {
  rank: number;
  userId: string;
  name: string;
  avatar: string | null;
  score: number;
}

interface LeaderboardResponse {
  leaderboard: LeaderboardUser[];
  currentUser: {
    rank: number | null;
    score: number | null;
  } | null;
}

interface LeaderboardDashboardClientProps {
  initialData: LeaderboardResponse;
  token: string;
  orgId: string;
}

export default function LeaderboardDashboardClient({
  initialData,
  token,
  orgId,
}: LeaderboardDashboardClientProps) {
  const [data, setData] = useState<LeaderboardResponse>(initialData);
  const [period, setPeriod] = useState<"weekly" | "alltime">("weekly");
  const [loading, setLoading] = useState(false);

  const fetchLeaderboard = async (selectedPeriod: "weekly" | "alltime") => {
    setLoading(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    try {
      const res = await fetch(`${apiUrl}/leaderboard/${orgId}?period=${selectedPeriod}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const payload = await res.json();
        setData(payload);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePeriodChange = (selectedPeriod: "weekly" | "alltime") => {
    setPeriod(selectedPeriod);
    fetchLeaderboard(selectedPeriod);
  };

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "40px 20px", color: "#fff" }}>
      <header style={{ marginBottom: "32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              background: "linear-gradient(135deg, #ffffff 30%, #a5a6c2 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Study Leaderboard
          </h1>
          <p style={{ color: "var(--color-text-secondary)", marginTop: "4px" }}>
            See how your learning XP compares to peers in your organization.
          </p>
        </div>

        {/* Toggle Controls */}
        <div
          style={{
            display: "flex",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "10px",
            padding: "4px",
          }}
        >
          <button
            onClick={() => handlePeriodChange("weekly")}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              background: period === "weekly" ? "var(--color-primary)" : "transparent",
              color: "#fff",
              border: "none",
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.2s",
            }}
          >
            Weekly
          </button>
          <button
            onClick={() => handlePeriodChange("alltime")}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              background: period === "alltime" ? "var(--color-primary)" : "transparent",
              color: "#fff",
              border: "none",
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.2s",
            }}
          >
            All-Time
          </button>
        </div>
      </header>

      {/* Current User Rank Card */}
      {data.currentUser && (
        <div
          className="glass-panel"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "20px 24px",
            marginBottom: "24px",
            border: "1px solid var(--color-primary-glow)",
            background: "rgba(99, 102, 241, 0.03)",
          }}
        >
          <div>
            <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
              Your Rank ({period === "weekly" ? "Weekly" : "All-Time"})
            </span>
            <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "var(--color-primary)", marginTop: "2px" }}>
              {data.currentUser.rank ? `#${data.currentUser.rank}` : "Unranked"}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
              XP Score
            </span>
            <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#fff", marginTop: "2px" }}>
              {data.currentUser.score !== null ? `${data.currentUser.score} XP` : "-"}
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard list container */}
      <div className="glass-panel" style={{ padding: "8px 0" }}>
        {loading ? (
          <p style={{ textAlign: "center", padding: "40px", color: "var(--color-text-muted)" }}>
            Updating leaderboard stats...
          </p>
        ) : data.leaderboard.length === 0 ? (
          <p style={{ textAlign: "center", padding: "40px", color: "var(--color-text-muted)" }}>
            No activity logged for this period yet.
          </p>
        ) : (
          <div>
            {data.leaderboard.map((user, index) => {
              const isCurrentUser = data.currentUser?.rank === user.rank;
              const isTop3 = user.rank <= 3;
              const medalEmoji = user.rank === 1 ? "🥇" : user.rank === 2 ? "🥈" : user.rank === 3 ? "🥉" : null;

              return (
                <div
                  key={user.userId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px 24px",
                    background: isCurrentUser ? "rgba(99,102,241,0.06)" : "transparent",
                    borderBottom: index < data.leaderboard.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    {/* Rank Badge */}
                    <div
                      style={{
                        width: "36px",
                        textAlign: "center",
                        fontWeight: 800,
                        fontSize: isTop3 ? "1.2rem" : "1rem",
                        color: isTop3 ? "var(--color-primary)" : "var(--color-text-muted)",
                      }}
                    >
                      {medalEmoji || `#${user.rank}`}
                    </div>

                    {/* Profile details */}
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div
                        style={{
                          width: "40px",
                          height: "40px",
                          borderRadius: "50%",
                          background: "rgba(255,255,255,0.08)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "1.1rem",
                          fontWeight: 700,
                          color: "var(--color-primary)",
                          border: `2px solid ${isCurrentUser ? "var(--color-primary)" : "rgba(255,255,255,0.1)"}`,
                          overflow: "hidden",
                        }}
                      >
                        {user.avatar ? (
                          <img src={user.avatar} alt={user.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          user.name.charAt(0).toUpperCase()
                        )}
                      </div>
                      <div>
                        <span style={{ fontWeight: 600, color: isCurrentUser ? "var(--color-primary)" : "#fff" }}>
                          {user.name}
                        </span>
                        {isCurrentUser && (
                          <span
                            style={{
                              marginLeft: "8px",
                              fontSize: "0.65rem",
                              fontWeight: 700,
                              background: "var(--color-primary-glow)",
                              color: "var(--color-primary)",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              textTransform: "uppercase",
                            }}
                          >
                            You
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>
                    {user.score} <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--color-text-muted)" }}>XP</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

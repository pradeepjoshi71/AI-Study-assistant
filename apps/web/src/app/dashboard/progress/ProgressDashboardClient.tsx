"use client";

import React from "react";

interface ProgressData {
  progress: {
    totalXP: number;
    level: number;
    weeklyXP: number;
    monthlyXP: number;
  };
  streak: {
    currentStreak: number;
    longestStreak: number;
  };
  badges: Array<{
    id: string;
    name: string;
    description: string;
    icon: string;
    triggerType: string;
    triggerValue: number;
    earned: boolean;
    earnedAt: string | null;
  }>;
  weeklyActivity: Array<{ date: string; xp: number }>;
  heatmap: Array<{ date: string; count: number }>;
}

interface ProgressDashboardClientProps {
  data: ProgressData;
}

export default function ProgressDashboardClient({ data }: ProgressDashboardClientProps) {
  const { progress, streak, badges, weeklyActivity, heatmap } = data;

  // Level calculation: next level total XP requirement is level^2 * 100
  // Level N requires N^2 * 100 XP. So Level N+1 requires (N+1)^2 * 100 XP.
  const currentLevelMinXp = Math.pow(progress.level, 2) * 100;
  const nextLevelMinXp = Math.pow(progress.level + 1, 2) * 100;
  const levelRange = nextLevelMinXp - currentLevelMinXp;
  const currentLevelProgressXp = Math.max(0, progress.totalXP - currentLevelMinXp);
  const progressPercent = Math.min(100, Math.floor((currentLevelProgressXp / levelRange) * 100));

  // Heatmap activity color resolver (GitHub style)
  const getHeatmapColor = (count: number) => {
    if (count === 0) return "rgba(255, 255, 255, 0.05)";
    if (count < 50) return "rgba(129, 140, 248, 0.3)";     // light indigo
    if (count < 150) return "rgba(129, 140, 248, 0.6)";    // medium indigo
    return "rgba(129, 140, 248, 1)";                       // pure active indigo
  };

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "40px 20px", color: "#fff" }}>
      {/* Header section */}
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
            Study Progress & Achievements
          </h1>
          <p style={{ color: "var(--color-text-secondary)", marginTop: "4px" }}>
            Track your level, XP milestones, study streaks, and badges.
          </p>
        </div>

        {/* Streak Indicator */}
        <div
          className="glass-panel"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px 20px",
            border: "1px solid rgba(245, 158, 11, 0.2)",
            background: "rgba(245, 158, 11, 0.04)",
          }}
        >
          <span style={{ fontSize: "2rem" }}>🔥</span>
          <div>
            <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "#f59e0b", lineHeight: 1.1 }}>
              {streak.currentStreak} Days
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", textTransform: "uppercase" }}>
              Current Streak (Max: {streak.longestStreak})
            </div>
          </div>
        </div>
      </header>

      {/* Level Card */}
      <div className="glass-panel" style={{ padding: "28px", marginBottom: "32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "16px" }}>
          <div>
            <span style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", textTransform: "uppercase", fontWeight: 600 }}>
              Current Level
            </span>
            <h2 style={{ fontSize: "2.5rem", fontWeight: 800, color: "var(--color-primary)", lineHeight: 1 }}>
              Level {progress.level}
            </h2>
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
              {progress.totalXP} / {nextLevelMinXp} Total XP
            </span>
            <div style={{ fontSize: "1rem", fontWeight: 600, color: "#fff", marginTop: "4px" }}>
              {nextLevelMinXp - progress.totalXP} XP to Level {progress.level + 1}
            </div>
          </div>
        </div>

        {/* Progress Bar Container */}
        <div style={{ height: "12px", background: "rgba(255,255,255,0.06)", borderRadius: "6px", overflow: "hidden", position: "relative" }}>
          <div
            style={{
              height: "100%",
              width: `${progressPercent}%`,
              background: "linear-gradient(90deg, var(--color-primary) 0%, #818cf8 100%)",
              borderRadius: "6px",
              transition: "width 0.5s ease",
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--color-text-muted)", marginTop: "8px" }}>
          <span>Lvl {progress.level}</span>
          <span>{progressPercent}% Completed</span>
          <span>Lvl {progress.level + 1}</span>
        </div>
      </div>

      {/* Grid: 7-day Activity Chart & Badges */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px", marginBottom: "32px" }}>
        {/* Weekly Activity */}
        <div className="glass-panel" style={{ padding: "24px" }}>
          <h3 style={{ fontSize: "1.1rem", marginBottom: "20px", fontWeight: 600 }}>Last 7 Days Activity</h3>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", height: "140px", padding: "10px 0" }}>
            {weeklyActivity.map((day) => {
              const maxXP = Math.max(...weeklyActivity.map((d) => d.xp), 10);
              const heightPercent = Math.min(100, Math.max(5, Math.floor((day.xp / maxXP) * 100)));
              const weekday = new Date(day.date).toLocaleDateString("en-US", { weekday: "short" });

              return (
                <div key={day.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)", marginBottom: "4px" }}>
                    {day.xp > 0 ? `${day.xp}` : "-"}
                  </div>
                  <div
                    style={{
                      width: "24px",
                      height: `${heightPercent}px`,
                      background: day.xp > 0 ? "var(--color-primary)" : "rgba(255,255,255,0.04)",
                      borderRadius: "4px 4px 0 0",
                      transition: "height 0.3s ease",
                    }}
                  />
                  <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "8px" }}>
                    {weekday}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Heatmap Section */}
        <div className="glass-panel" style={{ padding: "24px" }}>
          <h3 style={{ fontSize: "1.1rem", marginBottom: "16px", fontWeight: 600 }}>Study Activity (Last 90 Days)</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(15, 1fr)",
              gap: "6px",
              padding: "10px 0",
            }}
          >
            {heatmap.map((day) => (
              <div
                key={day.date}
                title={`${day.date}: ${day.count} XP earned`}
                style={{
                  aspectRatio: "1/1",
                  background: getHeatmapColor(day.count),
                  borderRadius: "2px",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "12px" }}>
            <span>90 Days Ago</span>
            <span>Today</span>
          </div>
        </div>
      </div>

      {/* Badge Grid Section */}
      <section className="glass-panel" style={{ padding: "28px" }}>
        <h3 style={{ fontSize: "1.2rem", marginBottom: "24px", fontWeight: 700 }}>Achievements & Badges</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "20px" }}>
          {badges.map((badge) => (
            <div
              key={badge.id}
              title={badge.description}
              style={{
                background: badge.earned ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.2)",
                border: `1px solid ${badge.earned ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)"}`,
                borderRadius: "16px",
                padding: "20px 16px",
                textAlign: "center",
                position: "relative",
                filter: badge.earned ? "none" : "grayscale(100%) opacity(40%)",
                transition: "transform 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-4px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              <div style={{ fontSize: "2rem", marginBottom: "12px" }}>
                {badge.icon === "zap" && "⚡"}
                {badge.icon === "brain" && "🧠"}
                {badge.icon === "crown" && "👑"}
                {badge.icon === "star" && "⭐"}
                {badge.icon === "stars" && "✨"}
                {badge.icon === "medal" && "🏅"}
                {badge.icon === "trophy" && "🏆"}
                {badge.icon === "award" && "🎗️"}
                {badge.icon === "file-upload" && "📤"}
                {badge.icon === "archive" && "📦"}
                {badge.icon === "library" && "📚"}
                {badge.icon === "calendar-check" && "📅"}
                {badge.icon === "shield" && "🛡️"}
                {badge.icon === "user-graduate" && "🎓"}
                {badge.icon === "book-reader" && "📖"}
              </div>
              <h4 style={{ fontWeight: 600, fontSize: "0.95rem", marginBottom: "4px" }}>{badge.name}</h4>
              <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", lineHeight: 1.3 }}>
                {badge.description}
              </p>
              {badge.earnedAt && (
                <div style={{ fontSize: "0.65rem", color: "var(--color-primary)", marginTop: "8px", fontWeight: 600 }}>
                  Earned {new Date(badge.earnedAt).toLocaleDateString()}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

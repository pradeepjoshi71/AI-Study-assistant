"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";

interface MasteryItem {
  topicId: string;
  topicName: string;
  masteryScore: number;
  confidence: number;
}

interface AdaptiveSessionInfo {
  sessionId: string;
  currentDifficulty: number;
  targetMastery: number;
  status: string;
}

export default function AdaptiveDashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [masteries, setMasteries] = useState<MasteryItem[]>([]);
  const [session, setSession] = useState<AdaptiveSessionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (savedToken) setToken(savedToken);
  }, []);

  useEffect(() => {
    if (token) {
      fetchSummary();
    }
  }, [token]);

  const fetchSummary = async () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    try {
      const res = await fetch(`${apiUrl}/study/adaptive/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMasteries(data.masteries || []);
        setSession(data.session);
      }
    } catch (err) {
      console.error("Failed to load adaptive metrics summary:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "40px", color: "var(--color-text-secondary)" }}>
        Loading adaptive study metrics...
      </div>
    );
  }

  // Format Recharts data (0 - 100 percentage scale for RadarChart)
  const chartData = masteries.map((m) => ({
    subject: m.topicName,
    A: Math.round(m.masteryScore * 100),
    fullMark: 100,
  }));

  // Default mock fallback values if no masteries exist yet
  const dummyChartData = [
    { subject: "Calculus", A: 85, fullMark: 100 },
    { subject: "Quantum Physics", A: 65, fullMark: 100 },
    { subject: "Cell Biology", A: 45, fullMark: 100 },
    { subject: "Data Structures", A: 70, fullMark: 100 },
    { subject: "Microeconomics", A: 90, fullMark: 100 },
  ];

  const activeChartData = chartData.length > 0 ? chartData : dummyChartData;

  return (
    <div style={{ padding: "30px", maxWidth: "1200px", margin: "0 auto" }}>
      <header style={{ marginBottom: "30px" }}>
        <h1 style={{ fontSize: "2rem", color: "#fff", marginBottom: "8px" }}>Adaptive Learning Studio</h1>
        <p style={{ color: "var(--color-text-secondary)", fontSize: "0.95rem" }}>
          Real-time latent capability modeling via Item Response Theory (IRT)
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "30px", alignItems: "start" }}>
        {/* Topic Mastery RadarChart Card */}
        <section
          style={{
            background: "rgba(10,10,12,0.4)",
            border: "1px solid var(--glass-border)",
            borderRadius: "16px",
            padding: "24px",
            height: "450px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <h3 style={{ fontSize: "1.1rem", color: "#fff", marginBottom: "20px" }}>Topic Mastery Map</h3>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={activeChartData}>
                <PolarGrid stroke="rgba(255,255,255,0.08)" />
                <PolarAngleAxis dataKey="subject" stroke="#8a8b98" fontSize={11} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#4f46e5" />
                <Radar
                  name="Mastery"
                  dataKey="A"
                  stroke="#6366f1"
                  fill="#6366f1"
                  fillOpacity={0.25}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: "30px" }}>
          {/* Active Session & Recommendations Action CTA Card */}
          <section
            style={{
              background: "rgba(99, 102, 241, 0.05)",
              border: "1px solid rgba(99, 102, 241, 0.2)",
              borderRadius: "16px",
              padding: "24px",
            }}
          >
            <span
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                background: "rgba(99, 102, 241, 0.15)",
                color: "#818cf8",
                padding: "4px 8px",
                borderRadius: "4px",
                fontWeight: 600,
              }}
            >
              Recommended Action
            </span>

            <h3 style={{ fontSize: "1.4rem", color: "#fff", marginTop: "12px", marginBottom: "8px" }}>
              {session?.currentDifficulty && session.currentDifficulty > 1.5 ? "Advanced Testing Challenge" : "Adaptive Practice Challenge"}
            </h3>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", lineHeight: 1.5, marginBottom: "20px" }}>
              {session
                ? `Active Session (Difficulty: ${session.currentDifficulty.toFixed(2)}) is ready. Target mastery: ${Math.round(session.targetMastery * 100)}%.`
                : "No active session. Start a personalized adaptive test designed to calibrate to your latent capability parameter levels."}
            </p>

            <div style={{ display: "flex", gap: "12px" }}>
              <Link
                href="/dashboard/adaptive/session"
                style={{
                  padding: "12px 24px",
                  background: "var(--color-primary)",
                  color: "#fff",
                  borderRadius: "8px",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                  textDecoration: "none",
                  transition: "opacity 0.2s",
                }}
              >
                {session ? "Resume Session" : "Start Calibration Test"}
              </Link>
              <Link
                href="/dashboard/review"
                style={{
                  padding: "12px 24px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid var(--glass-border)",
                  color: "#fff",
                  borderRadius: "8px",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                  textDecoration: "none",
                }}
              >
                Review Cards Stack
              </Link>
            </div>
          </section>

          {/* Topics & Difficulty Badges Card */}
          <section
            style={{
              background: "rgba(10,10,12,0.4)",
              border: "1px solid var(--glass-border)",
              borderRadius: "16px",
              padding: "24px",
            }}
          >
            <h3 style={{ fontSize: "1.1rem", color: "#fff", marginBottom: "16px" }}>Calibration by Topic</h3>
            {masteries.length === 0 ? (
              <p style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem" }}>
                No active topic scores completed. Complete study loops to calibrate difficulty.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {masteries.map((m) => (
                  <div
                    key={m.topicId}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "12px",
                      background: "rgba(0,0,0,0.2)",
                      borderRadius: "8px",
                      border: "1px solid rgba(255,255,255,0.02)",
                    }}
                  >
                    <div>
                      <h5 style={{ margin: 0, color: "#fff", fontSize: "0.9rem" }}>{m.topicName}</h5>
                      <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
                        Confidence: {Math.round(m.confidence * 100)}%
                      </span>
                    </div>

                    <span
                      style={{
                        padding: "4px 10px",
                        background: m.masteryScore > 0.75 ? "rgba(16, 185, 129, 0.12)" : m.masteryScore > 0.45 ? "rgba(245, 158, 11, 0.12)" : "rgba(239, 68, 68, 0.12)",
                        color: m.masteryScore > 0.75 ? "#34d399" : m.masteryScore > 0.45 ? "#fbbf24" : "#f87171",
                        border: m.masteryScore > 0.75 ? "1px solid rgba(16, 185, 129, 0.2)" : m.masteryScore > 0.45 ? "1px solid rgba(245, 158, 11, 0.2)" : "1px solid rgba(239, 68, 68, 0.2)",
                        borderRadius: "20px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                      }}
                    >
                      {m.masteryScore > 0.75 ? "Advanced" : m.masteryScore > 0.45 ? "Intermediate" : "Novice"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

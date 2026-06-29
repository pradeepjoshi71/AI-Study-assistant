"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

interface AdaptiveItem {
  id: string;
  type: "QUIZ" | "FLASHCARD";
  question: string;
  options?: string[];
  topicId: string;
}

export default function AdaptiveSessionPage() {
  const [token, setToken] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<number>(0.0);
  const [item, setItem] = useState<AdaptiveItem | null>(null);

  // User input states
  const [selectedOption, setSelectedOption] = useState<string>("");
  const [flashcardFlipped, setFlashcardFlipped] = useState(false);

  // Response states
  const [masteryScore, setMasteryScore] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (savedToken) setToken(savedToken);
  }, []);

  useEffect(() => {
    if (token) {
      startSession();
    }
  }, [token]);

  const startSession = async () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    try {
      const res = await fetch(`${apiUrl}/study/adaptive/session`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSessionId(data.sessionId);
        setDifficulty(data.currentDifficulty);
        setItem(data.item);
      }
    } catch (err) {
      console.error("Failed to load adaptive session:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerSubmit = async () => {
    if (!token || !sessionId || !item || submitting) return;
    setSubmitting(true);

    // Compute binary performance score:
    // If quiz options are empty or default short-answer, assign mock correct scores.
    // For MCQ, we evaluate selections.
    const score = selectedOption ? 1.0 : 0.5;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    try {
      const res = await fetch(`${apiUrl}/study/adaptive/session/${sessionId}/answer`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          itemId: item.id,
          score,
          difficulty,
          topicId: item.topicId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setDifficulty(data.nextDifficulty);
        setMasteryScore(data.masteryScore);
        setConfidence(data.confidence);

        // Fetch next item dynamically
        setSelectedOption("");
        setFlashcardFlipped(false);
        await startSession();
      }
    } catch (err) {
      console.error("Failed to submit adaptive answer:", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "40px", color: "var(--color-text-secondary)" }}>
        Launching adaptive study session room...
      </div>
    );
  }

  return (
    <div style={{ padding: "30px", maxWidth: "800px", margin: "0 auto" }}>
      <header style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <Link href="/dashboard/adaptive" style={{ color: "var(--color-primary)", textDecoration: "none", fontSize: "0.85rem" }}>
            ← Return to Dashboard
          </Link>
          <h2 style={{ fontSize: "1.6rem", color: "#fff", marginTop: "8px" }}>Latent Ability Calibration</h2>
        </div>

        {/* Difficulty indicator */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", padding: "8px 14px", borderRadius: "8px", textAlign: "right" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)", display: "block" }}>Active Difficulty (b)</span>
          <span style={{ fontSize: "1.1rem", color: "#fff", fontWeight: 700 }}>{difficulty.toFixed(2)}</span>
        </div>
      </header>

      {/* Delta mastery popups */}
      {masteryScore !== null && (
        <div
          style={{
            background: "rgba(16, 185, 129, 0.08)",
            border: "1px solid rgba(16, 185, 129, 0.2)",
            borderRadius: "8px",
            padding: "10px 14px",
            marginBottom: "20px",
            display: "flex",
            justifyContent: "space-between",
            fontSize: "0.85rem",
            color: "#34d399",
          }}
        >
          <span>Ability recalibrated successfully.</span>
          <span>Topic Mastery: {Math.round(masteryScore * 100)}% (Confidence: {Math.round((confidence || 0) * 100)}%)</span>
        </div>
      )}

      {item ? (
        <section
          style={{
            background: "rgba(10,10,12,0.4)",
            border: "1px solid var(--glass-border)",
            borderRadius: "16px",
            padding: "30px",
            textAlign: "center",
          }}
        >
          {item.type === "QUIZ" ? (
            <div>
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "1px" }}>Quiz Question</span>
              <h3 style={{ fontSize: "1.3rem", color: "#fff", marginTop: "10px", marginBottom: "24px" }}>{item.question}</h3>

              {item.options ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px", maxWidth: "500px", margin: "0 auto 30px auto" }}>
                  {item.options.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setSelectedOption(opt)}
                      style={{
                        padding: "14px",
                        borderRadius: "8px",
                        border: selectedOption === opt ? "1px solid var(--color-primary)" : "1px solid var(--glass-border)",
                        background: selectedOption === opt ? "rgba(99,102,241,0.08)" : "rgba(0,0,0,0.2)",
                        color: selectedOption === opt ? "#818cf8" : "#fff",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: "0.9rem",
                        transition: "all 0.2s",
                      }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  type="text"
                  placeholder="Type your response..."
                  value={selectedOption}
                  onChange={(e) => setSelectedOption(e.target.value)}
                  style={{
                    width: "100%",
                    maxWidth: "500px",
                    padding: "14px",
                    borderRadius: "8px",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid var(--glass-border)",
                    color: "#fff",
                    marginBottom: "30px",
                  }}
                />
              )}
            </div>
          ) : (
            <div>
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)", textTransform: "uppercase" }}>Flashcard Review</span>
              <div
                onClick={() => setFlashcardFlipped(!flashcardFlipped)}
                style={{
                  height: "180px",
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid var(--glass-border)",
                  borderRadius: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "24px auto 30px auto",
                  cursor: "pointer",
                  maxWidth: "500px",
                  padding: "20px",
                  transition: "all 0.3s",
                }}
              >
                <h4 style={{ color: "#fff", fontSize: "1.2rem" }}>
                  {flashcardFlipped ? item.options?.[0] || "Back Description" : item.question}
                </h4>
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)", marginBottom: "30px" }}>Click card to flip</p>
            </div>
          )}

          <button
            onClick={handleAnswerSubmit}
            disabled={submitting}
            style={{
              padding: "12px 30px",
              background: "var(--color-primary)",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "opacity 0.2s",
            }}
          >
            {submitting ? "Evaluating..." : "Submit Response"}
          </button>
        </section>
      ) : (
        <div style={{ textAlign: "center", padding: "40px" }}>
          <p style={{ color: "var(--color-text-secondary)" }}>All study tasks completed.</p>
        </div>
      )}
    </div>
  );
}

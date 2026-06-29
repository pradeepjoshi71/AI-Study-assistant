"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

interface DueFlashcard {
  id: string;
  front: string;
  back: string;
  easeFactor: number;
  interval: number;
}

export default function SpacedRepetitionReviewPage() {
  const [token, setToken] = useState<string | null>(null);
  const [queue, setQueue] = useState<DueFlashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (savedToken) setToken(savedToken);
  }, []);

  useEffect(() => {
    if (token) {
      fetchDueQueue();
    }
  }, [token]);

  const fetchDueQueue = async () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    try {
      const res = await fetch(`${apiUrl}/study/adaptive/review-queue`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setQueue(data);
      }
    } catch (err) {
      console.error("Failed to load spaced repetition review queue:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleRatingSubmit = async (score: number) => {
    if (!token || queue.length === 0) return;
    const activeCard = queue[currentIndex];

    // Determine recallStatus mapped from score bounds: score<3 is fail, 3=hard, >3=easy
    let recallStatus = "easy";
    if (score < 3) recallStatus = "fail";
    else if (score === 3) recallStatus = "hard";

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    try {
      const res = await fetch(`${apiUrl}/study/flashcards/${activeCard.id}/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          recallStatus,
          score, // send SM-2 rating score directly
        }),
      });

      if (res.ok) {
        setFlipped(false);
        if (currentIndex < queue.length - 1) {
          setCurrentIndex(currentIndex + 1);
        } else {
          // Re-fetch next batch once stack finishes
          setQueue([]);
          setCurrentIndex(0);
          fetchDueQueue();
        }
      }
    } catch (err) {
      console.error("Failed to submit SM-2 card rating review:", err);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "40px", color: "var(--color-text-secondary)" }}>
        Loading due flashcards queue...
      </div>
    );
  }

  const activeCard = queue[currentIndex];

  return (
    <div style={{ padding: "30px", maxWidth: "800px", margin: "0 auto" }}>
      <header style={{ marginBottom: "30px" }}>
        <Link href="/dashboard/adaptive" style={{ color: "var(--color-primary)", textDecoration: "none", fontSize: "0.85rem" }}>
          ← Return to Dashboard
        </Link>
        <h1 style={{ fontSize: "1.8rem", color: "#fff", marginTop: "8px", marginBottom: "4px" }}>Spaced Repetition Review</h1>
        <p style={{ color: "var(--color-text-secondary)", fontSize: "0.85rem" }}>
          Calibration utilizing SuperMemo-2 (SM-2) memory decay scheduler algorithms
        </p>
      </header>

      {queue.length === 0 || !activeCard ? (
        <section
          style={{
            background: "rgba(10,10,12,0.4)",
            border: "1px solid var(--glass-border)",
            borderRadius: "16px",
            padding: "50px 30px",
            textAlign: "center",
          }}
        >
          <span style={{ fontSize: "3rem" }}>🎉</span>
          <h3 style={{ fontSize: "1.3rem", color: "#fff", marginTop: "16px", marginBottom: "8px" }}>All Caught Up!</h3>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem", maxWidth: "450px", margin: "0 auto 24px auto" }}>
            No flashcard reviews due today. Check back later as active memory decay thresholds elapse.
          </p>
        </section>
      ) : (
        <div>
          {/* Progress Tracker bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", fontSize: "0.85rem" }}>
            <span style={{ color: "var(--color-text-secondary)" }}>
              Card {currentIndex + 1} of {queue.length}
            </span>
            <span style={{ color: "var(--color-primary)" }}>
              Interval: {activeCard.interval}d | EF: {activeCard.easeFactor.toFixed(2)}
            </span>
          </div>

          {/* Flashcard Frame */}
          <div
            onClick={() => setFlipped(!flipped)}
            style={{
              height: "260px",
              background: "rgba(10,10,12,0.4)",
              border: "1px solid var(--glass-border)",
              borderRadius: "16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: "30px",
              textAlign: "center",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              transition: "transform 0.3s",
              transform: flipped ? "rotateY(0deg)" : "rotateY(0deg)", // simplified flip view representation
            }}
          >
            <h3 style={{ color: "#fff", fontSize: "1.4rem", fontWeight: 500, lineHeight: 1.4 }}>
              {flipped ? activeCard.back : activeCard.front}
            </h3>
          </div>
          <p style={{ textAlign: "center", fontSize: "0.8rem", color: "#8a8b98", marginTop: "12px", marginBottom: "30px" }}>
            Click card to flip
          </p>

          {/* SM-2 Quality Score rating scale buttons (0-5) */}
          {flipped && (
            <div style={{ textAlign: "center" }}>
              <span style={{ display: "block", fontSize: "0.85rem", color: "var(--color-text-secondary)", marginBottom: "12px" }}>
                Rate your recall quality (0: Blackout, 5: Perfect):
              </span>

              <div style={{ display: "flex", justifyContent: "center", gap: "8px" }}>
                {[0, 1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={score}
                    onClick={() => handleRatingSubmit(score)}
                    style={{
                      width: "44px",
                      height: "44px",
                      borderRadius: "8px",
                      border: "1px solid var(--glass-border)",
                      background: score >= 4 ? "rgba(16, 185, 129, 0.1)" : score >= 3 ? "rgba(245, 158, 11, 0.1)" : "rgba(239, 68, 68, 0.1)",
                      color: score >= 4 ? "#34d399" : score >= 3 ? "#fbbf24" : "#f87171",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontSize: "1rem",
                      transition: "opacity 0.2s",
                    }}
                  >
                    {score}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

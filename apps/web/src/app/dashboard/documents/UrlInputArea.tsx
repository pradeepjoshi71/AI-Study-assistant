"use client";

import React, { useState } from "react";

interface UrlInputAreaProps {
  token: string;
  onUploadSuccess: () => void;
}

export default function UrlInputArea({ token, onUploadSuccess }: UrlInputAreaProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

    try {
      // For URL ingestion we send a JSON request with url and title
      const res = await fetch(`${apiUrl}/documents/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: new URL(url).hostname || "Webpage",
          url: url.trim(),
        }),
      });

      if (!res.ok) {
        const errMsg = await res.text();
        throw new Error(errMsg || "Failed to ingest URL");
      }

      setUrl("");
      onUploadSuccess();
    } catch (err: any) {
      setError(err.message || "Invalid URL or ingestion failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="glass-panel" style={{ marginTop: "20px" }}>
      <h3 style={{ fontSize: "1.1rem", marginBottom: "12px", color: "var(--color-text-primary)" }}>
        Ingest Web Page or YouTube Video URL
      </h3>
      <div style={{ display: "flex", gap: "12px" }}>
        <input
          type="url"
          required
          placeholder="https://example.com/article or https://youtube.com/watch?v=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{
            flex: 1,
            padding: "12px 16px",
            borderRadius: "10px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#fff",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "0 24px",
            borderRadius: "10px",
            background: "var(--color-primary)",
            color: "#fff",
            border: "none",
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Ingesting..." : "Ingest URL"}
        </button>
      </div>
      {error && (
        <p style={{ color: "var(--color-error)", marginTop: "12px", fontSize: "0.95rem" }}>
          {error}
        </p>
      )}
    </form>
  );
}

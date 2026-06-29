"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface ModalAsset {
  id: string;
  chunkId: string;
  modality: "TEXT" | "IMAGE" | "TABLE" | "DIAGRAM";
  storageKey: string;
  url: string;
  width?: number;
  height?: number;
  pageRef: number;
  caption?: string;
  imageHash?: string;
}

export default function DocumentDetailPage() {
  const params = useParams();
  const docId = params.id as string;
  const [token, setToken] = useState<string | null>(null);
  const [assets, setAssets] = useState<ModalAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeAsset, setActiveAsset] = useState<ModalAsset | null>(null);

  // Load token on startup
  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (savedToken) {
      setToken(savedToken);
    }
  }, []);

  // Fetch document assets
  useEffect(() => {
    if (!token || !docId) return;

    const fetchAssets = async () => {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
      try {
        const res = await fetch(`${apiUrl}/documents/${docId}/assets`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setAssets(data);
        }
      } catch (err) {
        console.error("Failed to fetch document assets:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchAssets();
  }, [token, docId]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
        <h3>Loading Visual Assets Gallery...</h3>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "40px 20px" }}>
      <header style={{ marginBottom: "32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <a
            href="/dashboard/documents"
            style={{
              color: "var(--color-secondary)",
              textDecoration: "none",
              fontSize: "0.9rem",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "12px",
            }}
          >
            ← Back to Documents
          </a>
          <h1
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              background: "linear-gradient(135deg, #ffffff 30%, #a5a6c2 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              margin: 0,
            }}
          >
            Extracted Multimodal Assets
          </h1>
          <p style={{ color: "var(--color-text-secondary)", marginTop: "4px" }}>
            Browse diagrams, images, and tables extracted from your document.
          </p>
        </div>
      </header>

      {assets.length === 0 ? (
        <div
          className="glass-panel"
          style={{
            padding: "60px 20px",
            textAlign: "center",
            color: "var(--color-text-muted)",
          }}
        >
          No visual assets (images, tables, or diagrams) were extracted from this document.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "24px",
          }}
        >
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="glass-panel"
              onClick={() => setActiveAsset(asset)}
              style={{
                cursor: "pointer",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                transition: "transform 0.2s, border-color 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-4px)";
                e.currentTarget.style.borderColor = "var(--color-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.borderColor = "var(--glass-border)";
              }}
            >
              {/* Asset thumbnail */}
              <div
                style={{
                  height: "200px",
                  background: "rgba(0,0,0,0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                  borderBottom: "1px solid var(--glass-border)",
                  overflow: "hidden",
                }}
              >
                <img
                  src={asset.url}
                  alt={asset.caption || "Extracted Asset"}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                    transition: "transform 0.3s",
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    top: "12px",
                    left: "12px",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    background:
                      asset.modality === "TABLE"
                        ? "rgba(16,185,129,0.9)"
                        : asset.modality === "DIAGRAM"
                        ? "rgba(245,158,11,0.9)"
                        : "rgba(99,102,241,0.9)",
                    color: "#fff",
                  }}
                >
                  {asset.modality}
                </span>
                <span
                  style={{
                    position: "absolute",
                    bottom: "12px",
                    right: "12px",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    fontSize: "0.7rem",
                    background: "rgba(0,0,0,0.6)",
                    color: "#fff",
                  }}
                >
                  Page {asset.pageRef}
                </span>
              </div>

              {/* Caption */}
              <div style={{ padding: "16px", flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "#fff",
                    margin: 0,
                    lineHeight: 1.5,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {asset.caption || "No caption generated."}
                </p>
                <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "auto" }}>
                  Hash: <code>{asset.imageHash?.substring(0, 12)}...</code>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Expand Modal */}
      {activeAsset && (
        <div
          onClick={() => setActiveAsset(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.9)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "40px 20px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-panel"
            style={{
              width: "100%",
              maxWidth: "800px",
              display: "flex",
              flexDirection: "column",
              gap: "20px",
              padding: "24px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4 style={{ fontSize: "1.2rem", color: "#fff", margin: 0 }}>
                {activeAsset.modality} Asset (Page {activeAsset.pageRef})
              </h4>
              <button
                onClick={() => setActiveAsset(null)}
                style={{ background: "none", border: "none", color: "#fff", fontSize: "1.4rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                background: "rgba(0,0,0,0.5)",
                borderRadius: "12px",
                border: "1px solid var(--glass-border)",
                height: "400px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              <img
                src={activeAsset.url}
                alt={activeAsset.caption}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <h5 style={{ margin: 0, fontSize: "0.95rem", color: "var(--color-secondary)" }}>AI Caption Context</h5>
              <p style={{ margin: 0, color: "#fff", fontSize: "1rem", lineHeight: 1.6 }}>
                {activeAsset.caption || "No caption context available."}
              </p>
            </div>

            <div style={{ display: "flex", gap: "24px", fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>
              <span>
                Width: <strong>{activeAsset.width || "auto"}px</strong>
              </span>
              <span>
                Height: <strong>{activeAsset.height || "auto"}px</strong>
              </span>
              <span>
                Storage Key: <code>{activeAsset.storageKey}</code>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

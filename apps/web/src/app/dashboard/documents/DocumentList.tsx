"use client";

import React, { useEffect, useState } from "react";

interface DocumentItem {
  id: string;
  title: string;
  originalName: string;
  fileType: string;
  status: string;
  chunkCount: number;
  pageCount: number;
  sizeBytes: number;
  errorMessage?: string | null;
  createdAt: string;
  summary?: {
    textCount: number;
    tableCount: number;
    imageCount: number;
    diagramCount: number;
  };
}

interface DocumentListProps {
  initialDocuments: DocumentItem[];
  token: string;
  refreshTrigger: number;
  onDeleteSuccess: () => void;
}

const STATUS_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  PENDING: { bg: "rgba(245,158,11,0.12)", text: "#f59e0b", label: "PENDING" },
  PROCESSING: { bg: "rgba(99,102,241,0.12)", text: "#818cf8", label: "PROCESSING" },
  READY: { bg: "rgba(16,185,129,0.12)", text: "#34d399", label: "READY" },
  FAILED: { bg: "rgba(244,63,94,0.12)", text: "#f43f5e", label: "FAILED" },
};

export default function DocumentList({ initialDocuments, token, refreshTrigger, onDeleteSuccess }: DocumentListProps) {
  const [documents, setDocuments] = useState<DocumentItem[]>(initialDocuments);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchDocuments = async () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    try {
      const res = await fetch(`${apiUrl}/documents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const list = await res.json();
        // Fetch summary counts for each document to populate extraction summary card
        const enriched = await Promise.all(
          list.map(async (doc: any) => {
            try {
              const detailRes = await fetch(`${apiUrl}/documents/${doc.id}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (detailRes.ok) {
                const detail = await detailRes.json();
                return { ...doc, summary: detail.summary };
              }
            } catch {}
            return doc;
          })
        );
        setDocuments(enriched);
      }
    } catch (err) {
      console.error("Failed to fetch documents", err);
    }
  };

  // Re-fetch documents whenever upload/refresh triggers
  useEffect(() => {
    fetchDocuments();
  }, [refreshTrigger]);

  // Handle SSE status streaming for processing/pending documents
  useEffect(() => {
    const activeDocs = documents.filter(
      (doc) => doc.status === "PENDING" || doc.status === "PROCESSING"
    );

    if (activeDocs.length === 0) return;

    const eventSources: Record<string, EventSource> = {};
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

    activeDocs.forEach((doc) => {
      // Connect to NestJS SSE endpoint
      const es = new EventSource(`${apiUrl}/documents/${doc.id}/status?token=${token}`);

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setDocuments((prevDocs) =>
            prevDocs.map((d) =>
              d.id === data.documentId
                ? {
                    ...d,
                    status: data.status,
                    chunkCount: data.chunkCount || 0,
                    errorMessage: data.errorMessage || null,
                  }
                : d
            )
          );

          if (data.status === "READY" || data.status === "FAILED") {
            es.close();
            delete eventSources[doc.id];
            // Re-fetch to get enriched counts once ready
            fetchDocuments();
          }
        } catch (e) {
          console.error("Failed parsing SSE message", e);
        }
      };

      es.onerror = () => {
        es.close();
        delete eventSources[doc.id];
      };

      eventSources[doc.id] = es;
    });

    return () => {
      Object.values(eventSources).forEach((es) => es.close());
    };
  }, [documents]);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to permanently delete this document, its storage files, and vector index?")) return;

    setDeletingId(id);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

    try {
      const res = await fetch(`${apiUrl}/documents/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setDocuments((prev) => prev.filter((d) => d.id !== id));
        onDeleteSuccess();
      } else {
        alert("Failed to delete document.");
      }
    } catch (err) {
      console.error(err);
      alert("An error occurred during deletion.");
    } finally {
      setDeletingId(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "24px" }}>
      {documents.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)", textAlign: "center", padding: "40px" }}>
          No documents found. Upload a file above to begin.
        </p>
      ) : (
        documents.map((doc) => {
          const badge = STATUS_BADGES[doc.status] || STATUS_BADGES.PENDING;
          return (
            <div
              key={doc.id}
              className="glass-panel"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "16px",
                padding: "20px",
                transition: "border-color 0.2s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ flex: 1, minWidth: 0, paddingRight: "16px" }}>
                  <h4
                    style={{
                      fontSize: "1.1rem",
                      fontWeight: 600,
                      marginBottom: "4px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {doc.title}
                  </h4>
                  <div style={{ display: "flex", gap: "16px", fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
                    <span>{doc.fileType.toUpperCase()}</span>
                    <span>{formatSize(doc.sizeBytes)}</span>
                    <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: "6px",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                      background: badge.bg,
                      color: badge.text,
                      border: `1px solid ${badge.text}33`,
                    }}
                  >
                    {badge.label}
                  </span>

                  {doc.status === "READY" && (
                    <a
                      href={`/dashboard/documents/${doc.id}`}
                      style={{
                        padding: "8px 14px",
                        borderRadius: "8px",
                        background: "rgba(99, 102, 241, 0.1)",
                        border: "1px solid rgba(99, 102, 241, 0.2)",
                        color: "var(--color-secondary)",
                        textDecoration: "none",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        transition: "all 0.2s",
                      }}
                    >
                      Gallery View
                    </a>
                  )}

                  <button
                    onClick={() => handleDelete(doc.id)}
                    disabled={deletingId === doc.id}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "8px",
                      background: "rgba(244,63,94,0.1)",
                      border: "1px solid rgba(244,63,94,0.2)",
                      color: "#f43f5e",
                      cursor: deletingId === doc.id ? "wait" : "pointer",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      transition: "all 0.2s",
                    }}
                  >
                    {deletingId === doc.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>

              {/* Extraction summary card */}
              {doc.status === "READY" && doc.summary && (
                <div
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid var(--glass-border)",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: "12px",
                    textAlign: "center",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "#fff" }}>
                      {doc.summary.textCount || 0}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      Text Chunks
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "#fff" }}>
                      {doc.summary.imageCount || 0}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      Images
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "#fff" }}>
                      {doc.summary.tableCount || 0}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      Tables
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "#fff" }}>
                      {doc.summary.diagramCount || 0}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                      Diagrams
                    </div>
                  </div>
                </div>
              )}

              {doc.errorMessage && (
                <p style={{ color: "var(--color-error)", fontSize: "0.825rem", margin: 0 }}>
                  ⚠️ {doc.errorMessage}
                </p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

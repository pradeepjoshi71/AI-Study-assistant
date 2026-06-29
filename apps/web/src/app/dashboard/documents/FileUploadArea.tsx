"use client";

import React, { useState, useCallback } from "react";

interface FileUploadAreaProps {
  token: string;
  onUploadSuccess: () => void;
}

export default function FileUploadArea({ token, onUploadSuccess }: FileUploadAreaProps) {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const uploadFiles = async (files: FileList) => {
    setUploading(true);
    setError(null);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append("file", file);
        formData.append("title", file.name);

        const res = await fetch(`${apiUrl}/documents/upload`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        if (!res.ok) {
          const errMsg = await res.text();
          throw new Error(`Failed to upload ${file.name}: ${errMsg}`);
        }
      }
      onUploadSuccess();
    } catch (err: any) {
      setError(err.message || "An error occurred during file upload.");
    } finally {
      setUploading(false);
      setDragActive(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      uploadFiles(e.dataTransfer.files);
    }
  }, [token]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      uploadFiles(e.target.files);
    }
  };

  return (
    <div
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${dragActive ? "var(--color-primary)" : "var(--glass-border)"}`,
        borderRadius: "16px",
        padding: "40px 20px",
        textAlign: "center",
        background: dragActive ? "var(--color-primary-glow)" : "var(--glass-bg)",
        cursor: "pointer",
        transition: "all 0.3s ease",
      }}
    >
      <input
        type="file"
        multiple
        onChange={handleChange}
        style={{ display: "none" }}
        id="file-upload-input"
        accept=".pdf,.docx,.pptx,.txt,.png,.jpg,.jpeg"
      />
      <label htmlFor="file-upload-input" style={{ cursor: "pointer", display: "block" }}>
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-text-secondary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginBottom: "16px" }}
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p style={{ fontWeight: 600, fontSize: "1.1rem", marginBottom: "8px" }}>
          {uploading ? "Uploading files..." : "Drag and drop files here"}
        </p>
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9rem" }}>
          Supports PDF, DOCX, PPTX, TXT, PNG, JPG (Max 20MB)
        </p>
      </label>
      {error && (
        <p style={{ color: "var(--color-error)", marginTop: "12px", fontSize: "0.95rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}

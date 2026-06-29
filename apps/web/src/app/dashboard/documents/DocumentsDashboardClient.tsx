"use client";

import React, { useState } from "react";
import FileUploadArea from "./FileUploadArea";
import UrlInputArea from "./UrlInputArea";
import DocumentList from "./DocumentList";

interface DocumentsDashboardClientProps {
  initialDocuments: any[];
  token: string;
}

export default function DocumentsDashboardClient({
  initialDocuments,
  token,
}: DocumentsDashboardClientProps) {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleRefresh = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 20px" }}>
      <header style={{ marginBottom: "32px" }}>
        <h1
          style={{
            fontSize: "2rem",
            fontWeight: 700,
            background: "linear-gradient(135deg, #ffffff 30%, #a5a6c2 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Document Manager
        </h1>
        <p style={{ color: "var(--color-text-secondary)", marginTop: "4px" }}>
          Upload files or input URLs to process and chunk files for AI study tools.
        </p>
      </header>

      {/* Upload area */}
      <FileUploadArea token={token} onUploadSuccess={handleRefresh} />

      {/* URL input area */}
      <UrlInputArea token={token} onUploadSuccess={handleRefresh} />

      {/* Document list */}
      <DocumentList
        initialDocuments={initialDocuments}
        token={token}
        refreshTrigger={refreshTrigger}
        onDeleteSuccess={handleRefresh}
      />
    </div>
  );
}

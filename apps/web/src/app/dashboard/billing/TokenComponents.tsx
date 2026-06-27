"use client";

import { useEffect } from "react";

export function TokenSyncClient() {
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      document.cookie = `token=${token}; path=/; max-age=86400; SameSite=Lax;`;
      window.location.reload();
    } else {
      window.location.href = "/";
    }
  }, []);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      color: "var(--color-text-primary)",
      backgroundColor: "var(--bg-primary)"
    }}>
      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "16px" }}>Syncing Billing Session...</h2>
        <div className="status-dot online" style={{ width: "24px", height: "24px", margin: "0 auto" }}></div>
      </div>
    </div>
  );
}

export function TokenClearClient() {
  useEffect(() => {
    localStorage.removeItem("token");
    document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;";
    window.location.href = "/";
  }, []);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      color: "var(--color-text-primary)",
      backgroundColor: "var(--bg-primary)"
    }}>
      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 600, color: "var(--color-error)", marginBottom: "16px" }}>Session Expired</h2>
        <p style={{ color: "var(--color-text-secondary)" }}>Redirecting to login...</p>
      </div>
    </div>
  );
}

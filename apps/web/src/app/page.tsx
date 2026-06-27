"use client";

import { useEffect, useState } from "react";

interface ServiceStatus {
  online: boolean;
  loading: boolean;
  details?: any;
}

export default function FoundationDashboard() {
  const [apiStatus, setApiStatus] = useState<ServiceStatus>({
    online: false,
    loading: true,
  });
  const [aiStatus, setAiStatus] = useState<ServiceStatus>({
    online: false,
    loading: true,
  });

  const checkHealth = async () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
    const aiUrl = process.env.NEXT_PUBLIC_AI_SERVICE_URL || 'http://localhost:8000';
    // Check NestJS API
    try {
      const res = await fetch(`${apiUrl}/health`);
      if (res.ok) {
        const data = await res.json();
        setApiStatus({ online: true, loading: false, details: data });
      } else {
        setApiStatus({ online: false, loading: false });
      }
    } catch {
      setApiStatus({ online: false, loading: false });
    }

    // Check FastAPI Service
    try {
      const res = await fetch(`${aiUrl}/health`);
      if (res.ok) {
        const data = await res.json();
        setAiStatus({ online: true, loading: false, details: data });
      } else {
        setAiStatus({ online: false, loading: false });
      }
    } catch {
      setAiStatus({ online: false, loading: false });
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main
      style={{
        padding: "40px 20px",
        maxWidth: "1200px",
        margin: "0 auto",
        position: "relative",
        zIndex: 10,
      }}
    >
      {/* Header */}
      <header
        style={{ textAlign: "center", marginBottom: "50px", marginTop: "20px" }}
      >
        <div
          style={{
            display: "inline-block",
            padding: "6px 12px",
            background: "rgba(99, 102, 241, 0.1)",
            border: "1px solid rgba(99, 102, 241, 0.2)",
            borderRadius: "6px",
            fontSize: "0.8rem",
            fontWeight: 600,
            color: "var(--color-primary)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: "16px",
          }}
        >
          Phase 1.1 Installed
        </div>
        <h1
          style={{
            fontSize: "3rem",
            fontWeight: 700,
            background: "linear-gradient(135deg, #ffffff 30%, #a5a6c2 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            marginBottom: "12px",
          }}
        >
          AI Study Assistant
        </h1>
        <p
          style={{
            color: "var(--color-text-secondary)",
            fontSize: "1.1rem",
            maxWidth: "600px",
            margin: "0 auto",
          }}
        >
          Enterprise monorepo project foundation initialized. Live container
          connectivity monitoring dashboard.
        </p>
      </header>

      {/* Grid Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: "30px",
          marginBottom: "50px",
        }}
      >
        {/* NextJS Web App Card */}
        <section
          className="glass-panel"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "20px",
              }}
            >
              <h2 style={{ fontSize: "1.4rem", color: "#fff" }}>apps/web</h2>
              <span className="status-badge online">
                <span className="status-dot online" />
                NextJS 15
              </span>
            </div>
            <p
              style={{
                color: "var(--color-text-secondary)",
                fontSize: "0.95rem",
                lineHeight: 1.6,
                marginBottom: "20px",
              }}
            >
              User Interface built with Next.js 15, TypeScript, and optimized
              production standalone target output.
            </p>
            <div
              style={{
                background: "rgba(0,0,0,0.2)",
                padding: "12px",
                borderRadius: "8px",
                fontSize: "0.85rem",
                fontFamily: "monospace",
                color: "var(--color-text-muted)",
                border: "1px solid rgba(255,255,255,0.02)",
              }}
            >
              Host: http://localhost:3000
              <br />
              Framework: Next.js 15 (App Router)
            </div>
          </div>
          <div
            style={{
              marginTop: "24px",
              paddingTop: "16px",
              borderTop: "1px solid rgba(255,255,255,0.05)",
              fontSize: "0.85rem",
              color: "var(--color-text-secondary)",
            }}
          >
            Status:{" "}
            <span style={{ color: "var(--color-success)", fontWeight: 500 }}>
              Active (This Dashboard)
            </span>
          </div>
        </section>

        {/* NestJS Backend API Card */}
        <section
          className="glass-panel"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "20px",
              }}
            >
              <h2 style={{ fontSize: "1.4rem", color: "#fff" }}>apps/api</h2>
              <span
                className={`status-badge ${apiStatus.online ? "online" : "offline"}`}
              >
                <span
                  className={`status-dot ${apiStatus.online ? "online" : "offline"}`}
                />
                {apiStatus.loading
                  ? "Checking..."
                  : apiStatus.online
                    ? "NestJS API"
                    : "Offline"}
              </span>
            </div>
            <p
              style={{
                color: "var(--color-text-secondary)",
                fontSize: "0.95rem",
                lineHeight: 1.6,
                marginBottom: "20px",
              }}
            >
              NestJS Core backend architecture managing PostgreSQL via Prisma
              ORM, caching using Redis provider.
            </p>
            <div
              style={{
                background: "rgba(0,0,0,0.2)",
                padding: "12px",
                borderRadius: "8px",
                fontSize: "0.85rem",
                fontFamily: "monospace",
                color: "var(--color-text-muted)",
                border: "1px solid rgba(255,255,255,0.02)",
              }}
            >
              Host: {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'}
              <br />
              Prisma Schema: Configured
            </div>
          </div>
          <div
            style={{
              marginTop: "24px",
              paddingTop: "16px",
              borderTop: "1px solid rgba(255,255,255,0.05)",
              fontSize: "0.85rem",
              color: "var(--color-text-secondary)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>
              Database:{" "}
              <strong
                style={{
                  color:
                    apiStatus.details?.details?.database === "UP"
                      ? "var(--color-success)"
                      : "var(--color-error)",
                }}
              >
                {apiStatus.details?.details?.database || "DOWN"}
              </strong>
            </span>
            <span>
              Redis:{" "}
              <strong
                style={{
                  color:
                    apiStatus.details?.details?.redis === "UP"
                      ? "var(--color-success)"
                      : "var(--color-error)",
                }}
              >
                {apiStatus.details?.details?.redis || "DOWN"}
              </strong>
            </span>
          </div>
        </section>

        {/* Python FastAPI AI Service Card */}
        <section
          className="glass-panel"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "20px",
              }}
            >
              <h2 style={{ fontSize: "1.4rem", color: "#fff" }}>
                apps/ai-service
              </h2>
              <span
                className={`status-badge ${aiStatus.online ? "online" : "offline"}`}
              >
                <span
                  className={`status-dot ${aiStatus.online ? "online" : "offline"}`}
                />
                {aiStatus.loading
                  ? "Checking..."
                  : aiStatus.online
                    ? "FastAPI"
                    : "Offline"}
              </span>
            </div>
            <p
              style={{
                color: "var(--color-text-secondary)",
                fontSize: "0.95rem",
                lineHeight: 1.6,
                marginBottom: "20px",
              }}
            >
              Python FastAPI high-performance microservice supporting
              specialized AI orchestration and LLM integrations.
            </p>
            <div
              style={{
                background: "rgba(0,0,0,0.2)",
                padding: "12px",
                borderRadius: "8px",
                fontSize: "0.85rem",
                fontFamily: "monospace",
                color: "var(--color-text-muted)",
                border: "1px solid rgba(255,255,255,0.02)",
              }}
            >
              Host: http://localhost:8000
              <br />
              Framework: FastAPI (Python 3.14)
            </div>
          </div>
          <div
            style={{
              marginTop: "24px",
              paddingTop: "16px",
              borderTop: "1px solid rgba(255,255,255,0.05)",
              fontSize: "0.85rem",
              color: "var(--color-text-secondary)",
            }}
          >
            Redis Ingest:{" "}
            <span
              style={{
                color:
                  aiStatus.details?.redis_connection === "connected"
                    ? "var(--color-success)"
                    : "var(--color-error)",
                fontWeight: 500,
              }}
            >
              {aiStatus.details?.redis_connection === "connected"
                ? "Connected"
                : "Disconnected"}
            </span>
          </div>
        </section>
      </div>

      {/* Monorepo architecture structure & configurations visualizer */}
      <section className="glass-panel" style={{ marginBottom: "30px" }}>
        <h3 style={{ fontSize: "1.2rem", color: "#fff", marginBottom: "16px" }}>
          Monorepo Modules Configuration
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "20px",
          }}
        >
          <div>
            <h4
              style={{
                fontSize: "0.95rem",
                color: "var(--color-secondary)",
                marginBottom: "8px",
              }}
            >
              @study-assistant/shared-types
            </h4>
            <p
              style={{
                color: "var(--color-text-secondary)",
                fontSize: "0.85rem",
                lineHeight: 1.5,
              }}
            >
              Centralized TypeScript declarations matching database schemas.
              Avoids interface drifts across the stack.
            </p>
          </div>
          <div>
            <h4
              style={{
                fontSize: "0.95rem",
                color: "var(--color-secondary)",
                marginBottom: "8px",
              }}
            >
              @study-assistant/shared-config
            </h4>
            <p
              style={{
                color: "var(--color-text-secondary)",
                fontSize: "0.85rem",
                lineHeight: 1.5,
              }}
            >
              Standard configurations for Prettier, typescript
              (`tsconfig.base.json`), and code-quality rules.
            </p>
          </div>
          <div>
            <h4
              style={{
                fontSize: "0.95rem",
                color: "var(--color-secondary)",
                marginBottom: "8px",
              }}
            >
              Docker Orchestration
            </h4>
            <p
              style={{
                color: "var(--color-text-secondary)",
                fontSize: "0.85rem",
                lineHeight: 1.5,
              }}
            >
              Pre-configured Docker Compose environment, isolating PostgreSQL
              database volumes and Redis cache clusters.
            </p>
          </div>
        </div>
      </section>

      {/* Footer Instructions */}
      <footer
        style={{
          textAlign: "center",
          marginTop: "30px",
          color: "var(--color-text-muted)",
          fontSize: "0.8rem",
        }}
      >
        AI Study Assistant Platform Foundation Setup | Developed by Antigravity
      </footer>
    </main>
  );
}

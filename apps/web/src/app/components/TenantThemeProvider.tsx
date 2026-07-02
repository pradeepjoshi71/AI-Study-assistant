"use client";

import React, { useEffect, useState } from "react";

interface TenantConfig {
  appName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  customCss: string;
}

function sanitizeCss(css: string): string {
  if (!css) return "";

  // 1. Strip @import rules
  let sanitized = css.replace(/@import\s+[^;]+;/gi, "");

  // 2. Strip position: fixed;
  sanitized = sanitized.replace(/position\s*:\s*fixed\s*;?/gi, "");

  // 3. Strip or cap z-index > 9999
  sanitized = sanitized.replace(/z-index\s*:\s*(\d+)\s*;?/gi, (match, p1) => {
    const val = parseInt(p1, 10);
    if (val > 9999) {
      return "z-index: 9999;";
    }
    return match;
  });

  return sanitized;
}

export default function TenantThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [config, setConfig] = useState<TenantConfig | null>(null);

  useEffect(() => {
    const fetchConfig = async (attempt = 1) => {
      try {
        // Build base API url by stripping /api/v1 if present
        const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
        const baseApiUrl = rawApiUrl.replace(/\/api\/v1\/?$/, "");

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000); // 4s timeout

        // Use Host header (automatically transmitted by browser fetch)
        const res = await fetch(`${baseApiUrl}/api/public/tenant-config`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          setConfig(data);
        }
      } catch (err: any) {
        if (attempt === 1) {
          // Retry once after 3 seconds (API may still be starting up)
          setTimeout(() => fetchConfig(2), 3000);
        }
        // Silently swallow — the app renders normally with default theme
      }
    };

    fetchConfig();
  }, []);

  useEffect(() => {
    if (!config) return;

    // ── Inject title & favicon ───────────────────────────────────────────────
    if (config.appName) {
      document.title = config.appName;
    }

    if (config.logoUrl) {
      let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = config.logoUrl;
    }
  }, [config]);

  if (!config) {
    return <>{children}</>;
  }

  const sanitizedCss = sanitizeCss(config.customCss);

  return (
    <>
      {/* Inject CSS custom properties on :root */}
      <style id="tenant-theme-variables">{`
        :root {
          --color-primary: ${config.primaryColor};
          --color-primary-glow: rgba(${hexToRgb(config.primaryColor)}, 0.15);
          --color-secondary: ${config.secondaryColor};
          --color-secondary-glow: rgba(${hexToRgb(config.secondaryColor)}, 0.15);
          --font-sans: '${config.fontFamily}', var(--font-sans, 'Plus Jakarta Sans', sans-serif);
        }
        body {
          font-family: var(--font-sans);
        }
      `}</style>

      {/* Inject sanitized custom stylesheets */}
      {sanitizedCss && (
        <style id="tenant-custom-css" dangerouslySetInnerHTML={{ __html: sanitizedCss }} />
      )}

      {children}
    </>
  );
}

// Helper to convert hex colors to rgb for glow channels
function hexToRgb(hex: string): string {
  const sanitized = hex.replace("#", "");
  if (sanitized.length === 3) {
    const r = parseInt(sanitized[0] + sanitized[0], 16);
    const g = parseInt(sanitized[1] + sanitized[1], 16);
    const b = parseInt(sanitized[2] + sanitized[2], 16);
    return `${r}, ${g}, ${b}`;
  } else if (sanitized.length === 6) {
    const r = parseInt(sanitized.substring(0, 2), 16);
    const g = parseInt(sanitized.substring(2, 4), 16);
    const b = parseInt(sanitized.substring(4, 6), 16);
    return `${r}, ${g}, ${b}`;
  }
  return "99, 102, 241"; // fallback indigo
}

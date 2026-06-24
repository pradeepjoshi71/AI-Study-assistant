"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface PlatformMetrics {
  mrr: number;
  arr: number;
  mrrGrowthRate: number;
  totalCustomers: number;
  customersByPlan: Record<string, number>;
  netNewCustomers: number;
  churnedThisMonth: number;
  churnRate: number;
  ndr: number;
  ltv: number;
  cac: number;
  ltvCacRatio: number;
  dau: number;
  mau: number;
  dauMauRatio: number;
  grossMargin: number;
  aiCostPerQuery: number;
  cacheHitRatio: number;
  monthlyInfrastructureCost: number;
  revenueToInfraRatio: number;
  totalAiQueries: number;
  aiQueriesThisMonth: number;
  documentsProcessed: number;
  vectorsStored: number;
  calculatedAt: string;
}

interface CohortData {
  cohortMonth: string;
  newUsers: number;
  retained: { month1: number; month3: number; month6: number; month12: number };
}

// ── Mock data for demo (replace with API calls in production) ──────────────────
const DEMO_METRICS: PlatformMetrics = {
  mrr: 142850,
  arr: 1714200,
  mrrGrowthRate: 23.4,
  totalCustomers: 8420,
  customersByPlan: { free: 5200, pro: 2800, team: 380, enterprise: 40 },
  netNewCustomers: 340,
  churnedThisMonth: 28,
  churnRate: 1.8,
  ndr: 118,
  ltv: 1280,
  cac: 42,
  ltvCacRatio: 30.5,
  dau: 3840,
  mau: 6200,
  dauMauRatio: 61.9,
  grossMargin: 84.2,
  aiCostPerQuery: 0.00021,
  cacheHitRatio: 68.4,
  monthlyInfrastructureCost: 18400,
  revenueToInfraRatio: 7.8,
  totalAiQueries: 4280000,
  aiQueriesThisMonth: 284000,
  documentsProcessed: 182000,
  vectorsStored: 12400000,
  calculatedAt: new Date().toISOString(),
};

const DEMO_COHORTS: CohortData[] = [
  { cohortMonth: "2024-07", newUsers: 120, retained: { month1: 78, month3: 62, month6: 55, month12: 48 } },
  { cohortMonth: "2024-08", newUsers: 165, retained: { month1: 82, month3: 67, month6: 58, month12: 0 } },
  { cohortMonth: "2024-09", newUsers: 210, retained: { month1: 80, month3: 65, month6: 57, month12: 0 } },
  { cohortMonth: "2024-10", newUsers: 290, retained: { month1: 84, month3: 70, month6: 0, month12: 0 } },
  { cohortMonth: "2024-11", newUsers: 380, retained: { month1: 86, month3: 72, month6: 0, month12: 0 } },
  { cohortMonth: "2024-12", newUsers: 520, retained: { month1: 88, month3: 0, month6: 0, month12: 0 } },
  { cohortMonth: "2025-01", newUsers: 640, retained: { month1: 91, month3: 0, month6: 0, month12: 0 } },
];

// ── MRR History for sparkline (12 months) ────────────────────────────────────
const MRR_HISTORY = [
  18200, 24600, 33800, 44200, 58100, 70400,
  82600, 95400, 108200, 118700, 131400, 142850
];

// ── Utility formatters ─────────────────────────────────────────────────────────
const formatUSD = (n: number, compact = false): string => {
  if (compact) {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
};

const formatNumber = (n: number, compact = false): string => {
  if (compact) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  }
  return new Intl.NumberFormat("en-US").format(n);
};

// ── Sparkline Component ────────────────────────────────────────────────────────
function Sparkline({ data, color = "#6366f1" }: { data: number[]; color?: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 120;
  const height = 36;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height * 0.85 - 2;
    return `${x},${y}`;
  });
  const path = `M ${pts.join(" L ")}`;
  const area = `M ${pts[0]} L ${pts.join(" L ")} L ${(data.length - 1) / (data.length - 1) * width},${height} L 0,${height} Z`;

  return (
    <svg width={width} height={height} className="opacity-80">
      <defs>
        <linearGradient id={`sg-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${color.replace("#", "")})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({
  title, value, subtitle, badge, trend, sparklineData, sparklineColor, glow,
}: {
  title: string;
  value: string;
  subtitle?: string;
  badge?: string;
  trend?: { value: string; positive: boolean };
  sparklineData?: number[];
  sparklineColor?: string;
  glow?: string;
}) {
  return (
    <div
      className="kpi-card"
      style={{ "--glow-color": glow ?? "rgba(99,102,241,0.15)" } as React.CSSProperties}
    >
      <div className="kpi-header">
        <span className="kpi-title">{title}</span>
        {badge && <span className="kpi-badge">{badge}</span>}
      </div>
      <div className="kpi-value">{value}</div>
      {subtitle && <div className="kpi-subtitle">{subtitle}</div>}
      <div className="kpi-footer">
        {trend && (
          <span className={`kpi-trend ${trend.positive ? "positive" : "negative"}`}>
            {trend.positive ? "▲" : "▼"} {trend.value}
          </span>
        )}
        {sparklineData && (
          <Sparkline data={sparklineData} color={sparklineColor ?? "#6366f1"} />
        )}
      </div>
    </div>
  );
}

// ── Progress Bar ──────────────────────────────────────────────────────────────
function ProgressBar({ value, max, color, label }: { value: number; max: number; color: string; label?: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="progress-wrap">
      {label && <div className="progress-label">{label}</div>}
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="progress-value">{formatNumber(value)}</div>
    </div>
  );
}

// ── Cohort Heatmap ────────────────────────────────────────────────────────────
function CohortHeatmap({ cohorts }: { cohorts: CohortData[] }) {
  const months = ["M1", "M3", "M6", "M12"];
  const getColor = (val: number) => {
    if (val === 0) return "#1e1e2e";
    if (val >= 85) return "#4ade80";
    if (val >= 70) return "#86efac";
    if (val >= 55) return "#fde68a";
    if (val >= 40) return "#fca5a5";
    return "#f87171";
  };
  const textColor = (val: number) => val > 55 ? "#000" : "#fff";

  return (
    <div className="cohort-table">
      <div className="cohort-header-row">
        <div className="cohort-cell cohort-label">Cohort</div>
        <div className="cohort-cell cohort-label">Users</div>
        {months.map(m => (
          <div key={m} className="cohort-cell cohort-label">{m}</div>
        ))}
      </div>
      {cohorts.map(c => (
        <div key={c.cohortMonth} className="cohort-row">
          <div className="cohort-cell cohort-month">{c.cohortMonth}</div>
          <div className="cohort-cell cohort-count">{formatNumber(c.newUsers)}</div>
          {[c.retained.month1, c.retained.month3, c.retained.month6, c.retained.month12].map((val, i) => (
            <div
              key={i}
              className="cohort-cell cohort-value"
              style={{
                background: getColor(val),
                color: textColor(val),
                opacity: val === 0 ? 0.3 : 1,
              }}
            >
              {val > 0 ? `${val}%` : "—"}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── MRR Growth Chart (SVG) ────────────────────────────────────────────────────
function MRRChart({ data }: { data: number[] }) {
  const max = Math.max(...data);
  const width = 600;
  const height = 180;
  const padL = 60, padR = 20, padT = 20, padB = 30;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const pts = data.map((v, i) => ({
    x: padL + (i / (data.length - 1)) * chartW,
    y: padT + chartH - (v / max) * chartH,
    v,
  }));

  const path = `M ${pts.map(p => `${p.x},${p.y}`).join(" L ")}`;
  const area = `M ${pts[0].x},${padT + chartH} L ${pts.map(p => `${p.x},${p.y}`).join(" L ")} L ${pts[pts.length - 1].x},${padT + chartH} Z`;

  const months = ["Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan"];

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="mrr-chart">
      <defs>
        <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Horizontal grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
        const y = padT + chartH - pct * chartH;
        const val = max * pct;
        return (
          <g key={pct}>
            <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#2d2d4e" strokeWidth="1" strokeDasharray="4 4" />
            <text x={padL - 8} y={y + 4} textAnchor="end" fill="#64748b" fontSize="10">{formatUSD(val, true)}</text>
          </g>
        );
      })}

      {/* Area fill */}
      <path d={area} fill="url(#mrrGrad)" />

      {/* Line */}
      <path d={path} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Data points */}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={4} fill="#6366f1" stroke="#1e1e3a" strokeWidth="2" />
          {i === pts.length - 1 && (
            <text x={p.x + 8} y={p.y + 4} fill="#6366f1" fontSize="11" fontWeight="700">
              {formatUSD(p.v, true)}
            </text>
          )}
        </g>
      ))}

      {/* Month labels */}
      {pts.map((p, i) => (
        <text key={i} x={p.x} y={height - 6} textAnchor="middle" fill="#64748b" fontSize="10">
          {months[i]}
        </text>
      ))}
    </svg>
  );
}

// ── Plan Distribution Donut ────────────────────────────────────────────────────
function PlanDonut({ byPlan }: { byPlan: Record<string, number> }) {
  const total = Object.values(byPlan).reduce((a, b) => a + b, 0);
  const colors: Record<string, string> = {
    free: "#334155",
    pro: "#6366f1",
    team: "#a855f7",
    enterprise: "#f59e0b",
  };
  const labels: Record<string, string> = {
    free: "Free", pro: "Pro", team: "Team", enterprise: "Enterprise",
  };

  const cx = 90, cy = 90, r = 70, inner = 42;
  let angle = -Math.PI / 2;

  const slices = Object.entries(byPlan).map(([plan, count]) => {
    const pct = count / total;
    const start = angle;
    const end = angle + pct * 2 * Math.PI;
    angle = end;
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    const xi1 = cx + inner * Math.cos(start), yi1 = cy + inner * Math.sin(start);
    const xi2 = cx + inner * Math.cos(end), yi2 = cy + inner * Math.sin(end);
    const large = pct > 0.5 ? 1 : 0;
    const d = `M ${xi1} ${yi1} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${inner} ${inner} 0 ${large} 0 ${xi1} ${yi1} Z`;
    return { plan, pct, d, color: colors[plan] };
  });

  return (
    <div className="donut-wrap">
      <svg width="180" height="180" viewBox="0 0 180 180">
        {slices.map(s => (
          <path key={s.plan} d={s.d} fill={s.color} className="donut-slice" />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#e2e8f0" fontSize="14" fontWeight="700">
          {formatNumber(total, true)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#64748b" fontSize="10">
          users
        </text>
      </svg>
      <div className="donut-legend">
        {Object.entries(byPlan).map(([plan, count]) => (
          <div key={plan} className="legend-item">
            <div className="legend-dot" style={{ background: colors[plan] }} />
            <div className="legend-label">{labels[plan]}</div>
            <div className="legend-count">{formatNumber(count)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Investor Dashboard Page ───────────────────────────────────────────────
export default function InvestorDashboard() {
  const [metrics, setMetrics] = useState<PlatformMetrics>(DEMO_METRICS);
  const [cohorts, setCohorts] = useState<CohortData[]>(DEMO_COHORTS);
  const [activeTab, setActiveTab] = useState<"overview" | "revenue" | "engagement" | "economics" | "cohorts">("overview");
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // In production: fetch from /api/platform/metrics/snapshot
      await new Promise(r => setTimeout(r, 800));
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(refresh, 300_000); // auto-refresh every 5 min
    return () => clearInterval(interval);
  }, [refresh]);

  // ── Dynamic forecast ────────────────────────────────────────────────────────
  const forecastARR = Math.round(metrics.mrr * Math.pow(1 + metrics.mrrGrowthRate / 100, 12) * 12);

  return (
    <>
      <style>{`
        :root {
          --bg: #0d0d1a;
          --surface: #13131f;
          --surface2: #1a1a2e;
          --border: #2d2d4e;
          --text: #e2e8f0;
          --muted: #64748b;
          --indigo: #6366f1;
          --purple: #a855f7;
          --emerald: #10b981;
          --amber: #f59e0b;
          --red: #ef4444;
          --pink: #ec4899;
        }

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: var(--bg);
          color: var(--text);
          font-family: 'Inter', 'SF Pro Display', system-ui, sans-serif;
          min-height: 100vh;
        }

        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

        .dashboard {
          max-width: 1440px;
          margin: 0 auto;
          padding: 0 24px 48px;
        }

        /* ── Header ───────────────────────────────────────────────────── */
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 28px 0 24px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 32px;
          gap: 16px;
        }

        .header-brand {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .brand-icon {
          width: 44px; height: 44px;
          background: linear-gradient(135deg, #6366f1, #a855f7);
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          font-size: 20px;
          box-shadow: 0 0 24px rgba(99,102,241,0.4);
        }

        .brand-title {
          font-size: 1.4rem; font-weight: 800; letter-spacing: -0.5px;
          background: linear-gradient(90deg, #e2e8f0, #a5b4fc);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }

        .brand-subtitle { font-size: 0.75rem; color: var(--muted); margin-top: 2px; }

        .header-right { display: flex; align-items: center; gap: 12px; }

        .header-badge {
          padding: 4px 12px;
          background: rgba(16,185,129,0.1);
          border: 1px solid rgba(16,185,129,0.3);
          border-radius: 20px;
          font-size: 0.72rem; font-weight: 600;
          color: var(--emerald);
          display: flex; align-items: center; gap: 6px;
        }

        .status-dot {
          width: 6px; height: 6px;
          background: var(--emerald);
          border-radius: 50%;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }

        .refresh-btn {
          padding: 8px 16px;
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--muted);
          font-size: 0.8rem; cursor: pointer;
          transition: all 0.2s;
          display: flex; align-items: center; gap: 6px;
        }

        .refresh-btn:hover { border-color: var(--indigo); color: var(--text); }

        .last-updated { font-size: 0.72rem; color: var(--muted); }

        /* ── Top metric strip ─────────────────────────────────────────── */
        .top-strip {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 12px;
        }

        .strip-card {
          background: linear-gradient(135deg, var(--surface), var(--surface2));
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 18px 20px;
          position: relative;
          overflow: hidden;
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .strip-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 40px rgba(0,0,0,0.3);
        }

        .strip-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 2px;
          background: var(--accent-color, linear-gradient(90deg, #6366f1, #a855f7));
        }

        .strip-label {
          font-size: 0.72rem; text-transform: uppercase; letter-spacing: 1px;
          color: var(--muted); margin-bottom: 8px;
        }

        .strip-value {
          font-size: 1.85rem; font-weight: 800; letter-spacing: -1px;
          color: var(--text); line-height: 1;
          background: var(--value-gradient, none);
          -webkit-background-clip: var(--value-clip, initial);
          -webkit-text-fill-color: var(--value-fill, initial);
        }

        .strip-meta {
          display: flex; align-items: center; gap: 8px;
          margin-top: 8px;
        }

        .strip-badge {
          font-size: 0.72rem; font-weight: 600;
          padding: 2px 8px; border-radius: 6px;
        }

        .strip-badge.up { background: rgba(16,185,129,0.15); color: var(--emerald); }
        .strip-badge.down { background: rgba(239,68,68,0.1); color: var(--red); }

        .strip-note { font-size: 0.72rem; color: var(--muted); }

        /* ── Tab nav ──────────────────────────────────────────────────── */
        .tab-nav {
          display: flex; gap: 4px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 4px;
          width: fit-content;
          margin-bottom: 28px;
        }

        .tab-btn {
          padding: 8px 18px;
          border-radius: 8px;
          border: none; cursor: pointer;
          font-size: 0.82rem; font-weight: 500;
          color: var(--muted);
          background: transparent;
          transition: all 0.2s;
        }

        .tab-btn:hover { color: var(--text); }

        .tab-btn.active {
          background: linear-gradient(135deg, #6366f1, #a855f7);
          color: white;
          font-weight: 600;
          box-shadow: 0 4px 16px rgba(99,102,241,0.35);
        }

        /* ── Section header ───────────────────────────────────────────── */
        .section-header {
          display: flex; align-items: center; gap: 12px;
          margin-bottom: 20px;
        }

        .section-title {
          font-size: 1rem; font-weight: 700; color: var(--text);
        }

        .section-sub {
          font-size: 0.78rem; color: var(--muted);
        }

        /* ── KPI Cards ────────────────────────────────────────────────── */
        .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
        .kpi-grid-4 { grid-template-columns: repeat(4, 1fr); }

        .kpi-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 20px;
          transition: transform 0.2s, box-shadow 0.2s;
          position: relative;
          overflow: hidden;
        }

        .kpi-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 32px var(--glow-color);
          border-color: rgba(99,102,241,0.3);
        }

        .kpi-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .kpi-title { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.8px; font-weight: 500; }
        .kpi-badge {
          font-size: 0.68rem; padding: 2px 8px; border-radius: 6px;
          background: rgba(99,102,241,0.15); color: #a5b4fc; font-weight: 600;
        }
        .kpi-value { font-size: 1.6rem; font-weight: 800; color: var(--text); letter-spacing: -0.5px; }
        .kpi-subtitle { font-size: 0.75rem; color: var(--muted); margin-top: 4px; }
        .kpi-footer {
          display: flex; align-items: center; justify-content: space-between;
          margin-top: 12px;
        }
        .kpi-trend { font-size: 0.78rem; font-weight: 600; }
        .kpi-trend.positive { color: var(--emerald); }
        .kpi-trend.negative { color: var(--red); }

        /* ── Charts area ──────────────────────────────────────────────── */
        .chart-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 24px; }

        .chart-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 24px;
        }

        .chart-title { font-size: 0.9rem; font-weight: 600; color: var(--text); margin-bottom: 4px; }
        .chart-subtitle { font-size: 0.75rem; color: var(--muted); margin-bottom: 20px; }

        .mrr-chart { display: block; width: 100%; }

        /* ── Donut ────────────────────────────────────────────────────── */
        .donut-wrap { display: flex; flex-direction: column; align-items: center; gap: 12px; }
        .donut-slice { transition: opacity 0.2s; }
        .donut-slice:hover { opacity: 0.85; }
        .donut-legend { width: 100%; display: flex; flex-direction: column; gap: 8px; }
        .legend-item { display: flex; align-items: center; gap: 8px; }
        .legend-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
        .legend-label { font-size: 0.8rem; color: var(--muted); flex: 1; }
        .legend-count { font-size: 0.8rem; font-weight: 600; color: var(--text); }

        /* ── Progress bars ────────────────────────────────────────────── */
        .progress-wrap { margin-bottom: 12px; }
        .progress-label { font-size: 0.75rem; color: var(--muted); margin-bottom: 6px; }
        .progress-track {
          height: 6px; background: var(--surface2); border-radius: 3px; overflow: hidden;
        }
        .progress-fill { height: 100%; border-radius: 3px; transition: width 0.8s ease; }
        .progress-value { font-size: 0.72rem; color: var(--muted); margin-top: 4px; text-align: right; }

        /* ── Cohort heatmap ───────────────────────────────────────────── */
        .cohort-table { border-radius: 12px; overflow: hidden; border: 1px solid var(--border); }
        .cohort-header-row, .cohort-row {
          display: grid;
          grid-template-columns: 100px 70px repeat(4, 1fr);
          gap: 1px;
          background: var(--border);
        }
        .cohort-header-row { background: var(--surface2); }
        .cohort-cell {
          padding: 10px 8px; text-align: center; font-size: 0.78rem;
          background: var(--surface);
        }
        .cohort-label { font-weight: 600; color: var(--muted); background: var(--surface2); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px; }
        .cohort-month { font-weight: 500; color: var(--text); font-size: 0.75rem; text-align: left; padding-left: 12px; }
        .cohort-count { color: var(--muted); font-weight: 600; }
        .cohort-value { font-weight: 700; transition: background 0.3s; border-radius: 0; }

        /* ── Stats row ────────────────────────────────────────────────── */
        .stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }

        .stat-block {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 24px;
        }

        .stat-block-title { font-size: 0.85rem; font-weight: 600; color: var(--text); margin-bottom: 16px; }

        /* ── Health meters ────────────────────────────────────────────── */
        .health-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
        .health-item {
          background: var(--surface2); border-radius: 10px; padding: 14px;
          display: flex; align-items: center; gap: 12px;
        }
        .health-icon {
          width: 36px; height: 36px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; flex-shrink: 0;
        }
        .health-info {}
        .health-label { font-size: 0.72rem; color: var(--muted); }
        .health-value { font-size: 0.9rem; font-weight: 700; color: var(--text); }

        /* ── Global scale table ───────────────────────────────────────── */
        .scale-table { width: 100%; border-collapse: collapse; }
        .scale-table th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.8px; color: var(--muted); padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); }
        .scale-table td { font-size: 0.82rem; padding: 10px 12px; border-bottom: 1px solid rgba(45,45,78,0.5); color: var(--text); }
        .scale-table tr:last-child td { border-bottom: none; }
        .scale-table tr:hover td { background: var(--surface2); }
        .scale-active td:first-child { position: relative; }
        .scale-active td:first-child::before {
          content: '▶';
          color: var(--emerald);
          margin-right: 6px;
          font-size: 8px;
        }
        .tag {
          display: inline-block; padding: 2px 8px; border-radius: 6px;
          font-size: 0.68rem; font-weight: 600;
        }
        .tag-green { background: rgba(16,185,129,0.15); color: var(--emerald); }
        .tag-amber { background: rgba(245,158,11,0.15); color: var(--amber); }
        .tag-blue { background: rgba(99,102,241,0.15); color: #a5b4fc; }

        /* ── IPO readiness ────────────────────────────────────────────── */
        .ipo-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
        .ipo-card {
          background: var(--surface2); border-radius: 12px; padding: 16px;
          border: 1px solid var(--border);
        }
        .ipo-metric { font-size: 0.72rem; color: var(--muted); margin-bottom: 4px; }
        .ipo-value { font-size: 1.1rem; font-weight: 700; }
        .ipo-target { font-size: 0.7rem; color: var(--muted); margin-top: 4px; }
        .green { color: var(--emerald); }
        .amber { color: var(--amber); }
        .red { color: var(--red); }

        /* ── Footer ───────────────────────────────────────────────────── */
        .footer {
          margin-top: 40px;
          padding-top: 24px;
          border-top: 1px solid var(--border);
          display: flex; justify-content: space-between; align-items: center;
          font-size: 0.72rem; color: var(--muted);
        }

        @media (max-width: 1200px) {
          .top-strip { grid-template-columns: repeat(2, 1fr); }
          .kpi-grid { grid-template-columns: repeat(2, 1fr); }
          .kpi-grid-4 { grid-template-columns: repeat(2, 1fr); }
          .chart-grid { grid-template-columns: 1fr; }
          .stats-row { grid-template-columns: 1fr; }
        }

        @media (max-width: 768px) {
          .top-strip { grid-template-columns: 1fr; }
          .header { flex-direction: column; align-items: flex-start; }
          .health-grid { grid-template-columns: 1fr; }
          .ipo-grid { grid-template-columns: 1fr; }
          .cohort-header-row, .cohort-row { grid-template-columns: 80px 60px repeat(4, 1fr); }
        }
      `}</style>

      <div className="dashboard">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="header">
          <div className="header-brand">
            <div className="brand-icon">⚡</div>
            <div>
              <div className="brand-title">AI Study Platform</div>
              <div className="brand-subtitle">Investor Metrics Dashboard · Phase 4.0 · IPO-Grade Analytics</div>
            </div>
          </div>
          <div className="header-right">
            <div className="header-badge">
              <div className="status-dot" />
              Live · 3 Regions Active
            </div>
            <button className="refresh-btn" onClick={refresh} disabled={loading}>
              {loading ? "⟳ Refreshing..." : "⟳ Refresh"}
            </button>
            <div className="last-updated">Updated {lastUpdated.toLocaleTimeString()}</div>
          </div>
        </header>

        {/* ── Top KPI Strip ───────────────────────────────────────────── */}
        <div className="top-strip">
          <div className="strip-card" style={{ "--accent-color": "linear-gradient(90deg, #6366f1, #a855f7)" } as React.CSSProperties}>
            <div className="strip-label">Annual Recurring Revenue</div>
            <div className="strip-value" style={{ "--value-gradient": "linear-gradient(90deg, #a5b4fc, #e879f9)", "--value-clip": "text", "--value-fill": "transparent" } as React.CSSProperties}>
              {formatUSD(metrics.arr, true)}
            </div>
            <div className="strip-meta">
              <span className="strip-badge up">▲ {metrics.mrrGrowthRate}% MoM</span>
              <span className="strip-note">→ {formatUSD(forecastARR, true)} forecast</span>
            </div>
          </div>

          <div className="strip-card" style={{ "--accent-color": "linear-gradient(90deg, #10b981, #34d399)" } as React.CSSProperties}>
            <div className="strip-label">Net Dollar Retention</div>
            <div className="strip-value" style={{ color: "#10b981" }}>{metrics.ndr}%</div>
            <div className="strip-meta">
              <span className="strip-badge up">▲ World-class NDR</span>
              <span className="strip-note">Target: 120%+</span>
            </div>
          </div>

          <div className="strip-card" style={{ "--accent-color": "linear-gradient(90deg, #f59e0b, #fbbf24)" } as React.CSSProperties}>
            <div className="strip-label">Gross Margin</div>
            <div className="strip-value" style={{ color: "#f59e0b" }}>{metrics.grossMargin}%</div>
            <div className="strip-meta">
              <span className="strip-badge up">SaaS Benchmark: 80%+</span>
              <span className="strip-note">AI cost optimized</span>
            </div>
          </div>

          <div className="strip-card" style={{ "--accent-color": "linear-gradient(90deg, #ec4899, #f43f5e)" } as React.CSSProperties}>
            <div className="strip-label">LTV : CAC Ratio</div>
            <div className="strip-value" style={{ color: "#ec4899" }}>{metrics.ltvCacRatio.toFixed(1)}x</div>
            <div className="strip-meta">
              <span className="strip-badge up">▲ Exceptional &gt;3x</span>
              <span className="strip-note">LTV {formatUSD(metrics.ltv)} · CAC {formatUSD(metrics.cac)}</span>
            </div>
          </div>
        </div>

        {/* ── Tab Navigation ──────────────────────────────────────────── */}
        <div className="tab-nav" style={{ marginTop: 28 }}>
          {(["overview", "revenue", "engagement", "economics", "cohorts"] as const).map(t => (
            <button
              key={t}
              className={`tab-btn ${activeTab === t ? "active" : ""}`}
              onClick={() => setActiveTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* ══════════════ OVERVIEW TAB ══════════════════════════════════ */}
        {activeTab === "overview" && (
          <>
            {/* MRR chart + Plan donut */}
            <div className="chart-grid">
              <div className="chart-card">
                <div className="chart-title">Monthly Recurring Revenue (12-Month Trend)</div>
                <div className="chart-subtitle">
                  MRR {formatUSD(metrics.mrr)} · Growing {metrics.mrrGrowthRate}% month-over-month
                </div>
                <MRRChart data={MRR_HISTORY} />
              </div>
              <div className="chart-card">
                <div className="chart-title">Customer Distribution by Plan</div>
                <div className="chart-subtitle">
                  {formatNumber(metrics.totalCustomers)} total users
                </div>
                <PlanDonut byPlan={metrics.customersByPlan} />
              </div>
            </div>

            {/* Core KPIs */}
            <div className="kpi-grid">
              <KpiCard
                title="Monthly Recurring Revenue"
                value={formatUSD(metrics.mrr)}
                subtitle={`ARR: ${formatUSD(metrics.arr)}`}
                trend={{ value: `${metrics.mrrGrowthRate}% MoM`, positive: true }}
                sparklineData={MRR_HISTORY}
                sparklineColor="#6366f1"
                glow="rgba(99,102,241,0.2)"
              />
              <KpiCard
                title="Total Paying Customers"
                value={formatNumber(metrics.customersByPlan.pro + metrics.customersByPlan.team + metrics.customersByPlan.enterprise)}
                subtitle={`+${metrics.netNewCustomers} net new this month`}
                trend={{ value: `${metrics.churnRate}% monthly churn`, positive: false }}
                glow="rgba(168,85,247,0.15)"
              />
              <KpiCard
                title="Forecasted ARR (12-month)"
                value={formatUSD(forecastARR, true)}
                subtitle={`At ${metrics.mrrGrowthRate}% sustained growth`}
                badge="Projection"
                glow="rgba(245,158,11,0.15)"
              />
            </div>

            {/* Infrastructure scale status */}
            <div className="stat-block" style={{ marginBottom: 24 }}>
              <div className="stat-block-title">🌍 Global Infrastructure Scale</div>
              <table className="scale-table">
                <thead>
                  <tr>
                    <th>Region</th>
                    <th>Status</th>
                    <th>Latency p50</th>
                    <th>EKS Pods</th>
                    <th>DB Tier</th>
                    <th>Redis</th>
                    <th>Capacity</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="scale-active">
                    <td>🇺🇸 us-east-1 (Primary)</td>
                    <td><span className="tag tag-green">● Active</span></td>
                    <td>18ms</td>
                    <td>32 / 200</td>
                    <td>Aurora Serverless v2 (Writer)</td>
                    <td>3-node Cluster</td>
                    <td><span className="tag tag-green">~400k users</span></td>
                  </tr>
                  <tr className="scale-active">
                    <td>🇮🇪 eu-west-1 (Secondary)</td>
                    <td><span className="tag tag-green">● Active</span></td>
                    <td>22ms</td>
                    <td>18 / 200</td>
                    <td>Aurora Global (Reader)</td>
                    <td>3-node Cluster</td>
                    <td><span className="tag tag-green">~350k users</span></td>
                  </tr>
                  <tr className="scale-active">
                    <td>🇮🇳 ap-south-1 (Asia-Pacific)</td>
                    <td><span className="tag tag-green">● Active</span></td>
                    <td>28ms</td>
                    <td>14 / 200</td>
                    <td>Aurora Global (Reader)</td>
                    <td>3-node Cluster</td>
                    <td><span className="tag tag-green">~300k users</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ══════════════ REVENUE TAB ══════════════════════════════════ */}
        {activeTab === "revenue" && (
          <>
            <div className="kpi-grid kpi-grid-4">
              <KpiCard title="MRR" value={formatUSD(metrics.mrr)} trend={{ value: `${metrics.mrrGrowthRate}% MoM`, positive: true }} sparklineData={MRR_HISTORY} />
              <KpiCard title="ARR" value={formatUSD(metrics.arr, true)} badge="Current" />
              <KpiCard title="Forecasted ARR" value={formatUSD(forecastARR, true)} badge="12mo" />
              <KpiCard title="NDR" value={`${metrics.ndr}%`} subtitle="Net Dollar Retention" badge="World-class" />
            </div>

            <div className="stats-row">
              <div className="stat-block">
                <div className="stat-block-title">💰 Revenue by Plan</div>
                {Object.entries(metrics.customersByPlan)
                  .filter(([p]) => p !== "free")
                  .map(([plan, count]) => {
                    const prices: Record<string, number> = { pro: 19, team: 99, enterprise: 999 };
                    const rev = count * (prices[plan] ?? 0);
                    return (
                      <ProgressBar
                        key={plan}
                        label={`${plan.charAt(0).toUpperCase() + plan.slice(1)} (${formatNumber(count)} customers)`}
                        value={rev}
                        max={metrics.mrr}
                        color={plan === "enterprise" ? "#f59e0b" : plan === "team" ? "#a855f7" : "#6366f1"}
                      />
                    );
                  })
                }
              </div>

              <div className="stat-block">
                <div className="stat-block-title">📈 Growth Metrics</div>
                <div className="health-grid">
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(16,185,129,0.1)" }}>📊</div>
                    <div className="health-info">
                      <div className="health-label">MoM Growth</div>
                      <div className="health-value green">{metrics.mrrGrowthRate}%</div>
                    </div>
                  </div>
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(99,102,241,0.1)" }}>🎯</div>
                    <div className="health-info">
                      <div className="health-label">Net New MRR</div>
                      <div className="health-value">{formatUSD(metrics.netNewCustomers * 19)}</div>
                    </div>
                  </div>
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(239,68,68,0.1)" }}>↩</div>
                    <div className="health-info">
                      <div className="health-label">Churned MRR</div>
                      <div className="health-value red">{formatUSD(metrics.churnedThisMonth * 19)}</div>
                    </div>
                  </div>
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(245,158,11,0.1)" }}>🏆</div>
                    <div className="health-info">
                      <div className="health-label">Churn Rate</div>
                      <div className="health-value amber">{metrics.churnRate}%</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="stat-block">
                <div className="stat-block-title">🏁 IPO Readiness Scorecard</div>
                <div className="ipo-grid">
                  <div className="ipo-card">
                    <div className="ipo-metric">ARR Threshold</div>
                    <div className={`ipo-value ${metrics.arr > 1_000_000 ? "green" : "amber"}`}>
                      {metrics.arr > 1_000_000 ? "✓ Above $1M" : "⚠ Below $1M"}
                    </div>
                    <div className="ipo-target">Series A: $1M+ ARR</div>
                  </div>
                  <div className="ipo-card">
                    <div className="ipo-metric">NDR Health</div>
                    <div className={`ipo-value ${metrics.ndr >= 120 ? "green" : metrics.ndr >= 100 ? "amber" : "red"}`}>
                      {metrics.ndr}% NDR
                    </div>
                    <div className="ipo-target">IPO standard: 120%+</div>
                  </div>
                  <div className="ipo-card">
                    <div className="ipo-metric">Gross Margin</div>
                    <div className={`ipo-value ${metrics.grossMargin >= 80 ? "green" : "amber"}`}>
                      {metrics.grossMargin}%
                    </div>
                    <div className="ipo-target">SaaS target: 75%+</div>
                  </div>
                  <div className="ipo-card">
                    <div className="ipo-metric">Growth Rate</div>
                    <div className={`ipo-value ${metrics.mrrGrowthRate >= 20 ? "green" : "amber"}`}>
                      {metrics.mrrGrowthRate}% MoM
                    </div>
                    <div className="ipo-target">T2D3 path: 20%+ MoM</div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ══════════════ ENGAGEMENT TAB ════════════════════════════════ */}
        {activeTab === "engagement" && (
          <>
            <div className="kpi-grid kpi-grid-4">
              <KpiCard title="Daily Active Users" value={formatNumber(metrics.dau)} subtitle={`${metrics.dauMauRatio}% of MAU`} />
              <KpiCard title="Monthly Active Users" value={formatNumber(metrics.mau)} />
              <KpiCard title="AI Queries (This Month)" value={formatNumber(metrics.aiQueriesThisMonth, true)} />
              <KpiCard title="All-Time AI Queries" value={formatNumber(metrics.totalAiQueries, true)} badge="Milestone" />
            </div>

            <div className="stats-row">
              <div className="stat-block">
                <div className="stat-block-title">📚 Content Scale</div>
                <ProgressBar label="Documents Processed" value={metrics.documentsProcessed} max={200_000} color="#6366f1" />
                <ProgressBar label="Vectors Stored" value={metrics.vectorsStored} max={15_000_000} color="#a855f7" />
                <ProgressBar label="AI Queries (This Month)" value={metrics.aiQueriesThisMonth} max={500_000} color="#10b981" />
              </div>

              <div className="stat-block">
                <div className="stat-block-title">🔥 Engagement Health</div>
                <div className="health-grid">
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(99,102,241,0.1)" }}>👤</div>
                    <div className="health-info">
                      <div className="health-label">DAU/MAU (Stickiness)</div>
                      <div className="health-value">{metrics.dauMauRatio}%</div>
                    </div>
                  </div>
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(16,185,129,0.1)" }}>⚡</div>
                    <div className="health-info">
                      <div className="health-label">Cache Hit Ratio</div>
                      <div className="health-value green">{metrics.cacheHitRatio}%</div>
                    </div>
                  </div>
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(245,158,11,0.1)" }}>🤖</div>
                    <div className="health-info">
                      <div className="health-label">AI Cost / Query</div>
                      <div className="health-value">${metrics.aiCostPerQuery.toFixed(5)}</div>
                    </div>
                  </div>
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(168,85,247,0.1)" }}>🌐</div>
                    <div className="health-info">
                      <div className="health-label">Active Regions</div>
                      <div className="health-value">3 / 3</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="stat-block">
                <div className="stat-block-title">🏗️ System Reliability</div>
                <div className="health-grid">
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(16,185,129,0.1)" }}>✅</div>
                    <div className="health-info">
                      <div className="health-label">API Uptime</div>
                      <div className="health-value green">99.99%</div>
                    </div>
                  </div>
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(99,102,241,0.1)" }}>⏱</div>
                    <div className="health-info">
                      <div className="health-label">p99 Latency</div>
                      <div className="health-value">187ms</div>
                    </div>
                  </div>
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(16,185,129,0.1)" }}>🛡</div>
                    <div className="health-info">
                      <div className="health-label">RTO / RPO</div>
                      <div className="health-value green">&lt;5m / &lt;1m</div>
                    </div>
                  </div>
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(245,158,11,0.1)" }}>🔀</div>
                    <div className="health-info">
                      <div className="health-label">Error Rate</div>
                      <div className="health-value amber">0.008%</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ══════════════ UNIT ECONOMICS TAB ════════════════════════════ */}
        {activeTab === "economics" && (
          <>
            <div className="kpi-grid kpi-grid-4">
              <KpiCard title="Gross Margin" value={`${metrics.grossMargin}%`} badge="SaaS-grade" trend={{ value: "Above 80% target", positive: true }} />
              <KpiCard title="LTV" value={formatUSD(metrics.ltv)} subtitle="Customer lifetime value" />
              <KpiCard title="CAC" value={formatUSD(metrics.cac)} subtitle="Cost to acquire 1 customer" />
              <KpiCard title="LTV:CAC" value={`${metrics.ltvCacRatio.toFixed(1)}x`} badge="Exceptional" trend={{ value: "Target: >3x", positive: true }} />
            </div>

            <div className="stats-row">
              <div className="stat-block">
                <div className="stat-block-title">🤖 AI Cost Efficiency</div>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: 8 }}>Cost per AI query breakdown:</div>
                  <ProgressBar label="LLM Token Cost" value={60} max={100} color="#6366f1" />
                  <ProgressBar label="Embedding Cost" value={15} max={100} color="#a855f7" />
                  <ProgressBar label="Vector Search" value={10} max={100} color="#10b981" />
                  <ProgressBar label="Infrastructure" value={15} max={100} color="#f59e0b" />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px", background: "var(--surface2)", borderRadius: "8px" }}>
                  <div>
                    <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Blended cost/query</div>
                    <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--emerald)" }}>${metrics.aiCostPerQuery.toFixed(5)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Cache saves (68% hit)</div>
                    <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#a5b4fc" }}>~$3.2K/mo</div>
                  </div>
                </div>
              </div>

              <div className="stat-block">
                <div className="stat-block-title">💸 Infrastructure Economics</div>
                <div className="health-grid">
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(99,102,241,0.1)" }}>☁</div>
                    <div className="health-info">
                      <div className="health-label">Monthly Infra Cost</div>
                      <div className="health-value">{formatUSD(metrics.monthlyInfrastructureCost)}</div>
                    </div>
                  </div>
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(16,185,129,0.1)" }}>📐</div>
                    <div className="health-info">
                      <div className="health-label">Revenue/Infra Ratio</div>
                      <div className="health-value green">{metrics.revenueToInfraRatio}x</div>
                    </div>
                  </div>
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(245,158,11,0.1)" }}>👥</div>
                    <div className="health-info">
                      <div className="health-label">ARR / Employee</div>
                      <div className="health-value">{formatUSD(metrics.arr / 15, true)}</div>
                    </div>
                  </div>
                  <div className="health-item">
                    <div className="health-icon" style={{ background: "rgba(168,85,247,0.1)" }}>🔁</div>
                    <div className="health-info">
                      <div className="health-label">Payback Period</div>
                      <div className="health-value green">2.7 months</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="stat-block">
                <div className="stat-block-title">🎯 Target vs Actuals</div>
                <table style={{ width: "100%", fontSize: "0.8rem" }}>
                  <thead>
                    <tr style={{ color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                      <th style={{ textAlign: "left", paddingBottom: 8 }}>Metric</th>
                      <th style={{ textAlign: "right", paddingBottom: 8 }}>Actual</th>
                      <th style={{ textAlign: "right", paddingBottom: 8 }}>Target</th>
                      <th style={{ textAlign: "right", paddingBottom: 8 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { m: "Gross Margin", a: `${metrics.grossMargin}%`, t: "80%+", ok: metrics.grossMargin >= 80 },
                      { m: "Churn Rate", a: `${metrics.churnRate}%`, t: "<2%", ok: metrics.churnRate < 2 },
                      { m: "NDR", a: `${metrics.ndr}%`, t: "120%+", ok: metrics.ndr >= 120 },
                      { m: "LTV:CAC", a: `${metrics.ltvCacRatio.toFixed(1)}x`, t: ">3x", ok: metrics.ltvCacRatio >= 3 },
                      { m: "MoM Growth", a: `${metrics.mrrGrowthRate}%`, t: "20%+", ok: metrics.mrrGrowthRate >= 20 },
                      { m: "DAU/MAU", a: `${metrics.dauMauRatio}%`, t: "40%+", ok: metrics.dauMauRatio >= 40 },
                    ].map(row => (
                      <tr key={row.m} style={{ borderBottom: "1px solid rgba(45,45,78,0.3)" }}>
                        <td style={{ padding: "8px 0", color: "var(--text)" }}>{row.m}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: row.ok ? "var(--emerald)" : "var(--amber)" }}>{row.a}</td>
                        <td style={{ textAlign: "right", color: "var(--muted)" }}>{row.t}</td>
                        <td style={{ textAlign: "right" }}>{row.ok ? "✅" : "⚠️"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ══════════════ COHORTS TAB ════════════════════════════════════ */}
        {activeTab === "cohorts" && (
          <>
            <div className="chart-card" style={{ marginBottom: 24 }}>
              <div className="chart-title">Cohort Retention Heatmap</div>
              <div className="chart-subtitle" style={{ marginBottom: 20 }}>
                Month-over-month retention rates by signup cohort. Green = healthy retention. Color scale: 85%+ excellent, 70%+ good, 55%+ fair, below = at-risk.
              </div>
              <CohortHeatmap cohorts={cohorts} />
            </div>

            <div className="kpi-grid">
              <KpiCard
                title="Best Cohort Retention (M3)"
                value="72%"
                subtitle="Jan 2025 cohort — highest M3 retention to date"
                badge="Improving"
                trend={{ value: "+10pp YoY trend", positive: true }}
              />
              <KpiCard
                title="Average M6 Retention"
                value="57%"
                subtitle="Across all cohorts with 6+ months data"
                badge="Benchmark"
              />
              <KpiCard
                title="Expansion MRR (3-month)"
                value="12%"
                subtitle="Users upgrading plan within 3 months"
                trend={{ value: "Driven by team features", positive: true }}
              />
            </div>
          </>
        )}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer className="footer">
          <div>AI Study Platform · Phase 4.0 Global Ecosystem · Investor Dashboard</div>
          <div style={{ display: "flex", gap: 24 }}>
            <span>3 Active Regions: us-east-1 · eu-west-1 · ap-south-1</span>
            <span>Data refreshes every 5 minutes</span>
            <span>Confidential — for authorized investors only</span>
          </div>
        </footer>
      </div>
    </>
  );
}

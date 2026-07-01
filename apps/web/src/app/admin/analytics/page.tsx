'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line,
  AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

// ── API helpers ───────────────────────────────────────────────────────────────
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

async function fetchMetric(
  metric: string,
  period: string,
  days: number,
  tenantId?: string,
  token?: string,
) {
  const params = new URLSearchParams({ metric, period, days: String(days) });
  if (tenantId) params.set('tenantId', tenantId);
  const res = await fetch(`${API}/admin/analytics/metrics?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchTenants(token?: string) {
  const res = await fetch(`${API}/admin/analytics/tenants`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const body = await res.json();
  return body.tenants ?? [];
}

// ── Color palette ────────────────────────────────────────────────────────────
const C = {
  indigo: '#6366f1',
  violet: '#8b5cf6',
  teal: '#06b6d4',
  emerald: '#10b981',
  rose: '#f43f5e',
  amber: '#f59e0b',
  bg: '#0a0a0c',
  card: '#121216',
  border: 'rgba(255,255,255,0.06)',
  text: '#f4f4f7',
  muted: '#6b7280',
};

// ── Sub-components ────────────────────────────────────────────────────────────

/** Card wrapper */
function Card({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '16px',
      padding: '24px',
      ...style,
    }}>
      {children}
    </div>
  );
}

/** Section title */
function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: C.text }}>{title}</h2>
      {subtitle && <p style={{ margin: '4px 0 0', fontSize: '12px', color: C.muted }}>{subtitle}</p>}
    </div>
  );
}

// Custom Tooltip
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#1e1e2a',
      border: `1px solid ${C.indigo}44`,
      borderRadius: '8px',
      padding: '10px 14px',
      fontSize: '12px',
      color: C.text,
    }}>
      <p style={{ margin: '0 0 6px', color: C.muted }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ margin: '2px 0', color: p.color ?? C.indigo }}>
          {p.name}: <strong>{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</strong>
        </p>
      ))}
    </div>
  );
}

// Heatmap cell colour for retention (0–100%)
function retentionColor(value: number) {
  if (value >= 70) return '#10b981';
  if (value >= 40) return '#f59e0b';
  if (value >= 10) return '#f43f5e44';
  return '#ffffff11';
}

// ── Funnel Chart ──────────────────────────────────────────────────────────────
function FunnelChart({ data }: { data: { step: string; label: string; count: number }[] }) {
  const max = data[0]?.count || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {data.map((step, i) => {
        const pct = Math.round((step.count / max) * 100);
        const dropOff = i > 0 ? Math.round(((data[i - 1].count - step.count) / data[i - 1].count) * 100) : 0;
        return (
          <div key={step.step}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '12px' }}>
              <span style={{ color: C.text }}>{step.label}</span>
              <span style={{ color: C.muted }}>
                {step.count.toLocaleString()} users
                {i > 0 && <span style={{ color: C.rose, marginLeft: '8px' }}>−{dropOff}%</span>}
              </span>
            </div>
            <div style={{ background: '#ffffff0a', borderRadius: '4px', height: '28px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${C.indigo}, ${C.violet})`,
                  borderRadius: '4px',
                  transition: 'width 0.6s ease',
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: '8px',
                }}
              >
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#fff' }}>{pct}%</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Retention Heatmap ─────────────────────────────────────────────────────────
interface CohortRow {
  cohort: string;
  d1: number;
  d7: number;
  d30: number;
}

function RetentionHeatmap({ rows }: { rows: CohortRow[] }) {
  const cols = ['D1', 'D7', 'D30'];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px 12px', color: C.muted, fontWeight: 500 }}>Cohort Week</th>
            {cols.map(c => (
              <th key={c} style={{ textAlign: 'center', padding: '6px 12px', color: C.muted, fontWeight: 500 }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.cohort}>
              <td style={{ padding: '6px 12px', color: C.muted }}>{row.cohort}</td>
              {[row.d1, row.d7, row.d30].map((val, i) => (
                <td key={i} style={{ textAlign: 'center', padding: '6px 8px' }}>
                  <div style={{
                    background: retentionColor(val),
                    borderRadius: '6px',
                    padding: '6px 0',
                    color: '#fff',
                    fontWeight: 700,
                    minWidth: '56px',
                  }}>
                    {val.toFixed(1)}%
                  </div>
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: C.muted }}>
                No retention data yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AnalyticsDashboard() {
  const [token, setToken] = useState<string>('');
  const [role, setRole] = useState<string>('');
  const [days, setDays] = useState(30);
  const [tenantId, setTenantId] = useState<string>('');
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Chart data
  const [dauData, setDauData] = useState<{ date: string; value: number }[]>([]);
  const [retentionRows, setRetentionRows] = useState<CohortRow[]>([]);
  const [funnelData, setFunnelData] = useState<{ step: string; label: string; count: number }[]>([]);
  const [radarData, setRadarData] = useState<{ feature: string; users: number }[]>([]);

  // On mount — get token + role
  useEffect(() => {
    const t = localStorage.getItem('token') ?? '';
    setToken(t);
    if (t) {
      try {
        const parts = t.split('.');
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        setRole(payload.systemRole ?? '');
      } catch {/* noop */}
    }
  }, []);

  // Fetch tenant list (ADMIN only)
  useEffect(() => {
    if (role === 'ADMIN' && token) {
      fetchTenants(token).then(setTenants);
    }
  }, [role, token]);

  // Load all metrics
  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const tid = tenantId || undefined;

      // DAU
      const dauRes = await fetchMetric('dau', 'DAILY', days, tid, token);
      if (dauRes?.data) setDauData(dauRes.data.map((d: any) => ({ date: d.date, value: d.value })));

      // Retention — merge D1/D7/D30 by cohort_week
      const [d1Res, d7Res, d30Res] = await Promise.all([
        fetchMetric('retention_d1', 'WEEKLY', 12 * 7, tid, token),
        fetchMetric('retention_d7', 'WEEKLY', 12 * 7, tid, token),
        fetchMetric('retention_d30', 'WEEKLY', 12 * 7, tid, token),
      ]);
      const cohortMap: Record<string, CohortRow> = {};
      for (const row of d1Res?.data ?? []) {
        const w = row.dimensions?.cohort_week ?? row.date;
        cohortMap[w] = { cohort: w, d1: row.value, d7: 0, d30: 0 };
      }
      for (const row of d7Res?.data ?? []) {
        const w = row.dimensions?.cohort_week ?? row.date;
        if (cohortMap[w]) cohortMap[w].d7 = row.value;
      }
      for (const row of d30Res?.data ?? []) {
        const w = row.dimensions?.cohort_week ?? row.date;
        if (cohortMap[w]) cohortMap[w].d30 = row.value;
      }
      setRetentionRows(Object.values(cohortMap).slice(-12));

      // Funnel
      const funnelRes = await fetchMetric('funnel', 'DAILY', 1, tid, token);
      if (funnelRes?.data) {
        const seen = new Set<string>();
        const steps: { step: string; label: string; count: number }[] = [];
        for (const d of funnelRes.data) {
          const step = d.dimensions?.step as string;
          if (step && !seen.has(step)) {
            seen.add(step);
            steps.push({ step, label: d.dimensions?.label as string ?? step, count: d.value });
          }
        }
        setFunnelData(steps);
      }

      // Feature Radar — synthesise from funnel steps or placeholder
      setRadarData([
        { feature: 'Chat', users: funnelData.find(f => f.step === 'chat_sent')?.count ?? 0 },
        { feature: 'Docs', users: funnelData.find(f => f.step === 'doc_uploaded')?.count ?? 0 },
        { feature: 'Quiz', users: 0 },
        { feature: 'Flashcards', users: 0 },
        { feature: 'Groups', users: 0 },
      ]);
    } finally {
      setLoading(false);
    }
  }, [token, days, tenantId, funnelData]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, days, tenantId]);

  // ── Render ──
  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', color: C.text }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: '32px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '26px', fontWeight: 800, background: `linear-gradient(135deg, ${C.indigo}, ${C.violet})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Analytics Dashboard
          </h1>
          <p style={{ margin: '4px 0 0', color: C.muted, fontSize: '13px' }}>
            Hourly BI metrics · MetricSnapshot powered
          </p>
        </div>

        {/* ── Filters ── */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Day range */}
          <select
            id="days-filter"
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '8px 12px', color: C.text, fontSize: '13px', cursor: 'pointer' }}
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>

          {/* Tenant filter (SUPER_ADMIN only) */}
          {role === 'ADMIN' && (
            <select
              id="tenant-filter"
              value={tenantId}
              onChange={e => setTenantId(e.target.value)}
              style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '8px 12px', color: C.text, fontSize: '13px', cursor: 'pointer', minWidth: '160px' }}
            >
              <option value="">All Tenants</option>
              {tenants.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.subdomain})</option>
              ))}
            </select>
          )}

          <button
            id="analytics-refresh"
            onClick={loadAll}
            disabled={loading}
            style={{ background: `linear-gradient(135deg, ${C.indigo}, ${C.violet})`, border: 'none', borderRadius: '8px', padding: '8px 18px', color: '#fff', fontWeight: 600, fontSize: '13px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, transition: 'opacity 0.2s' }}
          >
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* ── Row 1: DAU + Funnel ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        {/* DAU Line Chart */}
        <Card>
          <SectionTitle title="Daily Active Users" subtitle={`Last ${days} days`} />
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={dauData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis
                dataKey="date"
                tick={{ fill: C.muted, fontSize: 10 }}
                tickFormatter={d => d.slice(5)}
              />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="value"
                name="DAU"
                stroke={C.indigo}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: C.violet }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Conversion Funnel */}
        <Card>
          <SectionTitle title="Conversion Funnel" subtitle="All-time user journey" />
          {funnelData.length > 0
            ? <FunnelChart data={funnelData} />
            : <p style={{ color: C.muted, fontSize: '13px', marginTop: '40px', textAlign: 'center' }}>No funnel data yet</p>
          }
        </Card>
      </div>

      {/* ── Row 2: Retention Heatmap ── */}
      <Card style={{ marginBottom: '20px' }}>
        <SectionTitle title="Retention Cohort Heatmap" subtitle="D1 / D7 / D30 retention rate by signup week" />
        <RetentionHeatmap rows={retentionRows} />
      </Card>

      {/* ── Row 3: MRR Area + Feature Radar ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
        {/* MRR placeholder — uses DAU data shape (swap for real MRR metric later) */}
        <Card>
          <SectionTitle title="Monthly Recurring Revenue" subtitle="Active subscription revenue trend" />
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dauData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C.emerald} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={C.emerald} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="date" tick={{ fill: C.muted, fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="value"
                name="MRR (proxy)"
                stroke={C.emerald}
                fill="url(#mrrGrad)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {/* Feature Adoption Radar */}
        <Card>
          <SectionTitle title="Feature Adoption" subtitle="Active users per feature area" />
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData} margin={{ top: 4, right: 24, left: 24, bottom: 4 }}>
              <PolarGrid stroke={C.border} />
              <PolarAngleAxis dataKey="feature" tick={{ fill: C.muted, fontSize: 11 }} />
              <PolarRadiusAxis tick={{ fill: C.muted, fontSize: 9 }} />
              <Radar
                name="Users"
                dataKey="users"
                stroke={C.violet}
                fill={C.violet}
                fillOpacity={0.25}
              />
              <Tooltip content={<ChartTooltip />} />
            </RadarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* ── Churn Risk Banner ── */}
      <Card style={{ borderColor: `${C.rose}44`, background: `${C.rose}08` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '22px' }}>⚠️</div>
          <div>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: C.rose }}>Churn Risk Monitoring</h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: C.muted }}>
              Users with active subscriptions and zero events in the last 14 days are automatically flagged by the hourly BI cron. Notifications are dispatched to NestJS for reseller email alerts.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

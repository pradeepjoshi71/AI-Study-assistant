'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  lastUsedAt: string | null;
  createdAt: string;
}

interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  status: 'ACTIVE' | 'FAILED' | 'DISABLED';
  createdAt: string;
}

interface UsageStats {
  requests: { date: string; count: number }[];
  errorRate: number;
  avgLatency: number;
}

export default function DevelopersDashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Data States
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [stats, setStats] = useState<UsageStats>({
    requests: [],
    errorRate: 0,
    avgLatency: 0,
  });

  // Key Creation State
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['chat:read', 'chat:write']);
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);

  // Webhook Creation State
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<string[]>(['chat.message_sent', 'quiz.completed']);

  // Notifications
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const baseApiUrl = process.env.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL.replace(/\/api\/v1$/, '')
    : 'http://localhost:3001';
  
  const apiUrl = `${baseApiUrl}/api/v1`;
  const publicApiUrl = `${baseApiUrl}/api/public/v1`;

  const availableScopes = [
    { label: 'Chat Read', value: 'chat:read' },
    { label: 'Chat Write', value: 'chat:write' },
    { label: 'Quiz Read', value: 'quiz:read' },
    { label: 'Quiz Write', value: 'quiz:write' },
    { label: 'Progress Read', value: 'progress:read' },
    { label: 'Documents Read', value: 'documents:read' },
    { label: 'Documents Write', value: 'documents:write' },
    { label: 'Analytics Read', value: 'analytics:read' },
    { label: 'Webhooks Write', value: 'webhooks:write' },
  ];

  const availableEvents = [
    { label: 'Chat Session Created', value: 'chat.session_created' },
    { label: 'Chat Message Sent', value: 'chat.message_sent' },
    { label: 'Quiz Generated', value: 'quiz.generated' },
    { label: 'Quiz Completed', value: 'quiz.completed' },
    { label: 'Document Uploaded', value: 'document.uploaded' },
    { label: 'Document Ready', value: 'document.ready' },
  ];

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
      setToken(savedToken);
      fetchDashboardData(savedToken);
    } else {
      setLoading(false);
    }
  }, []);

  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  const fetchDashboardData = async (authToken: string) => {
    setLoading(true);
    try {
      await Promise.all([
        fetchApiKeys(authToken),
        fetchWebhooks(authToken),
        fetchStats(authToken),
      ]);
    } catch (err) {
      console.error('Error fetching developers console data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchApiKeys = async (authToken: string) => {
    try {
      const res = await fetch(`${apiUrl}/api-keys`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data);
      }
    } catch (err) {
      console.error('Failed to load keys:', err);
    }
  };

  const fetchWebhooks = async (authToken: string) => {
    try {
      const res = await fetch(`${apiUrl}/webhooks`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setWebhooks(data);
      }
    } catch (err) {
      console.error('Failed to load webhooks:', err);
    }
  };

  const fetchStats = async (authToken: string) => {
    try {
      const res = await fetch(`${publicApiUrl}/usage/stats`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const responseJson = await res.json();
        if (responseJson.success) {
          setStats(responseJson.data);
        }
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) return;

    setActionLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: keyName,
          scopes: selectedScopes,
          permissions: selectedScopes,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setCreatedRawKey(data.rawKey);
        fetchApiKeys(token!);
        showNotification('API key generated successfully!', 'success');
      } else {
        showNotification('Failed to generate API key.', 'error');
      }
    } catch (err) {
      showNotification('Network error occurred.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevokeApiKey = async (keyId: string) => {
    if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) return;

    setActionLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        fetchApiKeys(token!);
        showNotification('API key revoked.', 'success');
      } else {
        showNotification('Failed to revoke API key.', 'error');
      }
    } catch (err) {
      showNotification('Network error occurred.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webhookUrl.trim()) return;

    setActionLoading(true);
    try {
      const res = await fetch(`${apiUrl}/webhooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          url: webhookUrl,
          events: webhookEvents
        })
      });

      if (res.ok) {
        const data = await res.json();
        fetchWebhooks(token!);
        setWebhookUrl('');
        setIsWebhookModalOpen(false);
        showNotification(`Webhook registered! HMAC Secret: ${data.secret}`, 'success');
      } else {
        const errorJson = await res.json();
        showNotification(errorJson.message || 'Failed to register webhook.', 'error');
      }
    } catch (err) {
      showNotification('Network error occurred.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!confirm('Deregister this webhook endpoint?')) return;

    setActionLoading(true);
    try {
      const res = await fetch(`${apiUrl}/webhooks/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        fetchWebhooks(token!);
        showNotification('Webhook endpoint deregistered.', 'success');
      } else {
        showNotification('Failed to delete webhook.', 'error');
      }
    } catch (err) {
      showNotification('Network error occurred.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const toggleScope = (scope: string) => {
    setSelectedScopes(prev =>
      prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
    );
  };

  const toggleEvent = (event: string) => {
    setWebhookEvents(prev =>
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
    );
  };

  // Render Loader or Login check
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: 'var(--bg-primary)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-secondary)' }}>Loading Developer Console...</h2>
      </div>
    );
  }

  if (!token) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: 'var(--bg-primary)', padding: '24px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', marginBottom: '16px' }}>Access Denied</h2>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: '24px' }}>Please log in to access your Developer Console.</p>
        <Link href="/developers" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>← Back to Developers Hub</Link>
      </div>
    );
  }

  const totalRequests = stats.requests.reduce((sum, item) => sum + item.count, 0);

  return (
    <div style={{ position: 'relative', minHeight: '100vh', paddingBottom: '100px' }}>
      <div className="bg-glow-1" />

      {/* Nav */}
      <nav style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '20px 5%',
        borderBottom: '1px solid var(--glass-border)',
        background: 'rgba(10, 10, 12, 0.7)',
        backdropFilter: 'blur(10px)',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <Link href="/developers" style={{ color: 'var(--color-text-secondary)', textDecoration: 'none', fontSize: '0.95rem' }}>
            ← Home
          </Link>
          <span style={{ color: '#333339' }}>|</span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700 }}>
            Developer Console
          </span>
        </div>
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <Link href="/developers/docs" style={{ color: 'var(--color-text-secondary)', textDecoration: 'none', fontSize: '0.95rem' }}>Docs</Link>
          <Link href="/developers/playground" style={{ color: 'var(--color-text-secondary)', textDecoration: 'none', fontSize: '0.95rem' }}>Playground</Link>
        </div>
      </nav>

      {/* Notification Toast */}
      {notification && (
        <div style={{
          position: 'fixed',
          top: '90px',
          right: '24px',
          padding: '16px 24px',
          borderRadius: '12px',
          zIndex: 1000,
          background: notification.type === 'success' ? 'var(--color-success-glow)' : 'var(--color-error-glow)',
          border: `1px solid ${notification.type === 'success' ? 'var(--color-success)' : 'var(--color-error)'}`,
          color: '#fff',
          fontWeight: 500,
          boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          backdropFilter: 'blur(10px)'
        }}>
          {notification.message}
        </div>
      )}

      {/* Main Grid */}
      <main style={{ maxWidth: '1400px', margin: '40px auto 0 auto', padding: '0 24px', position: 'relative', zIndex: 2 }}>
        
        {/* Stat Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', marginBottom: '32px' }}>
          <div className="glass-panel">
            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', fontWeight: 600 }}>API Requests (Last 30 Days)</span>
            <h3 style={{ fontSize: '2.25rem', marginTop: '12px', fontFamily: 'var(--font-display)' }}>{totalRequests.toLocaleString()}</h3>
          </div>
          <div className="glass-panel">
            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', fontWeight: 600 }}>Avg Latency</span>
            <h3 style={{ fontSize: '2.25rem', marginTop: '12px', fontFamily: 'var(--font-display)', color: 'var(--color-secondary)' }}>{stats.avgLatency} ms</h3>
          </div>
          <div className="glass-panel">
            <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', fontWeight: 600 }}>Error Rate</span>
            <h3 style={{ fontSize: '2.25rem', marginTop: '12px', fontFamily: 'var(--font-display)', color: stats.errorRate > 5 ? 'var(--color-error)' : 'var(--color-success)' }}>{stats.errorRate} %</h3>
          </div>
        </div>

        {/* Usage Graph */}
        <div className="glass-panel" style={{ padding: '32px', marginBottom: '32px' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '24px', fontFamily: 'var(--font-display)' }}>Requests History (30d)</h2>
          <div style={{ width: '100%', height: '300px' }}>
            {stats.requests.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.requests} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" stroke="var(--color-text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)', borderRadius: '8px' }}
                    labelStyle={{ color: 'var(--color-text-secondary)', fontSize: '11px' }}
                    itemStyle={{ color: '#fff', fontSize: '13px' }}
                  />
                  <Area type="monotone" dataKey="count" name="Requests" stroke="var(--color-primary)" strokeWidth={2} fillOpacity={1} fill="url(#colorRequests)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--color-text-muted)' }}>
                No request history data found.
              </div>
            )}
          </div>
        </div>

        {/* API Keys Table */}
        <div className="glass-panel" style={{ padding: '32px', marginBottom: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-display)' }}>API Keys</h2>
            <button onClick={() => { setCreatedRawKey(null); setIsKeyModalOpen(true); }} style={{
              background: 'linear-gradient(135deg, var(--color-primary), #4f46e5)',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 16px',
              color: '#fff',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}>
              + Create API Key
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--glass-border)', color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
                  <th style={{ padding: '12px 16px' }}>Name</th>
                  <th style={{ padding: '12px 16px' }}>Prefix</th>
                  <th style={{ padding: '12px 16px' }}>Scopes</th>
                  <th style={{ padding: '12px 16px' }}>Last Used</th>
                  <th style={{ padding: '12px 16px' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.length > 0 ? (
                  apiKeys.map((key) => (
                    <tr key={key.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: '0.9rem' }}>
                      <td style={{ padding: '16px', fontWeight: 500 }}>{key.name}</td>
                      <td style={{ padding: '16px', fontFamily: 'monospace' }}><code>{key.keyPrefix}</code></td>
                      <td style={{ padding: '16px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {key.scopes.map(s => (
                            <span key={s} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '4px', padding: '2px 6px', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{s}</span>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: '16px', color: 'var(--color-text-secondary)' }}>
                        {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}
                      </td>
                      <td style={{ padding: '16px' }}>
                        <span style={{
                          color: key.status === 'ACTIVE' ? 'var(--color-success)' : 'var(--color-text-muted)',
                          fontSize: '0.85rem',
                          fontWeight: 600
                        }}>{key.status}</span>
                      </td>
                      <td style={{ padding: '16px', textAlign: 'right' }}>
                        {key.status === 'ACTIVE' && (
                          <button onClick={() => handleRevokeApiKey(key.id)} style={{
                            background: 'none',
                            border: '1px solid rgba(244, 63, 94, 0.3)',
                            borderRadius: '6px',
                            padding: '4px 10px',
                            color: 'var(--color-error)',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            transition: 'background 0.2s'
                          }} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--color-error-glow)'} onMouseLeave={(e) => e.currentTarget.style.background = 'none'}>
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>No API Keys configured.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Webhooks Section */}
        <div className="glass-panel" style={{ padding: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '1.25rem', fontFamily: 'var(--font-display)' }}>Webhook Endpoints</h2>
            <button onClick={() => setIsWebhookModalOpen(true)} style={{
              background: 'linear-gradient(135deg, var(--color-secondary), #0891b2)',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 16px',
              color: '#fff',
              fontSize: '0.9rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}>
              + Register Endpoint
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--glass-border)', color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
                  <th style={{ padding: '12px 16px' }}>Endpoint URL</th>
                  <th style={{ padding: '12px 16px' }}>Subscribed Events</th>
                  <th style={{ padding: '12px 16px' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {webhooks.length > 0 ? (
                  webhooks.map((hook) => (
                    <tr key={hook.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: '0.9rem' }}>
                      <td style={{ padding: '16px', fontFamily: 'monospace', fontWeight: 500 }}>{hook.url}</td>
                      <td style={{ padding: '16px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {hook.events.map(e => (
                            <span key={e} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '4px', padding: '2px 6px', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{e}</span>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: '16px' }}>
                        <span style={{
                          color: hook.status === 'ACTIVE' ? 'var(--color-success)' : 'var(--color-error)',
                          fontSize: '0.85rem',
                          fontWeight: 600
                        }}>{hook.status}</span>
                      </td>
                      <td style={{ padding: '16px', textAlign: 'right' }}>
                        <button onClick={() => handleDeleteWebhook(hook.id)} style={{
                          background: 'none',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '6px',
                          padding: '4px 10px',
                          color: 'var(--color-text-secondary)',
                          fontSize: '0.8rem',
                          cursor: 'pointer'
                        }} onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--color-error)'} onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>No Webhook Endpoints configured.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </main>

      {/* CREATE API KEY MODAL */}
      {isKeyModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)', padding: '32px' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '20px', fontFamily: 'var(--font-display)' }}>Create API Key</h3>
            
            {createdRawKey ? (
              <div>
                <p style={{ color: 'var(--color-text-secondary)', marginBottom: '16px', fontSize: '0.9rem' }}>
                  Make sure to copy your API key now. You won't be able to see it again!
                </p>
                <div style={{
                  background: '#070709',
                  border: '1px solid var(--glass-border)',
                  padding: '16px',
                  borderRadius: '8px',
                  fontFamily: 'monospace',
                  fontSize: '0.95rem',
                  color: 'var(--color-secondary)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '24px',
                  wordBreak: 'break-all'
                }}>
                  <span>{createdRawKey}</span>
                  <button onClick={() => navigator.clipboard.writeText(createdRawKey)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', marginLeft: '10px' }} title="Copy">
                    📋
                  </button>
                </div>
                <button onClick={() => { setIsKeyModalOpen(false); setCreatedRawKey(null); setKeyName(''); }} style={{
                  width: '100%',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: '8px',
                  padding: '12px',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}>
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateApiKey}>
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', color: 'var(--color-text-secondary)', fontSize: '0.85rem', marginBottom: '8px', fontWeight: 600 }}>Key Name</label>
                  <input type="text" placeholder="e.g. Production Backend" value={keyName} onChange={e => setKeyName(e.target.value)} required style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '8px',
                    padding: '12px',
                    color: '#fff',
                    outline: 'none',
                    fontSize: '0.95rem'
                  }} />
                </div>

                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'block', color: 'var(--color-text-secondary)', fontSize: '0.85rem', marginBottom: '12px', fontWeight: 600 }}>Permissions Scopes</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', maxHeight: '180px', overflowY: 'auto' }}>
                    {availableScopes.map(scope => (
                      <label key={scope.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={selectedScopes.includes(scope.value)} onChange={() => toggleScope(scope.value)} style={{ accentColor: 'var(--color-primary)' }} />
                        {scope.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button type="button" onClick={() => setIsKeyModalOpen(false)} style={{
                    flex: 1,
                    background: 'none',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '8px',
                    padding: '12px',
                    color: 'var(--color-text-secondary)',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}>
                    Cancel
                  </button>
                  <button type="submit" disabled={actionLoading} style={{
                    flex: 1,
                    background: 'linear-gradient(135deg, var(--color-primary), #4f46e5)',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '12px',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}>
                    {actionLoading ? 'Creating...' : 'Create Key'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* REGISTER WEBHOOK MODAL */}
      {isWebhookModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)', padding: '32px' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '20px', fontFamily: 'var(--font-display)' }}>Register Webhook Endpoint</h3>
            
            <form onSubmit={handleCreateWebhook}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', color: 'var(--color-text-secondary)', fontSize: '0.85rem', marginBottom: '8px', fontWeight: 600 }}>Destination URL</label>
                <input type="url" placeholder="https://api.my-app.com/webhooks" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} required style={{
                  width: '100%',
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: '8px',
                  padding: '12px',
                  color: '#fff',
                  outline: 'none',
                  fontSize: '0.95rem'
                }} />
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', color: 'var(--color-text-secondary)', fontSize: '0.85rem', marginBottom: '12px', fontWeight: 600 }}>Subscribe Events</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {availableEvents.map(evt => (
                    <label key={evt.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={webhookEvents.includes(evt.value)} onChange={() => toggleEvent(evt.value)} style={{ accentColor: 'var(--color-secondary)' }} />
                      {evt.label}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="button" onClick={() => setIsWebhookModalOpen(false)} style={{
                  flex: 1,
                  background: 'none',
                  border: '1px solid var(--glass-border)',
                  borderRadius: '8px',
                  padding: '12px',
                  color: 'var(--color-text-secondary)',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}>
                  Cancel
                </button>
                <button type="submit" disabled={actionLoading} style={{
                  flex: 1,
                  background: 'linear-gradient(135deg, var(--color-secondary), #0891b2)',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '12px',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}>
                  {actionLoading ? 'Registering...' : 'Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

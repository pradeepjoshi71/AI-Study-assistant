'use client';

import React, { useEffect, useState } from 'react';

interface FeatureFlag {
  id: string;
  key: string;
  enabled: boolean;
  rolloutPercent: number;
  targetOrgIds: string[];
}

export default function AdminFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fetchFlags = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiUrl}/admin/flags`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!res.ok) throw new Error('Failed to load feature flags');
      const data = await res.json();
      setFlags(data);
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFlags();
  }, []);

  const handleToggle = (key: string) => {
    setFlags(prev => prev.map(f => {
      if (f.key === key) {
        return { ...f, enabled: !f.enabled };
      }
      return f;
    }));
  };

  const handleSliderChange = (key: string, value: number) => {
    setFlags(prev => prev.map(f => {
      if (f.key === key) {
        return { ...f, rolloutPercent: value };
      }
      return f;
    }));
  };

  const handleOrgsChange = (key: string, value: string) => {
    const ids = value.split(',').map(s => s.trim()).filter(Boolean);
    setFlags(prev => prev.map(f => {
      if (f.key === key) {
        return { ...f, targetOrgIds: ids };
      }
      return f;
    }));
  };

  const handleSave = async (flag: FeatureFlag) => {
    setSavingKey(flag.key);
    try {
      const token = localStorage.getItem('token');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiUrl}/admin/flags/${flag.key}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: flag.enabled,
          rolloutPercent: flag.rolloutPercent,
          targetOrgIds: flag.targetOrgIds,
        }),
      });

      if (!res.ok) throw new Error('Save failed');
      setMessage({ text: `Feature flag "${flag.key}" updated & Redis cache flushed!`, type: 'success' });
      fetchFlags();
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <header style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '28px', color: '#f4f4f7' }}>Feature Flags Control</h2>
        <p style={{ color: '#9496a8', marginTop: '4px' }}>Toggle capabilities, adjust percentage rollouts, and grant whitelist scopes.</p>
      </header>

      {message && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '8px',
          marginBottom: '20px',
          fontSize: '14px',
          backgroundColor: message.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)',
          border: message.type === 'success' ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(244,63,94,0.3)',
          color: message.type === 'success' ? '#10b981' : '#f43f5e',
        }}>
          {message.text}
        </div>
      )}

      {loading && flags.length === 0 ? (
        <div style={{ color: '#9496a8', textAlign: 'center', padding: '40px' }}>
          Querying flag parameters...
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: 0, overflowX: 'auto', border: '1px solid rgba(255,255,255,0.06)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: '#121216', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <th style={{ padding: '18px 24px', color: '#f4f4f7', fontWeight: 600 }}>Flag Key</th>
                <th style={{ padding: '18px 24px', color: '#f4f4f7', fontWeight: 600 }}>Globally Enabled</th>
                <th style={{ padding: '18px 24px', color: '#f4f4f7', fontWeight: 600 }}>Rollout Percent</th>
                <th style={{ padding: '18px 24px', color: '#f4f4f7', fontWeight: 600 }}>Target Org IDs</th>
                <th style={{ padding: '18px 24px', color: '#f4f4f7', fontWeight: 600, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((flag) => (
                <tr key={flag.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '18px 24px', fontWeight: 600, color: '#f4f4f7', fontFamily: 'monospace', fontSize: '14px' }}>
                    {flag.key}
                  </td>
                  
                  {/* Globally Enabled Toggle */}
                  <td style={{ padding: '18px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <button
                        type="button"
                        onClick={() => handleToggle(flag.key)}
                        style={{
                          width: '44px',
                          height: '22px',
                          borderRadius: '11px',
                          backgroundColor: flag.enabled ? '#6366f1' : '#1e1e24',
                          border: 'none',
                          position: 'relative',
                          cursor: 'pointer',
                          transition: 'background-color 0.2s'
                        }}
                      >
                        <div style={{
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          backgroundColor: '#fff',
                          position: 'absolute',
                          top: '2px',
                          left: flag.enabled ? '24px' : '2px',
                          transition: 'left 0.2s'
                        }} />
                      </button>
                      <span style={{ color: flag.enabled ? '#10b981' : '#9496a8', fontWeight: 500 }}>
                        {flag.enabled ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </td>

                  {/* Rollout Percent Slider */}
                  <td style={{ padding: '18px 24px', minWidth: '200px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={flag.rolloutPercent}
                        onChange={(e) => handleSliderChange(flag.key, parseInt(e.target.value))}
                        disabled={flag.enabled}
                        style={{
                          flex: 1,
                          cursor: flag.enabled ? 'not-allowed' : 'pointer',
                          opacity: flag.enabled ? 0.3 : 1
                        }}
                      />
                      <span style={{ minWidth: '36px', textAlign: 'right', fontWeight: 'bold', color: '#f4f4f7' }}>
                        {flag.rolloutPercent}%
                      </span>
                    </div>
                  </td>

                  {/* Target Org Whitelist */}
                  <td style={{ padding: '18px 24px' }}>
                    <input
                      type="text"
                      placeholder="Comma-separated Org IDs"
                      value={flag.targetOrgIds.join(', ')}
                      onChange={(e) => handleOrgsChange(flag.key, e.target.value)}
                      disabled={flag.enabled}
                      style={{
                        width: '100%',
                        backgroundColor: '#0a0a0c',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '6px',
                        padding: '6px 12px',
                        color: '#f4f4f7',
                        fontSize: '12px',
                        opacity: flag.enabled ? 0.3 : 1
                      }}
                    />
                  </td>

                  {/* Inline Save Action */}
                  <td style={{ padding: '18px 24px', textAlign: 'right' }}>
                    <button
                      onClick={() => handleSave(flag)}
                      disabled={savingKey === flag.key}
                      style={{
                        backgroundColor: '#6366f1',
                        border: 'none',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: '12px',
                        padding: '6px 16px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'opacity 0.2s'
                      }}
                    >
                      {savingKey === flag.key ? 'Saving...' : 'Save'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

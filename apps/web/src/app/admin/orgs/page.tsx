'use client';

import React, { useEffect, useState, useCallback } from 'react';

interface OrganizationItem {
  id: string;
  name: string;
  slug: string;
  isSuspended: boolean;
  suspendedReason: string | null;
  createdAt: string;
  subscription: {
    id: string;
    status: string;
    plan: {
      name: string;
      price: number;
    } | null;
  } | null;
  _count: {
    members: number;
    apiKeys: number;
  };
}

export default function AdminOrgsPage() {
  const [orgs, setOrgs] = useState<OrganizationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  
  // Suspension Modal State
  const [suspendingOrgId, setSuspendingOrgId] = useState<string | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [submittingSuspension, setSubmittingSuspension] = useState(false);

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      
      const res = await fetch(`${apiUrl}/admin/organizations?page=${page}&limit=${limit}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error('Failed to load organizations');
      const data = await res.json();
      
      setOrgs(data.items || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setMessage({ text: err.message || 'Error loading organizations', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  const handleUnsuspend = async (id: string) => {
    if (!confirm('Are you sure you want to reactivate this organization?')) return;
    try {
      const token = localStorage.getItem('token');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiUrl}/admin/organizations/${id}/unsuspend`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error('Unsuspend action failed');
      setMessage({ text: 'Organization has been successfully unsuspended', type: 'success' });
      fetchOrgs();
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    }
  };

  const openSuspendModal = (id: string) => {
    setSuspendingOrgId(id);
    setSuspendReason('');
  };

  const handleSuspendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendReason.trim()) {
      alert('Please provide a suspension reason');
      return;
    }
    setSubmittingSuspension(true);
    try {
      const token = localStorage.getItem('token');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiUrl}/admin/organizations/${suspendingOrgId}/suspend`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: suspendReason }),
      });

      if (!res.ok) throw new Error('Suspend action failed');
      setMessage({ text: 'Organization suspended successfully', type: 'success' });
      setSuspendingOrgId(null);
      fetchOrgs();
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setSubmittingSuspension(false);
    }
  };

  // Filter organizations locally by name/slug if search input is used
  const filteredOrgs = orgs.filter(o => 
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.slug.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <header style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 600, color: '#f4f4f7', fontFamily: 'var(--font-display)' }}>
          Organizations Directory
        </h1>
        <p style={{ color: '#9496a8', marginTop: '6px', fontSize: '14px' }}>
          Manage platform tenants, monitor user counts, check subscriptions and suspend/unsuspend org resources.
        </p>
      </header>

      {/* Message Notifications */}
      {message && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '8px',
          marginBottom: '24px',
          fontSize: '14px',
          fontWeight: 500,
          backgroundColor: message.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)',
          color: message.type === 'success' ? '#10b981' : '#f43f5e',
          border: `1px solid ${message.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(244,63,94,0.3)'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>{message.text}</span>
          <button 
            onClick={() => setMessage(null)} 
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Toolbar / Filters */}
      <div className="glass-panel" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        marginBottom: '24px',
        padding: '16px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
          <input
            type="text"
            placeholder="Search organizations by name or slug..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              backgroundColor: '#0a0a0c',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '8px',
              padding: '10px 16px',
              color: '#f4f4f7',
              fontSize: '14px',
              width: '100%',
              maxWidth: '380px',
              outline: 'none',
              transition: 'border-color 0.2s'
            }}
          />
        </div>

        <button 
          onClick={fetchOrgs}
          style={{
            padding: '10px 16px',
            backgroundColor: 'transparent',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            color: '#f4f4f7',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500,
            transition: 'background-color 0.2s'
          }}
        >
          Refresh Data
        </button>
      </div>

      {/* Organizations Table */}
      <div className="glass-panel" style={{ padding: 0, overflowX: 'auto', border: '1px solid rgba(255,255,255,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: '#121216', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <th style={{ padding: '16px', color: '#f4f4f7', fontWeight: 600 }}>Organization</th>
              <th style={{ padding: '16px', color: '#f4f4f7', fontWeight: 600 }}>Slug</th>
              <th style={{ padding: '16px', color: '#f4f4f7', fontWeight: 600 }}>Active Plan</th>
              <th style={{ padding: '16px', color: '#f4f4f7', fontWeight: 600, textAlign: 'center' }}>Members</th>
              <th style={{ padding: '16px', color: '#f4f4f7', fontWeight: 600, textAlign: 'center' }}>API Keys</th>
              <th style={{ padding: '16px', color: '#f4f4f7', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '16px', color: '#f4f4f7', fontWeight: 600, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#9496a8' }}>
                  Querying database records...
                </td>
              </tr>
            ) : filteredOrgs.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#9496a8' }}>
                  No organizations found.
                </td>
              </tr>
            ) : (
              filteredOrgs.map((org) => {
                const planName = org.subscription?.plan?.name || 'Free Trial';
                return (
                  <tr key={org.id} style={{ 
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    transition: 'background-color 0.2s'
                  }}>
                    <td style={{ padding: '16px' }}>
                      <div style={{ fontWeight: 500, color: '#f4f4f7' }}>{org.name}</div>
                      <div style={{ color: '#9496a8', fontSize: '11px', marginTop: '2px' }}>ID: {org.id}</div>
                    </td>
                    <td style={{ padding: '16px', color: '#06b6d4', fontFamily: 'monospace' }}>
                      {org.slug}
                    </td>
                    <td style={{ padding: '16px' }}>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: org.subscription?.plan ? 'rgba(6, 182, 212, 0.12)' : 'rgba(255, 255, 255, 0.05)',
                        color: org.subscription?.plan ? '#06b6d4' : '#9496a8'
                      }}>
                        {planName}
                      </span>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'center', color: '#f4f4f7', fontWeight: 500 }}>
                      {org._count?.members ?? 0}
                    </td>
                    <td style={{ padding: '16px', textAlign: 'center', color: '#f4f4f7', fontWeight: 500 }}>
                      {org._count?.apiKeys ?? 0}
                    </td>
                    <td style={{ padding: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: org.isSuspended ? '#f43f5e' : '#10b981'
                        }} />
                        <span style={{ color: org.isSuspended ? '#f43f5e' : '#10b981', fontSize: '12px', fontWeight: 500 }}>
                          {org.isSuspended ? 'Suspended' : 'Active'}
                        </span>
                      </div>
                      {org.isSuspended && org.suspendedReason && (
                        <div style={{ fontSize: '10px', color: '#9496a8', marginTop: '4px', maxWidth: '200px' }}>
                          Reason: {org.suspendedReason}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        {org.isSuspended ? (
                          <button onClick={() => handleUnsuspend(org.id)} style={{
                            backgroundColor: 'transparent',
                            border: '1px solid rgba(16,185,129,0.3)',
                            color: '#10b981',
                            borderRadius: '6px',
                            padding: '6px 12px',
                            fontSize: '12px',
                            fontWeight: 500,
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}>
                            Reactivate
                          </button>
                        ) : (
                          <button onClick={() => openSuspendModal(org.id)} style={{
                            backgroundColor: 'transparent',
                            border: '1px solid rgba(244,63,94,0.3)',
                            color: '#f43f5e',
                            borderRadius: '6px',
                            padding: '6px 12px',
                            fontSize: '12px',
                            fontWeight: 500,
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}>
                            Suspend Org
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px' }}>
        <span style={{ fontSize: '13px', color: '#9496a8' }}>
          Total tenants: <strong>{total}</strong>
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            disabled={page === 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            style={{
              padding: '6px 12px',
              backgroundColor: '#121216',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '6px',
              color: page === 1 ? '#5e6175' : '#f4f4f7',
              cursor: page === 1 ? 'not-allowed' : 'pointer'
            }}
          >
            Previous
          </button>
          <span style={{ alignSelf: 'center', fontSize: '13px', color: '#9496a8' }}>
            Page <strong>{page}</strong>
          </span>
          <button 
            disabled={page * limit >= total}
            onClick={() => setPage(p => p + 1)}
            style={{
              padding: '6px 12px',
              backgroundColor: '#121216',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '6px',
              color: page * limit >= total ? '#5e6175' : '#f4f4f7',
              cursor: page * limit >= total ? 'not-allowed' : 'pointer'
            }}
          >
            Next
          </button>
        </div>
      </div>

      {/* Suspension Modal Dialogue */}
      {suspendingOrgId && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '480px', padding: '28px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#f4f4f7', marginBottom: '12px' }}>
              Confirm Tenant Suspension
            </h3>
            <p style={{ fontSize: '13px', color: '#9496a8', marginBottom: '20px', lineHeight: '1.5' }}>
              This will suspend all active operations for this organization, lock API keys, and block resource usage. The users will see a suspension notice when accessing their workspaces.
            </p>

            <form onSubmit={handleSuspendSubmit}>
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#f4f4f7', marginBottom: '8px' }}>
                  REASON FOR SUSPENSION
                </label>
                <textarea
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="e.g. Non-payment, violation of terms of service, excessive usage abuse..."
                  required
                  rows={4}
                  style={{
                    width: '100%',
                    backgroundColor: '#0a0a0c',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '8px',
                    padding: '12px',
                    color: '#f4f4f7',
                    fontSize: '13px',
                    outline: 'none',
                    resize: 'vertical'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setSuspendingOrgId(null)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: 'transparent',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px',
                    color: '#9496a8',
                    cursor: 'pointer',
                    fontSize: '13px'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingSuspension}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#f43f5e',
                    border: '1px solid transparent',
                    borderRadius: '6px',
                    color: '#fff',
                    cursor: submittingSuspension ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    fontWeight: 500
                  }}
                >
                  {submittingSuspension ? 'Suspending...' : 'Confirm Suspension'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

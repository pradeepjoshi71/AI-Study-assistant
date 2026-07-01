'use client';

import React, { useEffect, useState } from 'react';

interface ExportRequest {
  id: string;
  userId: string;
  orgId: string;
  status: string;
  requestedAt: string;
  downloadUrl?: string;
}

interface DeletionRequest {
  id: string;
  userId: string;
  orgId: string;
  status: string;
  scheduledAt: string;
}

interface AuditLog {
  id: string;
  orgId?: string;
  userId?: string;
  actorId: string;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  createdAt: string;
}

interface RetentionPolicy {
  orgId: string;
  auditRetentionDays: number;
  dataRetentionDays: number;
  updatedBy: string;
  updatedAt: string;
  organization?: {
    name: string;
  };
}

interface Organization {
  id: string;
  name: string;
}

export default function AdminCompliancePage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'requests' | 'audit' | 'retention'>('requests');

  // Lists data
  const [exports, setExports] = useState<ExportRequest[]>([]);
  const [deletions, setDeletions] = useState<DeletionRequest[]>([]);
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);

  // Audit log pagination & filtering
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorsHistory, setCursorsHistory] = useState<string[]>([]);
  const [auditFilters, setAuditFilters] = useState({
    userId: '',
    actorType: '',
    action: '',
    resourceType: '',
    startDate: '',
    endDate: '',
    orgId: '',
  });

  // Retention Policy form state
  const [policyForm, setPolicyForm] = useState({
    orgId: '',
    auditRetentionDays: 90,
    dataRetentionDays: 365,
  });

  // Action states
  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
      setToken(savedToken);
      loadInitialData(savedToken);
    } else {
      setLoading(false);
    }
  }, []);

  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  const loadInitialData = async (authToken: string) => {
    setLoading(true);
    try {
      await Promise.all([
        fetchExports(authToken),
        fetchDeletions(authToken),
        fetchOrgs(authToken),
        fetchPolicies(authToken),
        fetchAuditLogs(authToken),
      ]);
    } catch (err) {
      console.error('Error loading admin compliance data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchExports = async (authToken: string) => {
    const res = await fetch(`${apiUrl}/admin/compliance/exports`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.ok) setExports(await res.json());
  };

  const fetchDeletions = async (authToken: string) => {
    const res = await fetch(`${apiUrl}/admin/compliance/deletions`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.ok) setDeletions(await res.json());
  };

  const fetchOrgs = async (authToken: string) => {
    const res = await fetch(`${apiUrl}/admin/organizations?limit=100`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      setOrgs(data.data || []);
    }
  };

  const fetchPolicies = async (authToken: string) => {
    const res = await fetch(`${apiUrl}/admin/compliance/retention-policies`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.ok) setPolicies(await res.json());
  };

  // Fetch audit logs with active filters and cursor
  const fetchAuditLogs = async (authToken: string, cursor?: string) => {
    const params = new URLSearchParams();
    if (auditFilters.userId) params.append('userId', auditFilters.userId);
    if (auditFilters.actorType) params.append('actorType', auditFilters.actorType);
    if (auditFilters.action) params.append('action', auditFilters.action);
    if (auditFilters.resourceType) params.append('resourceType', auditFilters.resourceType);
    if (auditFilters.startDate) params.append('startDate', auditFilters.startDate);
    if (auditFilters.endDate) params.append('endDate', auditFilters.endDate);
    if (auditFilters.orgId) params.append('orgId', auditFilters.orgId);
    if (cursor) params.append('cursor', cursor);

    const res = await fetch(`${apiUrl}/admin/compliance/audit-logs?${params.toString()}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (res.ok) {
      const body = await res.json();
      setAuditLogs(body.data || []);
      setNextCursor(body.nextCursor || null);
    }
  };

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setCursorsHistory([]);
    fetchAuditLogs(token);
  };

  const handleNextPage = () => {
    if (!token || !nextCursor) return;
    setCursorsHistory((prev) => [...prev, nextCursor]);
    fetchAuditLogs(token, nextCursor);
  };

  const handlePrevPage = () => {
    if (!token) return;
    const prevHistory = [...cursorsHistory];
    prevHistory.pop(); // remove current page's cursor
    const prevCursor = prevHistory[prevHistory.length - 1] || undefined;
    setCursorsHistory(prevHistory);
    fetchAuditLogs(token, prevCursor);
  };

  // Export CSV file download
  const handleExportCSV = () => {
    if (!token) return;
    const params = new URLSearchParams();
    if (auditFilters.userId) params.append('userId', auditFilters.userId);
    if (auditFilters.actorType) params.append('actorType', auditFilters.actorType);
    if (auditFilters.action) params.append('action', auditFilters.action);
    if (auditFilters.resourceType) params.append('resourceType', auditFilters.resourceType);
    if (auditFilters.startDate) params.append('startDate', auditFilters.startDate);
    if (auditFilters.endDate) params.append('endDate', auditFilters.endDate);
    if (auditFilters.orgId) params.append('orgId', auditFilters.orgId);

    window.open(`${apiUrl}/admin/compliance/audit-logs/export?${params.toString()}&token=${token}`);
  };

  // Cancel deletion request
  const handleCancelDeletion = async (requestId: string) => {
    if (!token) return;
    setActionLoading(true);

    try {
      const res = await fetch(`${apiUrl}/admin/compliance/deletions/${requestId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      const body = await res.json();

      if (res.ok) {
        showNotification('Deletion request cancelled successfully.', 'success');
        await fetchDeletions(token);
      } else {
        showNotification(body.message || 'Failed to cancel deletion request.', 'error');
      }
    } catch (err) {
      showNotification('Error cancelling deletion request.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Save/Upsert retention policy
  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !policyForm.orgId) return;
    setActionLoading(true);

    try {
      const res = await fetch(`${apiUrl}/admin/compliance/retention-policies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(policyForm),
      });

      if (res.ok) {
        showNotification('Retention policy updated successfully.', 'success');
        await fetchPolicies(token);
      } else {
        const body = await res.json();
        showNotification(body.message || 'Failed to save policy.', 'error');
      }
    } catch (err) {
      showNotification('Error saving retention policy.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <h3>Loading Compliance Console...</h3>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
      {/* Header */}
      <div>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold' }}>Compliance & Audit Control</h2>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', marginTop: '4px' }}>
          Govern audit log retention timelines, monitor export requests, and cancel deletion grace periods.
        </p>
      </div>

      {/* Notifications banner */}
      {notification && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '8px',
          backgroundColor: notification.type === 'success' ? 'var(--color-success-glow)' : 'var(--color-error-glow)',
          border: `1px solid ${notification.type === 'success' ? 'var(--color-success)' : 'var(--color-error)'}`,
          color: '#ffffff',
          fontSize: '14px',
        }}>
          {notification.message}
        </div>
      )}

      {/* Tabs Menu */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={() => setActiveTab('requests')}
          style={{
            padding: '12px 16px',
            border: 'none',
            background: 'none',
            color: activeTab === 'requests' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            borderBottom: activeTab === 'requests' ? '2px solid var(--color-primary)' : '2px solid transparent',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Compliance Requests
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          style={{
            padding: '12px 16px',
            border: 'none',
            background: 'none',
            color: activeTab === 'audit' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            borderBottom: activeTab === 'audit' ? '2px solid var(--color-primary)' : '2px solid transparent',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Audit Log Registry
        </button>
        <button
          onClick={() => setActiveTab('retention')}
          style={{
            padding: '12px 16px',
            border: 'none',
            background: 'none',
            color: activeTab === 'retention' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            borderBottom: activeTab === 'retention' ? '2px solid var(--color-primary)' : '2px solid transparent',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Retention Policies
        </button>
      </div>

      {/* --- TAB 1: Requests --- */}
      {activeTab === 'requests' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          {/* Exports Table */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', color: '#f4f4f7' }}>Data Export Requests</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'var(--color-text-muted)' }}>
                    <th style={{ padding: '10px' }}>User ID</th>
                    <th style={{ padding: '10px' }}>Status</th>
                    <th style={{ padding: '10px' }}>Requested At</th>
                    <th style={{ padding: '10px' }}>Url</th>
                  </tr>
                </thead>
                <tbody>
                  {exports.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        No export requests logged.
                      </td>
                    </tr>
                  ) : (
                    exports.map((req) => (
                      <tr key={req.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>{req.userId}</td>
                        <td style={{ padding: '10px' }}>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: req.status === 'COMPLETED' ? 'var(--color-success-glow)' : 'rgba(255,255,255,0.05)',
                            color: req.status === 'COMPLETED' ? 'var(--color-success)' : '#eab308',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}>
                            {req.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px' }}>{new Date(req.requestedAt).toLocaleDateString()}</td>
                        <td style={{ padding: '10px' }}>
                          {req.downloadUrl ? (
                            <a href={req.downloadUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                              Download link
                            </a>
                          ) : (
                            'N/A'
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Deletions Table */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', color: '#f4f4f7' }}>Account Deletions</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'var(--color-text-muted)' }}>
                    <th style={{ padding: '10px' }}>User ID</th>
                    <th style={{ padding: '10px' }}>Status</th>
                    <th style={{ padding: '10px' }}>Scheduled Date</th>
                    <th style={{ padding: '10px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {deletions.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        No deletion requests active.
                      </td>
                    </tr>
                  ) : (
                    deletions.map((req) => (
                      <tr key={req.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>{req.userId}</td>
                        <td style={{ padding: '10px' }}>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: req.status === 'GRACE' ? 'var(--color-error-glow)' : 'rgba(255,255,255,0.05)',
                            color: req.status === 'GRACE' ? 'var(--color-error)' : 'var(--color-text-secondary)',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}>
                            {req.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px' }}>{new Date(req.scheduledAt).toLocaleDateString()}</td>
                        <td style={{ padding: '10px' }}>
                          {req.status === 'GRACE' ? (
                            <button
                              disabled={actionLoading}
                              onClick={() => handleCancelDeletion(req.id)}
                              style={{
                                backgroundColor: 'var(--color-error-glow)',
                                color: 'var(--color-error)',
                                border: '1px solid var(--color-error)',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                cursor: 'pointer',
                              }}
                            >
                              Cancel
                            </button>
                          ) : (
                            'N/A'
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* --- TAB 2: Audit Logs --- */}
      {activeTab === 'audit' && (
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Filters Form */}
          <form onSubmit={handleFilterSubmit} style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '12px',
            alignItems: 'end',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            paddingBottom: '20px',
          }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>User ID</label>
              <input
                type="text"
                value={auditFilters.userId}
                onChange={(e) => setAuditFilters((prev) => ({ ...prev, userId: e.target.value }))}
                style={{ width: '100%', padding: '8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Actor Type</label>
              <select
                value={auditFilters.actorType}
                onChange={(e) => setAuditFilters((prev) => ({ ...prev, actorType: e.target.value }))}
                style={{ width: '100%', padding: '8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff' }}
              >
                <option value="">All</option>
                <option value="USER">USER</option>
                <option value="SYSTEM">SYSTEM</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Action</label>
              <input
                type="text"
                value={auditFilters.action}
                onChange={(e) => setAuditFilters((prev) => ({ ...prev, action: e.target.value }))}
                style={{ width: '100%', padding: '8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Resource Type</label>
              <input
                type="text"
                value={auditFilters.resourceType}
                onChange={(e) => setAuditFilters((prev) => ({ ...prev, resourceType: e.target.value }))}
                style={{ width: '100%', padding: '8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Org ID</label>
              <input
                type="text"
                value={auditFilters.orgId}
                onChange={(e) => setAuditFilters((prev) => ({ ...prev, orgId: e.target.value }))}
                style={{ width: '100%', padding: '8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>Start Date</label>
              <input
                type="date"
                value={auditFilters.startDate}
                onChange={(e) => setAuditFilters((prev) => ({ ...prev, startDate: e.target.value }))}
                style={{ width: '100%', padding: '6px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>End Date</label>
              <input
                type="date"
                value={auditFilters.endDate}
                onChange={(e) => setAuditFilters((prev) => ({ ...prev, endDate: e.target.value }))}
                style={{ width: '100%', padding: '6px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="submit"
                style={{
                  backgroundColor: 'var(--color-primary)',
                  color: '#fff',
                  border: 'none',
                  padding: '9px 16px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Filter
              </button>
              <button
                type="button"
                onClick={handleExportCSV}
                style={{
                  backgroundColor: '#ffffff',
                  color: '#0a0a0c',
                  border: 'none',
                  padding: '9px 16px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Export CSV
              </button>
            </div>
          </form>

          {/* Audit Logs Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'var(--color-text-muted)' }}>
                  <th style={{ padding: '10px' }}>Actor ID</th>
                  <th style={{ padding: '10px' }}>Actor Type</th>
                  <th style={{ padding: '10px' }}>Action</th>
                  <th style={{ padding: '10px' }}>Resource</th>
                  <th style={{ padding: '10px' }}>IP</th>
                  <th style={{ padding: '10px' }}>User Agent</th>
                  <th style={{ padding: '10px' }}>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                      No audit logs match filters.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>{log.actorId}</td>
                      <td style={{ padding: '10px' }}>{log.actorType}</td>
                      <td style={{ padding: '10px', fontWeight: 500 }}>{log.action}</td>
                      <td style={{ padding: '10px' }}>{log.resourceType} {log.resourceId && `(${log.resourceId})`}</td>
                      <td style={{ padding: '10px' }}>{log.ip || 'N/A'}</td>
                      <td style={{ padding: '10px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {log.userAgent || 'N/A'}
                      </td>
                      <td style={{ padding: '10px' }}>{new Date(log.createdAt).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Cursor Pagination controls */}
          <div style={{ display: 'flex', justifySelf: 'flex-end', gap: '8px', alignSelf: 'flex-end', marginTop: '10px' }}>
            <button
              onClick={handlePrevPage}
              disabled={cursorsHistory.length === 0}
              style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.1)',
                padding: '6px 12px',
                borderRadius: '6px',
                cursor: cursorsHistory.length === 0 ? 'not-allowed' : 'pointer',
                opacity: cursorsHistory.length === 0 ? 0.5 : 1,
              }}
            >
              Previous Page
            </button>
            <button
              onClick={handleNextPage}
              disabled={!nextCursor}
              style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.1)',
                padding: '6px 12px',
                borderRadius: '6px',
                cursor: !nextCursor ? 'not-allowed' : 'pointer',
                opacity: !nextCursor ? 0.5 : 1,
              }}
            >
              Next Page
            </button>
          </div>
        </div>
      )}

      {/* --- TAB 3: Retention Policies --- */}
      {activeTab === 'retention' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr', gap: '24px' }}>
          {/* Policies Save Form */}
          <form onSubmit={handleSavePolicy} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h3 style={{ fontSize: '18px', color: '#f4f4f7' }}>Configure Retention Settings</h3>
            <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
              Assign how long organizations keep vector text indexes and raw compliance event history logs.
            </p>

            <div>
              <label style={{ display: 'block', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
                Select Organization
              </label>
              <select
                value={policyForm.orgId}
                onChange={(e) => {
                  const oId = e.target.value;
                  const activePolicy = policies.find(p => p.orgId === oId);
                  setPolicyForm({
                    orgId: oId,
                    auditRetentionDays: activePolicy?.auditRetentionDays ?? 90,
                    dataRetentionDays: activePolicy?.dataRetentionDays ?? 365,
                  });
                }}
                required
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  color: '#fff',
                }}
              >
                <option value="">-- Choose Organization --</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name} ({org.id})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
                <span>Audit Logs Retention (Days)</span>
                <strong style={{ color: 'var(--color-primary)' }}>{policyForm.auditRetentionDays} Days</strong>
              </div>
              <input
                type="range"
                min={30}
                max={730}
                step={5}
                value={policyForm.auditRetentionDays}
                onChange={(e) => setPolicyForm(prev => ({ ...prev, auditRetentionDays: Number(e.target.value) }))}
                style={{ width: '100%', accentColor: 'var(--color-primary)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                <span>Min: 30 days</span>
                <span>Max: 2 years (730d)</span>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
                <span>Platform Data Retention (Days)</span>
                <strong style={{ color: 'var(--color-secondary)' }}>{policyForm.dataRetentionDays} Days</strong>
              </div>
              <input
                type="range"
                min={90}
                max={1825}
                step={10}
                value={policyForm.dataRetentionDays}
                onChange={(e) => setPolicyForm(prev => ({ ...prev, dataRetentionDays: Number(e.target.value) }))}
                style={{ width: '100%', accentColor: 'var(--color-secondary)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                <span>Min: 90 days</span>
                <span>Max: 5 years (1825d)</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={actionLoading || !policyForm.orgId}
              style={{
                backgroundColor: 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                padding: '12px',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '14px',
                cursor: actionLoading || !policyForm.orgId ? 'not-allowed' : 'pointer',
              }}
            >
              {actionLoading ? 'Saving Settings...' : 'Save Retention Policy'}
            </button>
          </form>

          {/* Policies Registry List */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', color: '#f4f4f7' }}>Retention Policy Registry</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'var(--color-text-muted)' }}>
                    <th style={{ padding: '10px' }}>Organization</th>
                    <th style={{ padding: '10px' }}>Audit Days</th>
                    <th style={{ padding: '10px' }}>Data Days</th>
                    <th style={{ padding: '10px' }}>Updated By</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        No retention policies defined.
                      </td>
                    </tr>
                  ) : (
                    policies.map((p) => (
                      <tr key={p.orgId} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '10px' }}>
                          <strong>{p.organization?.name || 'Unknown'}</strong>
                          <span style={{ display: 'block', fontSize: '10px', color: 'var(--color-text-muted)' }}>{p.orgId}</span>
                        </td>
                        <td style={{ padding: '10px' }}>{p.auditRetentionDays}d</td>
                        <td style={{ padding: '10px' }}>{p.dataRetentionDays}d</td>
                        <td style={{ padding: '10px', whiteSpace: 'nowrap' }}>{p.updatedBy}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface ConsentStatus {
  TERMS: boolean;
  PRIVACY: boolean;
  MARKETING: boolean;
}

interface ExportStatus {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
  requestedAt: string;
  expiresAt?: string;
  downloadUrl?: string;
}

interface DeletionStatus {
  id: string;
  status: 'PENDING' | 'GRACE' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  requestedAt: string;
  scheduledAt: string;
}

export default function PrivacyDashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Data states
  const [consent, setConsent] = useState<ConsentStatus>({
    TERMS: true,
    PRIVACY: true,
    MARKETING: false,
  });
  const [exportRequest, setExportRequest] = useState<ExportStatus | null>(null);
  const [deletionRequest, setDeletionRequest] = useState<DeletionStatus | null>(null);

  // UI state
  const [actionLoading, setActionLoading] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

  // Load token and fetch initial data
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    if (savedToken) {
      setToken(savedToken);
      fetchData(savedToken);
    } else {
      setLoading(false);
    }
  }, []);

  const fetchData = async (authToken: string) => {
    setLoading(true);
    try {
      await Promise.all([
        fetchConsent(authToken),
        fetchExportStatus(authToken),
        fetchDeletionStatus(authToken),
      ]);
    } catch (err) {
      console.error('Error fetching privacy data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchConsent = async (authToken: string) => {
    try {
      const res = await fetch(`${apiUrl}/compliance/consent`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConsent(data);
      }
    } catch (err) {
      console.error('Error fetching consent:', err);
    }
  };

  const fetchExportStatus = async (authToken: string) => {
    try {
      const res = await fetch(`${apiUrl}/compliance/export/status`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setExportRequest(data);
      }
    } catch (err) {
      console.error('Error fetching export status:', err);
    }
  };

  const fetchDeletionStatus = async (authToken: string) => {
    try {
      const res = await fetch(`${apiUrl}/compliance/delete-account/status`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDeletionRequest(data);
      }
    } catch (err) {
      console.error('Error fetching deletion status:', err);
    }
  };

  // Toggle consent (marketing toggle)
  const handleConsentToggle = async (type: 'MARKETING') => {
    if (!token) return;
    setActionLoading(true);
    const newValue = !consent[type];

    try {
      const res = await fetch(`${apiUrl}/compliance/consent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ consentType: type, accepted: newValue }),
      });

      if (res.ok) {
        setConsent((prev) => ({ ...prev, [type]: newValue }));
        showNotification(`Consent preference updated for ${type}.`, 'success');
      } else {
        showNotification('Failed to update consent preferences.', 'error');
      }
    } catch (err) {
      showNotification('Error updating consent preferences.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Submit data export request
  const handleRequestExport = async () => {
    if (!token) return;
    setActionLoading(true);

    try {
      const res = await fetch(`${apiUrl}/compliance/export`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();

      if (res.ok) {
        showNotification(data.message || 'Export request submitted. Check your email.', 'success');
        await fetchExportStatus(token);
      } else {
        showNotification(data.message || 'Failed to request data export.', 'error');
      }
    } catch (err) {
      showNotification('Error requesting data export.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Submit account deletion request
  const handleDeleteAccount = async () => {
    if (!token || deleteConfirmText !== 'DELETE') return;
    setActionLoading(true);
    setIsDeleteModalOpen(false);

    try {
      const res = await fetch(`${apiUrl}/compliance/delete-account`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();

      if (res.ok) {
        showNotification(
          'Account deletion grace period started. You can cancel this within 30 days.',
          'success',
        );
        await fetchDeletionStatus(token);
      } else {
        showNotification(data.message || 'Failed to request account deletion.', 'error');
      }
    } catch (err) {
      showNotification('Error requesting account deletion.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Cancel account deletion request
  const handleCancelDeletion = async (requestId: string) => {
    if (!token) return;
    setActionLoading(true);

    try {
      const res = await fetch(`${apiUrl}/compliance/delete-account/${requestId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();

      if (res.ok) {
        showNotification('Account deletion request cancelled successfully.', 'success');
        await fetchDeletionStatus(token);
      } else {
        showNotification(data.message || 'Failed to cancel deletion request.', 'error');
      }
    } catch (err) {
      showNotification('Error cancelling deletion request.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Feedback notifications helper
  const showNotification = (message: string, type: 'success' | 'error' | 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0c', color: '#9496a8' }}>
        <div className="glass-panel" style={{ textAlign: 'center' }}>
          <h2>Loading Privacy settings...</h2>
          <p style={{ marginTop: '10px' }}>Fetching current consent and request logs.</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0c', color: '#9496a8' }}>
        <div className="glass-panel" style={{ textAlign: 'center' }}>
          <h2>Session Required</h2>
          <p style={{ marginTop: '10px' }}>Please log in to access your privacy control panel.</p>
        </div>
      </div>
    );
  }

  const isGraceActive = deletionRequest && deletionRequest.status === 'GRACE';

  return (
    <main style={{
      padding: '40px 20px',
      maxWidth: '1200px',
      margin: '0 auto',
      position: 'relative',
      zIndex: 10,
    }}>
      {/* Background glow elements */}
      <div className="bg-glow-1"></div>
      <div className="bg-glow-2"></div>

      {/* Toast Alert Banner */}
      {notification && (
        <div style={{
          position: 'fixed',
          top: '24px',
          right: '24px',
          padding: '16px 24px',
          borderRadius: '12px',
          backgroundColor: notification.type === 'success' ? 'var(--color-success-glow)' : notification.type === 'error' ? 'var(--color-error-glow)' : 'rgba(255,255,255,0.08)',
          border: `1px solid ${notification.type === 'success' ? 'var(--color-success)' : notification.type === 'error' ? 'var(--color-error)' : 'rgba(255,255,255,0.15)'}`,
          color: '#f4f4f7',
          zIndex: 1000,
          boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
        }}>
          <span>{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            style={{ background: 'none', border: 'none', color: '#9496a8', cursor: 'pointer', fontWeight: 'bold' }}
          >
            ×
          </button>
        </div>
      )}

      {/* Header */}
      <header style={{ marginBottom: '40px' }}>
        <Link href="/" style={{
          color: 'var(--color-primary)',
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: '0.9rem',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '16px'
        }}>
          ← Back to Dashboard
        </Link>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 700, marginBottom: '8px' }}>
          Privacy & Personal Data Controls
        </h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Manage your marketing consents, request backups, or schedule account deletion grace periods.
        </p>
      </header>

      {/* Grid Dashboard */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '24px',
        alignItems: 'start'
      }}>
        {/* Consent Section */}
        <section className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h2 style={{ fontSize: '1.25rem', color: '#f4f4f7', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px' }}>
            Consent Preferences
          </h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
            We require mandatory agreements to host study files and construct knowledge graphs.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h4 style={{ fontSize: '0.95rem' }}>Terms of Service</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Required to use study platform features</p>
              </div>
              <input type="checkbox" checked disabled style={{ width: '20px', height: '20px', accentColor: 'var(--color-primary)' }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h4 style={{ fontSize: '0.95rem' }}>Privacy Agreement</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Required for compliance vector storage</p>
              </div>
              <input type="checkbox" checked disabled style={{ width: '20px', height: '20px', accentColor: 'var(--color-primary)' }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '16px' }}>
              <div>
                <h4 style={{ fontSize: '0.95rem' }}>Marketing Communications</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Receive study summary updates & tips</p>
              </div>
              <button
                disabled={actionLoading}
                onClick={() => handleConsentToggle('MARKETING')}
                style={{
                  width: '50px',
                  height: '26px',
                  borderRadius: '13px',
                  backgroundColor: consent.MARKETING ? 'var(--color-primary)' : '#272730',
                  border: 'none',
                  position: 'relative',
                  cursor: actionLoading ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.2s',
                }}
              >
                <div style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  backgroundColor: '#ffffff',
                  position: 'absolute',
                  top: '3px',
                  left: consent.MARKETING ? '27px' : '3px',
                  transition: 'left 0.2s',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                }} />
              </button>
            </div>
          </div>
        </section>

        {/* Data Export Section */}
        <section className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h2 style={{ fontSize: '1.25rem', color: '#f4f4f7', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px' }}>
            Data Export & Backup
          </h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
            Request a complete copy of your profile, quiz attempts, study materials metadata, and chats.
          </p>

          {exportRequest ? (
            <div style={{
              backgroundColor: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: '8px',
              padding: '16px',
              fontSize: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>Status: </span>
                <span style={{
                  fontWeight: 600,
                  color: exportRequest.status === 'COMPLETED' ? 'var(--color-success)' : exportRequest.status === 'PENDING' || exportRequest.status === 'PROCESSING' ? '#eab308' : 'var(--color-error)'
                }}>
                  {exportRequest.status}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>Requested: </span>
                <span>{new Date(exportRequest.requestedAt).toLocaleString()}</span>
              </div>
              {exportRequest.expiresAt && (
                <div>
                  <span style={{ color: 'var(--color-text-muted)' }}>Expires: </span>
                  <span>{new Date(exportRequest.expiresAt).toLocaleString()}</span>
                </div>
              )}

              {exportRequest.status === 'COMPLETED' && exportRequest.downloadUrl && (
                <a
                  href={exportRequest.downloadUrl}
                  download
                  style={{
                    display: 'inline-block',
                    textAlign: 'center',
                    marginTop: '8px',
                    textDecoration: 'none',
                    color: '#0a0a0c',
                    backgroundColor: '#ffffff',
                    fontWeight: 600,
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    transition: 'opacity 0.2s',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.opacity = '0.9')}
                  onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
                >
                  Download ZIP Archive
                </a>
              )}
            </div>
          ) : (
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '12px' }}>
              No recent export requests logged.
            </div>
          )}

          <button
            disabled={actionLoading}
            onClick={handleRequestExport}
            style={{
              width: '100%',
              backgroundColor: 'var(--color-primary)',
              color: '#ffffff',
              border: 'none',
              padding: '12px',
              borderRadius: '8px',
              fontWeight: 600,
              cursor: actionLoading ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.2s',
            }}
            onMouseOver={(e) => !actionLoading && (e.currentTarget.style.backgroundColor = '#4f46e5')}
            onMouseOut={(e) => !actionLoading && (e.currentTarget.style.backgroundColor = 'var(--color-primary)')}
          >
            {actionLoading ? 'Scheduling...' : 'Request New Export'}
          </button>
        </section>

        {/* Data Deletion Section */}
        <section className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h2 style={{ fontSize: '1.25rem', color: '#f4f4f7', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px' }}>
            Account Deletion
          </h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
            Permanently wipe your profile and vector point embeddings. This includes a 30-day grace cancellation window.
          </p>

          {isGraceActive ? (
            <div style={{
              backgroundColor: 'var(--color-error-glow)',
              border: '1px solid var(--color-error)',
              borderRadius: '8px',
              padding: '16px',
              fontSize: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}>
              <div>
                <h4 style={{ color: 'var(--color-error)', fontWeight: 600, marginBottom: '4px' }}>Deletion Grace Active</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-primary)' }}>
                  Your account is scheduled to be permanently deleted on:
                </p>
                <strong style={{ display: 'block', margin: '4px 0', fontSize: '0.95rem' }}>
                  {new Date(deletionRequest!.scheduledAt).toLocaleDateString()}
                </strong>
              </div>
              <button
                disabled={actionLoading}
                onClick={() => handleCancelDeletion(deletionRequest!.id)}
                style={{
                  width: '100%',
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  color: '#ffffff',
                  border: '1px solid rgba(255,255,255,0.2)',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  cursor: actionLoading ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.2s',
                }}
                onMouseOver={(e) => !actionLoading && (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.15)')}
                onMouseOut={(e) => !actionLoading && (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')}
              >
                Cancel Deletion Request
              </button>
            </div>
          ) : (
            <button
              disabled={actionLoading}
              onClick={() => setIsDeleteModalOpen(true)}
              style={{
                width: '100%',
                backgroundColor: 'var(--color-error-glow)',
                color: 'var(--color-error)',
                border: '1px solid var(--color-error)',
                padding: '12px',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: actionLoading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseOver={(e) => !actionLoading && (e.currentTarget.style.backgroundColor = 'var(--color-error)', e.currentTarget.style.color = '#ffffff')}
              onMouseOut={(e) => !actionLoading && (e.currentTarget.style.backgroundColor = 'var(--color-error-glow)', e.currentTarget.style.color = 'var(--color-error)')}
            >
              Delete Account
            </button>
          )}
        </section>
      </div>

      {/* Confirmation Modal */}
      {isDeleteModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(8px)',
        }}>
          <div className="glass-panel" style={{ maxWidth: '450px', width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h3 style={{ fontSize: '1.4rem', color: 'var(--color-error)' }}>Confirm Account Deletion</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', lineHeight: '1.5' }}>
              Warning: This schedules your account to be anonymized and all study files, progress tracks, and vector embeddings to be permanently destroyed in 30 days.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                Please type <strong style={{ color: '#ffffff' }}>DELETE</strong> below to confirm.
              </span>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  color: '#ffffff',
                  fontSize: '1rem',
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setDeleteConfirmText('');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                disabled={deleteConfirmText !== 'DELETE'}
                onClick={handleDeleteAccount}
                style={{
                  backgroundColor: 'var(--color-error)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '8px',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  cursor: deleteConfirmText === 'DELETE' ? 'pointer' : 'not-allowed',
                  opacity: deleteConfirmText === 'DELETE' ? 1 : 0.5,
                }}
              >
                Confirm Deletion
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

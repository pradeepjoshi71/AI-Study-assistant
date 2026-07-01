'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { StudyGroup, Document } from './types';

interface Props {
  initialGroups: StudyGroup[];
  documents: Document[];
  token: string;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export default function GroupsClient({ initialGroups, documents, token }: Props) {
  const [groups, setGroups] = useState<StudyGroup[]>(initialGroups);
  const [showModal, setShowModal] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [maxMembers, setMaxMembers] = useState(10);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Handle doc selection
  function toggleDoc(docId: string) {
    setSelectedDocs(prev => {
      const next = new Set(prev);
      next.has(docId) ? next.delete(docId) : next.add(docId);
      return next;
    });
  }

  // Handle create submit
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError('');

    try {
      // 1. Create Group
      const res = await fetch(`${apiUrl}/groups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          visibility,
          maxMembers,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Failed to create group');
      }

      const newGroup = await res.json() as StudyGroup;

      // 2. Add selected documents sequentially
      if (selectedDocs.size > 0) {
        for (const docId of selectedDocs) {
          await fetch(`${apiUrl}/groups/${newGroup.id}/docs`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ docId }),
          });
        }
      }

      // 3. Refresh list and reset form
      setGroups(prev => [
        {
          ...newGroup,
          _count: { members: 1, sessions: 0, documents: selectedDocs.size },
        },
        ...prev,
      ]);
      setShowModal(false);
      setName('');
      setVisibility('PUBLIC');
      setSelectedDocs(new Set());
      setMaxMembers(10);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '40px 20px', minHeight: '100vh' }}>
      
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
        <div>
          <h1 style={{
            fontSize: '2rem', fontFamily: 'var(--font-display)', fontWeight: 700,
            background: 'linear-gradient(135deg, #ffffff 30%, #a5a6c2 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
          }}>
            Collaborative Study Groups
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', marginTop: '4px' }}>
            Work together, share reference documents, and study with an active AI assistant.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{
            padding: '12px 24px', borderRadius: 12, border: 'none', fontWeight: 600, fontSize: '0.95rem',
            background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', color: '#fff',
            cursor: 'pointer', boxShadow: '0 4px 20px rgba(99,102,241,0.3)', transition: 'transform 0.2s',
          }}
        >
          + Create Group
        </button>
      </header>

      {/* Grid List */}
      {groups.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '60px 40px', color: 'var(--color-text-muted)' }}>
          <span style={{ fontSize: '2.5rem', display: 'block', marginBottom: 16 }}>👥</span>
          <h3>No study groups found</h3>
          <p style={{ marginTop: 8, fontSize: '0.9rem' }}>
            You haven't joined or created any groups in this organization yet. Click the button above to start one!
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
          {groups.map(g => (
            <Link key={g.id} href={`/dashboard/groups/${g.id}`} style={{ textDecoration: 'none' }}>
              <div className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{
                      fontSize: '0.72rem', fontWeight: 700, padding: '4px 10px', borderRadius: 6,
                      background: g.visibility === 'PUBLIC' ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)',
                      color: g.visibility === 'PUBLIC' ? '#34d399' : '#fb7185',
                    }}>
                      {g.visibility}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                      Created {new Date(g.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 style={{ color: '#fff', fontSize: '1.2rem', fontWeight: 600, marginBottom: 8 }}>{g.name}</h3>
                </div>
                <div style={{ display: 'flex', gap: 16, marginTop: 24, fontSize: '0.85rem', color: 'var(--color-text-secondary)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 14 }}>
                  <span>👥 {g._count?.members || 1} members</span>
                  <span>📄 {g._count?.documents || 0} docs</span>
                  <span>⏱ {g._count?.sessions || 0} sessions</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* ── CREATE MODAL ─────────────────────────────────────────────────── */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: 20
        }}>
          <div className="glass-panel" style={{ maxWidth: 540, width: '100%', padding: '36px 40px', overflowY: 'auto', maxHeight: '90vh' }}>
            <h2 style={{ fontSize: '1.5rem', color: '#fff', marginBottom: 24 }}>Create Study Group</h2>
            
            {error && (
              <div style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 10, padding: 12, marginBottom: 20, color: '#f87171', fontSize: '0.88rem' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleCreate}>
              {/* Group Name */}
              <label style={labelStyle}>Group Name</label>
              <input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Calculus BC Study Room"
                style={inputStyle}
              />

              {/* Visibility */}
              <label style={{ ...labelStyle, marginTop: 20 }}>Privacy Visibility</label>
              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                {['PUBLIC', 'PRIVATE'].map(v => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVisibility(v as any)}
                    style={{
                      flex: 1, padding: '12px 16px', borderRadius: 10, cursor: 'pointer',
                      background: visibility === v ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)',
                      border: `1.5px solid ${visibility === v ? '#6366f1' : 'rgba(255,255,255,0.07)'}`,
                      color: visibility === v ? '#a5b4fc' : 'var(--color-text-secondary)',
                      fontWeight: 600, fontSize: '0.9rem', transition: 'all 0.15s'
                    }}
                  >
                    {v === 'PUBLIC' ? '🔓 Public (Auto-join)' : '🔒 Private (Invite only)'}
                  </button>
                ))}
              </div>

              {/* Max Members */}
              <label style={labelStyle}>Max Members</label>
              <input
                type="number"
                min={2}
                max={100}
                value={maxMembers}
                onChange={e => setMaxMembers(Number(e.target.value))}
                style={inputStyle}
              />

              {/* Documents Selector */}
              <label style={{ ...labelStyle, marginTop: 20 }}>Share Documents ({selectedDocs.size} selected)</label>
              <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24, paddingRight: 4 }}>
                {documents.map(d => {
                  const checked = selectedDocs.has(d.id);
                  return (
                    <label key={d.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                      background: checked ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${checked ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)'}`,
                      transition: 'all 0.15s'
                    }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDoc(d.id)}
                        style={{ accentColor: '#6366f1', width: 16, height: 16 }}
                      />
                      <span style={{ fontSize: '0.88rem', color: checked ? '#e0e0ff' : 'var(--color-text-secondary)' }}>
                        📄 {d.title}
                      </span>
                    </label>
                  );
                })}
                {documents.length === 0 && (
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No documents available. Upload in Document Manager first.</p>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 20 }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    padding: '10px 20px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: 'none',
                    color: 'var(--color-text-secondary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    padding: '10px 24px', borderRadius: 10, background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', border: 'none',
                    color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
                    boxShadow: '0 4px 16px rgba(99,102,241,0.3)', opacity: loading ? 0.6 : 1
                  }}
                >
                  {loading ? 'Creating...' : 'Create Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text-secondary)',
  marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em'
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 16px', borderRadius: 10, marginBottom: 8,
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
  color: '#fff', fontSize: '0.95rem', outline: 'none'
};

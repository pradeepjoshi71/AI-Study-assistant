'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { io, Socket } from 'socket.io-client';
import type { StudyGroup, Document } from '../types';

interface Props {
  groupId: string;
  initialGroup: StudyGroup;
  allDocuments: Document[];
  token: string;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001/mobile/ws';

export default function GroupDetailsClient({ groupId, initialGroup, allDocuments, token }: Props) {
  const router = useRouter();
  const [group, setGroup] = useState<StudyGroup>(initialGroup);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  
  // Controls
  const [showAddDoc, setShowAddDoc] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionType, setSessionType] = useState<'STUDY' | 'QUIZ' | 'EXAM_PREP'>('STUDY');
  const [showSessionModal, setShowSessionModal] = useState(false);

  const socketRef = useRef<Socket | null>(null);

  const myUserId = group.members?.find(m => m.user.email === parseJwt(token)?.email)?.userId || 'unknown';
  const isLeader = group.members?.find(m => m.userId === myUserId)?.role === 'LEADER';

  // ── JWT Helper ──────────────────────────────────────────────────────────────
  function parseJwt(tok: string) {
    try {
      return JSON.parse(atob(tok.split('.')[1]));
    } catch {
      return {};
    }
  }

  // ── WebSocket Presence ──────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(wsUrl, {
      query: { token },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      // Join presence room
      socket.emit('group:join', { groupId });
    });

    socket.on('group:presence', (data: { groupId: string; members: string[] }) => {
      if (data.groupId === groupId) {
        setOnlineUsers(new Set(data.members));
      }
    });

    // Heartbeat every 20s
    const heartbeat = setInterval(() => {
      socket.emit('group:ping');
    }, 20_000);

    return () => {
      clearInterval(heartbeat);
      socket.disconnect();
    };
  }, [groupId, token]);

  // ── Documents ────────────────────────────────────────────────────────────────
  async function addDocument(docId: string) {
    try {
      const res = await fetch(`${apiUrl}/groups/${groupId}/docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ docId }),
      });
      if (res.ok) {
        const added = await res.json();
        const fullDoc = allDocuments.find(d => d.id === docId);
        if (fullDoc) {
          setGroup(prev => ({
            ...prev,
            documents: [...(prev.documents || []), { ...added, document: fullDoc }],
          }));
        }
        setShowAddDoc(false);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function removeDocument(docId: string) {
    try {
      const res = await fetch(`${apiUrl}/groups/${groupId}/docs/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setGroup(prev => ({
          ...prev,
          documents: (prev.documents || []).filter(d => d.docId !== docId),
        }));
      }
    } catch (err) {
      console.error(err);
    }
  }

  // ── Sessions ─────────────────────────────────────────────────────────────────
  async function handleCreateSession(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionTitle.trim()) return;

    try {
      const res = await fetch(`${apiUrl}/groups/${groupId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: sessionTitle.trim(), sessionType }),
      });

      if (res.ok) {
        const newSession = await res.json();
        setGroup(prev => ({
          ...prev,
          sessions: [newSession, ...(prev.sessions || [])],
        }));
        setShowSessionModal(false);
        setSessionTitle('');
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function startSession(sessionId: string) {
    try {
      const res = await fetch(`${apiUrl}/groups/${groupId}/sessions/${sessionId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        router.push(`/dashboard/groups/${groupId}/session/${sessionId}`);
      }
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '40px 20px', minHeight: '100vh' }}>
      
      {/* Top back button */}
      <Link href="/dashboard/groups" style={{ color: 'var(--color-text-secondary)', textDecoration: 'none', display: 'inline-block', marginBottom: 20 }}>
        ← Back to Study Groups
      </Link>

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: '2rem', color: '#fff', fontWeight: 700 }}>{group.name}</h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', marginTop: 4 }}>
            Visibility: {group.visibility} · Limit: {group.maxMembers} members
          </p>
        </div>
        
        {isLeader && (
          <button
            onClick={() => setShowSessionModal(true)}
            style={{
              padding: '12px 24px', borderRadius: 12, border: 'none', fontWeight: 600, fontSize: '0.95rem',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: '#fff',
              cursor: 'pointer', boxShadow: '0 4px 20px rgba(16,185,129,0.3)',
            }}
          >
            + Schedule Session
          </button>
        )}
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 32 }}>
        {/* Left Column: Sessions & Docs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          
          {/* Active / Past Sessions */}
          <div className="glass-panel">
            <h2 style={{ fontSize: '1.25rem', color: '#fff', marginBottom: 20 }}>Study Sessions</h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {group.sessions?.map(s => {
                const isActive = s.status === 'ACTIVE';
                const isEnded = s.status === 'ENDED';
                return (
                  <div key={s.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '16px 20px', borderRadius: 12, background: 'rgba(255,255,255,0.02)',
                    border: `1px solid ${isActive ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.05)'}`,
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{
                          fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                          background: isActive ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
                          color: isActive ? '#34d399' : 'var(--color-text-muted)',
                        }}>
                          {s.status}
                        </span>
                        <h4 style={{ color: '#fff', margin: 0 }}>{s.title}</h4>
                      </div>
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                        Type: {s.sessionType} · Scheduled {new Date(s.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <div>
                      {isActive && (
                        <Link href={`/dashboard/groups/${groupId}/session/${s.id}`} style={{
                          padding: '8px 16px', borderRadius: 8, background: '#10b981', color: '#fff',
                          fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none', display: 'inline-block'
                        }}>
                          Join Live Room
                        </Link>
                      )}
                      {!isActive && !isEnded && isLeader && (
                        <button onClick={() => startSession(s.id)} style={{
                          padding: '8px 16px', borderRadius: 8, background: '#6366f1', color: '#fff',
                          fontWeight: 600, fontSize: '0.85rem', border: 'none', cursor: 'pointer'
                        }}>
                          Start Session
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {group.sessions?.length === 0 && (
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '20px 0' }}>No study sessions scheduled yet.</p>
              )}
            </div>
          </div>

          {/* Shared Documents */}
          <div className="glass-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: '1.25rem', color: '#fff' }}>Shared Knowledge Base</h2>
              <button onClick={() => setShowAddDoc(v => !v)} style={{
                background: 'none', border: 'none', color: '#a5b4fc', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600
              }}>
                {showAddDoc ? 'Close' : '+ Add Document'}
              </button>
            </div>

            {showAddDoc && (
              <div style={{
                background: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 12, marginBottom: 20,
                border: '1px solid rgba(255,255,255,0.06)'
              }}>
                <h4 style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 12 }}>Select doc to share</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
                  {allDocuments
                    .filter(doc => !group.documents?.some(gd => gd.docId === doc.id))
                    .map(doc => (
                      <button key={doc.id} onClick={() => addDocument(doc.id)} style={{
                        padding: '10px 14px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.04)',
                        color: '#fff', cursor: 'pointer', textAlign: 'left', fontSize: '0.88rem'
                      }}>
                        📄 {doc.title}
                      </button>
                    ))}
                  {allDocuments.filter(doc => !group.documents?.some(gd => gd.docId === doc.id)).length === 0 && (
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>All organization files are already shared.</p>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {group.documents?.map(gd => (
                <div key={gd.docId} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.01)',
                  border: '1px solid rgba(255,255,255,0.04)'
                }}>
                  <span style={{ fontSize: '0.9rem', color: '#fff' }}>📄 {gd.document.title}</span>
                  <button onClick={() => removeDocument(gd.docId)} style={{
                    background: 'none', border: 'none', color: '#fb7185', cursor: 'pointer', fontSize: '0.85rem'
                  }}>
                    Remove
                  </button>
                </div>
              ))}
              {group.documents?.length === 0 && (
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '20px 0' }}>No documents shared with this group.</p>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Members Presence */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          <div className="glass-panel" style={{ height: '100%' }}>
            <h2 style={{ fontSize: '1.25rem', color: '#fff', marginBottom: 20 }}>Study Partners</h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {group.members?.map(m => {
                const online = onlineUsers.has(m.userId);
                return (
                  <div key={m.userId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    {/* Presence Dot */}
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: online ? '#10b981' : 'transparent',
                      border: `2px solid ${online ? '#10b981' : 'rgba(255,255,255,0.15)'}`,
                    }} />
                    
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 600 }}>
                        {m.user.name || m.user.email}
                      </div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                        {m.role}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── CREATE SESSION MODAL ─────────────────────────────────────────── */}
      {showSessionModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: 20
        }}>
          <div className="glass-panel" style={{ maxWidth: 440, width: '100%', padding: '30px 36px' }}>
            <h2 style={{ fontSize: '1.35rem', color: '#fff', marginBottom: 20 }}>Schedule Session</h2>
            
            <form onSubmit={handleCreateSession}>
              <label style={labelStyle}>Session Title</label>
              <input
                required
                value={sessionTitle}
                onChange={e => setSessionTitle(e.target.value)}
                placeholder="e.g. Chapter 4 Review"
                style={inputStyle}
              />

              <label style={{ ...labelStyle, marginTop: 16 }}>Session Mode</label>
              <select
                value={sessionType}
                onChange={e => setSessionType(e.target.value as any)}
                style={selectStyle}
              >
                <option value="STUDY">Study (General)</option>
                <option value="QUIZ">Quiz Prep</option>
                <option value="EXAM_PREP">Exam Cram Session</option>
              </select>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
                <button
                  type="button"
                  onClick={() => setShowSessionModal(false)}
                  style={{
                    padding: '8px 16px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: 'none',
                    color: 'var(--color-text-secondary)', cursor: 'pointer', fontWeight: 600
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '8px 20px', borderRadius: 8, background: '#10b981', border: 'none',
                    color: '#fff', cursor: 'pointer', fontWeight: 600,
                    boxShadow: '0 4px 16px rgba(16,185,129,0.3)'
                  }}
                >
                  Schedule
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
  display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-secondary)',
  marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em'
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 8, marginBottom: 8,
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
  color: '#fff', fontSize: '0.9rem', outline: 'none'
};

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 8,
  background: '#121216', border: '1px solid rgba(255,255,255,0.08)',
  color: '#fff', fontSize: '0.9rem', outline: 'none'
};

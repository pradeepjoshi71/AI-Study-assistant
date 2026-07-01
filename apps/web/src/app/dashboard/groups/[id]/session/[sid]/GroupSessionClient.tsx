'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { io, Socket } from 'socket.io-client';
import type { StudyGroup, GroupSession, GroupMessage, GroupMember, Document } from '../../../types';

interface Props {
  groupId: string;
  sessionId: string;
  group: StudyGroup;
  session: GroupSession;
  initialMessages: GroupMessage[];
  token: string;
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001/mobile/ws';

export default function GroupSessionClient({
  groupId,
  sessionId,
  group,
  session,
  initialMessages,
  token,
}: Props) {
  const router = useRouter();

  const [messages, setMessages] = useState<GroupMessage[]>(initialMessages);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  
  // Chat input states
  const [input, setInput] = useState('');
  const [isAiMode, setIsAiMode] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [aiQueued, setAiQueued] = useState(false);
  const [aiStreamingText, setAiStreamingText] = useState('');

  // Pagination states
  const [cursor, setCursor] = useState<string | null>(
    initialMessages.length > 0 ? initialMessages[initialMessages.length - 1].id : null
  );
  const [hasMore, setHasMore] = useState(initialMessages.length === 50);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Doc viewer states
  const [selectedDocId, setSelectedDocId] = useState<string | null>(
    group.documents && group.documents.length > 0 ? group.documents[0].docId : null
  );
  const [docContent, setDocContent] = useState<string>('');
  const [highlightKeywords, setHighlightKeywords] = useState<string[]>([]);

  // Socket
  const socketRef = useRef<Socket | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const feedContainerRef = useRef<HTMLDivElement>(null);

  // JWT
  const myUserId = parseJwt(token)?.sub || 'unknown';
  const isLeader = group.members?.find(m => m.userId === myUserId)?.role === 'LEADER';

  function parseJwt(tok: string) {
    try {
      return JSON.parse(atob(tok.split('.')[1]));
    } catch {
      return {};
    }
  }

  // ── Session Timer ──────────────────────────────────────────────────────────
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    const start = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
    const timer = setInterval(() => {
      const diff = Date.now() - start;
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setElapsed(`${h > 0 ? h + 'h ' : ''}${m}m ${s}s`);
    }, 1000);

    return () => clearInterval(timer);
  }, [session.startedAt]);

  // ── WebSocket events ────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(wsUrl, {
      query: { token },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('group:join', { groupId });
    });

    // Message
    socket.on('group:message', (msg: GroupMessage) => {
      setMessages(prev => [msg, ...prev]);
      setAiStreamingText('');
      setAiQueued(false);
      scrollToBottom();
    });

    // AI Queued
    socket.on('group:ai_queued', () => {
      setAiQueued(true);
    });

    // AI Streaming chunks
    socket.on('group:ai_chunk', (data: { sessionId: string; token: string }) => {
      if (data.sessionId === sessionId) {
        setAiStreamingText(prev => prev + data.token);
        scrollToBottom();
      }
    });

    // Typing
    socket.on('group:typing', (data: { userId: string; isTyping: boolean }) => {
      setTypingUsers(prev => {
        const next = new Set(prev);
        data.isTyping ? next.add(data.userId) : next.delete(data.userId);
        return next;
      });
    });

    // Presence
    socket.on('group:presence', (data: { groupId: string; members: string[] }) => {
      if (data.groupId === groupId) {
        setOnlineUsers(new Set(data.members));
      }
    });

    // Session Ended
    socket.on('group:session:ended', () => {
      router.push(`/dashboard/groups/${groupId}`);
    });

    // Heartbeat
    const heartbeat = setInterval(() => {
      socket.emit('group:ping');
    }, 20_000);

    return () => {
      clearInterval(heartbeat);
      socket.disconnect();
    };
  }, [groupId, sessionId, token, router]);

  // Scroll to bottom on mount
  useEffect(() => {
    scrollToBottom();
  }, []);

  function scrollToBottom() {
    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }

  // ── Cursor-Paginated Scroll Loader ──────────────────────────────────────────
  async function loadMoreMessages() {
    if (!cursor || !hasMore || loadingHistory) return;
    setLoadingHistory(true);

    try {
      const res = await fetch(
        `${apiUrl}/groups/${groupId}/sessions/${sessionId}/messages?cursor=${cursor}&limit=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const nextMsgs = await res.json() as GroupMessage[];
        if (nextMsgs.length > 0) {
          setMessages(prev => [...prev, ...nextMsgs]);
          setCursor(nextMsgs[nextMsgs.length - 1].id);
          setHasMore(nextMsgs.length === 50);
        } else {
          setHasMore(false);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  }

  function handleFeedScroll(e: React.UIEvent<HTMLDivElement>) {
    // If scroll reaches the top, load more historical messages
    if (e.currentTarget.scrollTop === 0) {
      loadMoreMessages();
    }
  }

  // ── Document Loader ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedDocId) return;

    // Simulate loading document extracted text
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/documents/${selectedDocId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const doc = await res.json();
          // Render plain/parsed text content
          setDocContent(doc.extractedText || 'Extracted document text loading...');
        }
      } catch (err) {
        console.error(err);
      }
    })();
  }, [selectedDocId, token]);

  // ── Form Actions ─────────────────────────────────────────────────────────────
  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    if (isAiMode) {
      // Send AI Query
      socketRef.current?.emit('group:ai_query', {
        sessionId,
        query: input.trim(),
      });
      setInput('');
    } else {
      // Send regular chat
      socketRef.current?.emit('group:message', {
        content: input.trim(),
      });
      setInput('');
      // Emit stop typing
      socketRef.current?.emit('group:typing', { isTyping: false });
    }
  }

  let typingTimeout = useRef<any>(null);
  function handleKeyDown() {
    if (isAiMode) return;
    socketRef.current?.emit('group:typing', { isTyping: true });

    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socketRef.current?.emit('group:typing', { isTyping: false });
    }, 2000);
  }

  async function endSession() {
    try {
      await fetch(`${apiUrl}/groups/${groupId}/sessions/${sessionId}/end`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0c' }}>
      
      {/* ── TOP BAR ──────────────────────────────────────────────────────── */}
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 24px', background: 'rgba(18, 18, 24, 0.6)', backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)', zIndex: 10
      }}>
        {/* Left: title + timer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link href={`/dashboard/groups/${groupId}`} style={{ textDecoration: 'none', color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
            🚪 Leave Room
          </Link>
          <span style={{ height: 16, width: 1, background: 'rgba(255,255,255,0.15)' }} />
          <div>
            <h2 style={{ fontSize: '1rem', color: '#fff', fontWeight: 600, margin: 0 }}>{session.title}</h2>
            <span style={{ fontSize: '0.78rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
              ⏱ Elapsed: {elapsed}
            </span>
          </div>
        </div>

        {/* Center: Online Avatars */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {group.members?.map(m => {
            const online = onlineUsers.has(m.userId);
            return (
              <div
                key={m.userId}
                title={`${m.user.name || m.user.email} (${online ? 'Online' : 'Offline'})`}
                style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: online ? '#6366f1' : 'rgba(255,255,255,0.05)',
                  border: `2px solid ${online ? '#10b981' : 'rgba(255,255,255,0.1)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.75rem', fontWeight: 700, color: online ? '#fff' : 'var(--color-text-muted)',
                  filter: online ? 'none' : 'grayscale(100%)',
                }}
              >
                {(m.user.name || m.user.email).slice(0, 2).toUpperCase()}
              </div>
            );
          })}
        </div>

        {/* Right: End Session Control */}
        <div>
          {isLeader && (
            <button
              onClick={endSession}
              style={{
                padding: '8px 16px', borderRadius: 8, background: '#f43f5e', border: 'none',
                color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(244,63,94,0.3)',
              }}
            >
              End Session
            </button>
          )}
        </div>
      </header>

      {/* ── SPLIT LAYOUT ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', flex: 1, overflow: 'hidden' }}>
        
        {/* LEFT COLUMN: Message Feed & Input */}
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
          {/* Scrollable Feed Container */}
          <div
            ref={feedContainerRef}
            onScroll={handleFeedScroll}
            style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column-reverse', gap: 16 }}
          >
            <div ref={chatEndRef} />

            {/* AI Streaming Token block */}
            {aiStreamingText && (
              <div style={{ alignSelf: 'flex-start', maxWidth: '80%' }}>
                <div style={{ fontSize: '0.72rem', color: '#a5b4fc', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
                  🤖 Assistant (Typing...)
                </div>
                <div style={{
                  background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
                  borderRadius: '0px 16px 16px 16px', padding: '12px 16px', color: '#e0e0ff',
                  fontSize: '0.92rem', lineHeight: 1.6, whiteSpace: 'pre-wrap'
                }}>
                  {aiStreamingText}
                </div>
              </div>
            )}

            {/* AI Queued Loader */}
            {aiQueued && !aiStreamingText && (
              <div style={{
                alignSelf: 'flex-start', background: 'rgba(255,255,255,0.02)',
                borderRadius: 12, padding: '10px 16px', color: 'var(--color-text-secondary)',
                fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 10
              }}>
                <span className="spinner" style={{ width: 14, height: 14, border: '2px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 1s linear infinite' }} />
                AI query is queued...
              </div>
            )}

            {/* Messages Array (Rendered in reverse since flex-direction is column-reverse) */}
            {messages.map(m => {
              const isMe = m.userId === myUserId;
              const isAi = m.messageType === 'AI';
              const isSys = m.messageType === 'SYSTEM';

              if (isSys) {
                return (
                  <div key={m.id} style={{
                    alignSelf: 'center', background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12,
                    padding: '16px 20px', maxWidth: '90%', fontSize: '0.88rem', color: 'var(--color-text-secondary)'
                  }}>
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: m.content.replace(/\n/g, '<br/>') }} />
                  </div>
                );
              }

              return (
                <div key={m.id} style={{
                  alignSelf: isMe ? 'flex-end' : 'flex-start',
                  maxWidth: '80%', display: 'flex', flexDirection: 'column',
                  alignItems: isMe ? 'flex-end' : 'flex-start'
                }}>
                  {/* Sender Name */}
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 4, fontWeight: 700 }}>
                    {isAi ? '🤖 Assistant' : (m.user?.name || m.user?.email || m.userId)}
                  </span>
                  
                  {/* Message Bubble */}
                  <div style={{
                    background: isMe ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' : isAi ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isMe ? 'transparent' : isAi ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: isMe ? '16px 16px 0px 16px' : '0px 16px 16px 16px',
                    padding: '12px 16px', color: '#fff', fontSize: '0.92rem', lineHeight: 1.6,
                    boxShadow: isMe ? '0 4px 16px rgba(99,102,241,0.2)' : 'none',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {m.content}
                  </div>
                </div>
              );
            })}

            {/* Historical loader */}
            {loadingHistory && (
              <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                Loading message history...
              </div>
            )}
          </div>

          {/* Typing Indicators */}
          {typingUsers.size > 0 && (
            <div style={{ padding: '0 24px 8px 24px', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              💬 {Array.from(typingUsers).map(u => group.members?.find(m => m.userId === u)?.user.name || u).join(', ')} is typing...
            </div>
          )}

          {/* Chat input form */}
          <div style={{ padding: 24, borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(18,18,24,0.3)' }}>
            <form onSubmit={handleSend} style={{ display: 'flex', gap: 12 }}>
              <button
                type="button"
                onClick={() => setIsAiMode(v => !v)}
                style={{
                  padding: '12px 18px', borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                  background: isAiMode ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)',
                  border: `1.5px solid ${isAiMode ? '#6366f1' : 'rgba(255,255,255,0.08)'}`,
                  color: isAiMode ? '#a5b4fc' : 'var(--color-text-secondary)',
                  transition: 'all 0.15s'
                }}
              >
                {isAiMode ? '🤖 AI Mode' : '👥 Chat'}
              </button>
              
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isAiMode ? 'Ask the AI study assistant...' : 'Type message here...'}
                style={{
                  flex: 1, padding: '12px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: '0.95rem', outline: 'none'
                }}
              />
              
              <button type="submit" style={{
                padding: '12px 24px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                color: '#fff', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 16px rgba(99,102,241,0.3)'
              }}>
                Send
              </button>
            </form>
          </div>
        </div>

        {/* RIGHT COLUMN: Document Viewer */}
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '24px', overflow: 'hidden' }}>
          {/* Doc tabs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 6 }}>
            {group.documents?.map(gd => (
              <button
                key={gd.docId}
                onClick={() => setSelectedDocId(gd.docId)}
                style={{
                  padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: '0.82rem', whiteSpace: 'nowrap',
                  background: selectedDocId === gd.docId ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.02)',
                  border: `1.5px solid ${selectedDocId === gd.docId ? '#6366f1' : 'rgba(255,255,255,0.06)'}`,
                  color: selectedDocId === gd.docId ? '#a5b4fc' : 'var(--color-text-secondary)',
                  transition: 'all 0.15s'
                }}
              >
                📄 {gd.document.title}
              </button>
            ))}
            {group.documents?.length === 0 && (
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>No shared documents available.</span>
            )}
          </div>

          {/* Doc Text Viewer Container */}
          <div style={{
            flex: 1, padding: 24, borderRadius: 16, overflowY: 'auto',
            background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
            color: 'var(--color-text-secondary)', fontSize: '0.95rem', lineHeight: 1.8, whiteSpace: 'pre-wrap'
          }}>
            {docContent || 'Select a shared document above to view its contents.'}
          </div>
        </div>

      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

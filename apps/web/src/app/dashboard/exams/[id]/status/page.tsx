'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

function getToken(): string {
  // Read from cookie in client context
  const match = document.cookie.match(/(?:^|; )token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export default function ExamStatusPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const examId = params.id;

  const [status,    setStatus]    = useState<string>('DRAFT');
  const [qCount,    setQCount]    = useState<number>(0);
  const [title,     setTitle]     = useState<string>('');
  const [dots,      setDots]      = useState('');

  useEffect(() => {
    const dotInterval = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 500);
    return () => clearInterval(dotInterval);
  }, []);

  useEffect(() => {
    if (!examId) return;
    let cancelled = false;

    async function poll() {
      while (!cancelled) {
        try {
          const token = getToken();
          const res = await fetch(`${apiUrl}/exams/${examId}/status`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            if (!cancelled) {
              setStatus(data.status);
              setQCount(data.questionCount ?? 0);
              setTitle(data.title ?? '');
              if (data.status === 'READY') {
                router.push(`/dashboard/exams/${examId}/session`);
                return;
              }
            }
          }
        } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    poll();
    return () => { cancelled = true; };
  }, [examId, router]);

  const stages = [
    { label: 'Exam Created',          done: true },
    { label: 'Fetching Source Chunks', done: status !== 'DRAFT' },
    { label: 'Generating Questions',   done: qCount > 0 },
    { label: 'Deduplication & Polish', done: status === 'READY' },
    { label: 'Ready to Start',         done: status === 'READY' },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="glass-panel" style={{ maxWidth: 520, width: '100%', textAlign: 'center', padding: '48px 40px' }}>
        {/* Spinner */}
        <div style={{ position: 'relative', width: 80, height: 80, margin: '0 auto 32px' }}>
          <svg width="80" height="80" viewBox="0 0 80 80" style={{ animation: 'spin 1.2s linear infinite' }}>
            <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(99,102,241,0.15)" strokeWidth="6" />
            <circle cx="40" cy="40" r="34" fill="none" stroke="#6366f1" strokeWidth="6"
              strokeDasharray="80 140" strokeLinecap="round" />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem' }}>
            🤖
          </div>
        </div>

        <h1 style={{
          fontSize: '1.6rem', fontFamily: 'var(--font-display)', fontWeight: 700,
          background: 'linear-gradient(135deg, #fff 30%, #a5a6c2)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 8,
        }}>
          Generating Your Exam{dots}
        </h1>
        {title && (
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 36, fontSize: '0.9rem' }}>
            {title}
          </p>
        )}

        {/* Progress stages */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 36 }}>
          {stages.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left' }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                background: s.done ? '#10b981' : i === stages.filter(x => x.done).length ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)',
                border: `2px solid ${s.done ? '#10b981' : 'rgba(255,255,255,0.1)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.75rem', fontWeight: 700, color: '#fff',
              }}>
                {s.done ? '✓' : ''}
              </div>
              <span style={{
                fontSize: '0.9rem',
                color: s.done ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                fontWeight: s.done ? 600 : 400,
              }}>
                {s.label}
              </span>
              {qCount > 0 && i === 2 && (
                <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#10b981', fontWeight: 700 }}>
                  {qCount} generated
                </span>
              )}
            </div>
          ))}
        </div>

        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
          This usually takes 30–90 seconds. You'll be redirected automatically.
        </p>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideDown { from { opacity:0; transform:translateX(-50%) translateY(-12px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}

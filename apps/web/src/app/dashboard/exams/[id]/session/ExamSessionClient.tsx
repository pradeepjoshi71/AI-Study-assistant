'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { ExamQuestion, QuestionType } from '../../types';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

type QuestionState = 'unanswered' | 'answered' | 'flagged';

interface AnswerMap  { [qId: string]: string }
interface StateMap   { [qId: string]: QuestionState }
interface TimingMap  { [qId: string]: number }  // ms spent on question

interface Props {
  exam: {
    id: string;
    title: string;
    durationMinutes: number;
    questions: ExamQuestion[];
  };
  token: string;
}

export default function ExamSessionClient({ exam, token }: Props) {
  const router = useRouter();
  const questions: ExamQuestion[] = exam.questions ?? [];
  const totalMs = exam.durationMinutes * 60 * 1000;

  const [currentIdx, setCurrentIdx]   = useState(0);
  const [answers,    setAnswers]       = useState<AnswerMap>({});
  const [qStates,    setQStates]       = useState<StateMap>({});
  const [timeLeft,   setTimeLeft]      = useState(totalMs);
  const [submitting, setSubmitting]    = useState(false);
  const [toast,      setToast]         = useState('');
  const [attemptId,  setAttemptId]     = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen]  = useState(false);

  const questionStartRef = useRef<number>(Date.now());
  const timingRef        = useRef<TimingMap>({});
  const toastTimerRef    = useRef<any>(null);
  const timerSyncRef     = useRef<any>(null);

  const currentQ = questions[currentIdx];

  // ── Create attempt on mount ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/exams/${exam.id}/attempts`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          const data = await res.json();
          setAttemptId(data.id ?? null);
        }
      } catch { /* non-fatal */ }
    })();
  }, [exam.id, token]);

  // ── Countdown timer ────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1000) {
          clearInterval(interval);
          handleSubmit(true);
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync remaining time from server every 30s ──────────────────────────────
  useEffect(() => {
    timerSyncRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${apiUrl}/exams/${exam.id}/timer`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (typeof data.remainingMs === 'number') {
            setTimeLeft(data.remainingMs);
          }
        }
      } catch { /* silently ignore */ }
    }, 30_000);
    return () => clearInterval(timerSyncRef.current!);
  }, [exam.id, token]);

  // ── 5-minute warning toast ─────────────────────────────────────────────────
  useEffect(() => {
    if (timeLeft <= 5 * 60 * 1000 && timeLeft > 5 * 60 * 1000 - 2000) {
      showToast('⚠️  5 minutes remaining!', 6000);
    }
  }, [timeLeft]);

  // ── Track time per question ────────────────────────────────────────────────
  useEffect(() => {
    const prev = questionStartRef.current;
    questionStartRef.current = Date.now();
    if (currentQ) {
      const elapsed = Date.now() - prev;
      timingRef.current[currentQ.id] = (timingRef.current[currentQ.id] ?? 0) + elapsed;
    }
  }, [currentIdx, currentQ]);

  function showToast(msg: string, ms = 3500) {
    setToast(msg);
    clearTimeout(toastTimerRef.current!);
    toastTimerRef.current = setTimeout(() => setToast(''), ms);
  }

  // ── Answer handling ────────────────────────────────────────────────────────
  function setAnswer(qId: string, value: string) {
    setAnswers(prev => ({ ...prev, [qId]: value }));
    setQStates(prev => {
      if (prev[qId] === 'flagged') return prev;
      return { ...prev, [qId]: 'answered' };
    });
  }

  function toggleFlag(qId: string) {
    setQStates(prev => ({
      ...prev,
      [qId]: prev[qId] === 'flagged' ? (answers[qId] ? 'answered' : 'unanswered') : 'flagged',
    }));
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (autoSubmit = false) => {
    if (submitting) return;
    setSubmitting(true);
    if (autoSubmit) showToast('⏰ Time expired — submitting automatically…', 5000);

    // Finalize timing for current question
    if (currentQ) {
      const elapsed = Date.now() - questionStartRef.current;
      timingRef.current[currentQ.id] = (timingRef.current[currentQ.id] ?? 0) + elapsed;
    }

    const payload = questions.map(q => ({
      questionId: q.id,
      userAnswer:  answers[q.id] ?? '',
      timeTakenMs: timingRef.current[q.id] ?? 0,
    }));

    try {
      const targetAttemptId = attemptId ?? 'unknown';
      await fetch(`${apiUrl}/exams/attempts/${targetAttemptId}/answers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: payload }),
      });
      router.push(`/dashboard/exams/${exam.id}/result?attemptId=${targetAttemptId}`);
    } catch {
      setSubmitting(false);
      showToast('❌ Submit failed. Please try again.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitting, answers, attemptId, currentQ]);

  if (questions.length === 0) {
    return (
      <div style={{ padding: 80, textAlign: 'center', color: 'var(--color-text-muted)' }}>
        <p>This exam has no questions yet. Please wait for generation to complete.</p>
      </div>
    );
  }

  const answered  = Object.values(qStates).filter(s => s === 'answered').length;
  const flagged   = Object.values(qStates).filter(s => s === 'flagged').length;
  const mins      = Math.floor(timeLeft / 60000);
  const secs      = Math.floor((timeLeft % 60000) / 1000);
  const urgent    = timeLeft < 5 * 60 * 1000;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-primary)' }}>

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)',
          background: urgent ? 'rgba(244,63,94,0.9)' : 'rgba(99,102,241,0.9)',
          backdropFilter: 'blur(12px)', color: '#fff', padding: '14px 28px',
          borderRadius: 14, fontWeight: 600, zIndex: 9999,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)', animation: 'slideDown 0.3s ease',
        }}>
          {toast}
        </div>
      )}

      {/* ── Sidebar question grid ──────────────────────────────────────────── */}
      <aside style={{
        width: sidebarOpen ? 260 : 0, minWidth: sidebarOpen ? 260 : 0,
        background: 'var(--bg-secondary)', borderRight: '1px solid var(--glass-border)',
        overflowY: 'auto', transition: 'all 0.3s',
        display: 'flex', flexDirection: 'column',
      }}>
        {sidebarOpen && (
          <>
            <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--glass-border)' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff', marginBottom: 12 }}>
                Questions
              </h3>
              <div style={{ display: 'flex', gap: 8, fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                <span>✅ {answered} done</span>
                <span>🚩 {flagged} flagged</span>
                <span>⬜ {questions.length - answered - flagged} left</span>
              </div>
            </div>
            <div style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
              {questions.map((q, i) => {
                const st = qStates[q.id] ?? 'unanswered';
                const isActive = i === currentIdx;
                const bg = isActive ? '#6366f1' : st === 'answered' ? '#10b981' : st === 'flagged' ? '#f59e0b' : 'rgba(255,255,255,0.06)';
                return (
                  <button
                    key={q.id}
                    onClick={() => setCurrentIdx(i)}
                    style={{
                      width: '100%', aspectRatio: '1', borderRadius: 8, border: 'none',
                      background: bg, color: '#fff', fontWeight: 700, fontSize: '0.8rem',
                      cursor: 'pointer', transition: 'transform 0.15s',
                      boxShadow: isActive ? '0 0 12px rgba(99,102,241,0.6)' : 'none',
                    }}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div style={{ padding: '16px', marginTop: 'auto', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[['#10b981', 'Answered'], ['#f59e0b', 'Flagged'], ['rgba(255,255,255,0.12)', 'Unanswered'], ['#6366f1', 'Current']].map(([c, l]) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: c as string }} />
                    <span>{l}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </aside>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top bar */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 28px', background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--glass-border)', gap: 16,
        }}>
          <button
            onClick={() => setSidebarOpen(v => !v)}
            style={{ background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '1.2rem' }}
          >
            ☰
          </button>
          <h1 style={{ flex: 1, fontSize: '1rem', fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {exam.title}
          </h1>

          {/* Timer */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: urgent ? 'rgba(244,63,94,0.15)' : 'rgba(99,102,241,0.12)',
            border: `1px solid ${urgent ? 'rgba(244,63,94,0.4)' : 'rgba(99,102,241,0.3)'}`,
            borderRadius: 10, padding: '8px 16px',
            animation: urgent && timeLeft < 60_000 ? 'pulse-red 1s infinite' : 'none',
          }}>
            <span style={{ fontSize: '1.1rem' }}>{urgent ? '🔴' : '⏱'}</span>
            <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '1.1rem', color: urgent ? '#f87171' : '#a5b4fc' }}>
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </span>
          </div>

          <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            {currentIdx + 1} / {questions.length}
          </div>

          <button
            onClick={() => handleSubmit(false)}
            disabled={submitting}
            style={{
              padding: '8px 20px', borderRadius: 10, fontWeight: 600, fontSize: '0.9rem',
              background: submitting ? 'rgba(244,63,94,0.2)' : '#f43f5e',
              border: 'none', color: '#fff', cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(244,63,94,0.3)',
            }}
          >
            {submitting ? 'Submitting…' : 'Submit Exam'}
          </button>
        </header>

        {/* Progress bar */}
        <div style={{ height: 3, background: 'rgba(255,255,255,0.06)' }}>
          <div style={{
            height: '100%', width: `${((currentIdx + 1) / questions.length) * 100}%`,
            background: 'linear-gradient(90deg, #6366f1, #06b6d4)', transition: 'width 0.3s',
          }} />
        </div>

        {/* Question area */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '40px 48px', maxWidth: 820, width: '100%', margin: '0 auto' }}>
          <QuestionCard
            question={currentQ}
            index={currentIdx}
            total={questions.length}
            answer={answers[currentQ?.id] ?? ''}
            flagged={qStates[currentQ?.id] === 'flagged'}
            onAnswer={val => setAnswer(currentQ.id, val)}
            onFlag={() => toggleFlag(currentQ.id)}
          />
        </main>

        {/* Bottom nav */}
        <footer style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 48px', borderTop: '1px solid var(--glass-border)',
          background: 'var(--bg-secondary)',
        }}>
          <button
            onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
            disabled={currentIdx === 0}
            style={navBtnStyle(currentIdx === 0)}
          >
            ← Previous
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {[...Array(Math.min(7, questions.length))].map((_, i) => {
              const offset = Math.max(0, Math.min(questions.length - 7, currentIdx - 3));
              const qi = i + offset;
              const st = qStates[questions[qi]?.id] ?? 'unanswered';
              return (
                <button
                  key={qi}
                  onClick={() => setCurrentIdx(qi)}
                  style={{
                    width: 32, height: 32, borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: qi === currentIdx ? '#6366f1' : st === 'answered' ? '#10b981' : st === 'flagged' ? '#f59e0b' : 'rgba(255,255,255,0.06)',
                    color: '#fff', fontWeight: 600, fontSize: '0.8rem',
                  }}
                >
                  {qi + 1}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setCurrentIdx(i => Math.min(questions.length - 1, i + 1))}
            disabled={currentIdx === questions.length - 1}
            style={navBtnStyle(currentIdx === questions.length - 1)}
          >
            Next →
          </button>
        </footer>
      </div>
    </div>
  );
}

// ── QuestionCard ──────────────────────────────────────────────────────────────

function QuestionCard({
  question, index, total, answer, flagged, onAnswer, onFlag,
}: {
  question: ExamQuestion;
  index: number; total: number;
  answer: string; flagged: boolean;
  onAnswer: (v: string) => void;
  onFlag: () => void;
}) {
  if (!question) return null;

  return (
    <div style={{ animation: 'fadeIn 0.25s ease' }}>
      {/* Question meta */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <span style={{
          background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', borderRadius: 8,
          padding: '4px 12px', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.04em',
        }}>
          Q{index + 1} / {total}
        </span>
        <span style={{
          background: typeColor(question.type) + '22', color: typeColor(question.type),
          borderRadius: 8, padding: '4px 10px', fontSize: '0.75rem', fontWeight: 600,
        }}>
          {question.type.replace('_', ' ')}
        </span>
        <span style={{
          marginLeft: 'auto', padding: '4px 10px', borderRadius: 8, fontSize: '0.8rem',
          background: 'rgba(255,255,255,0.05)', color: 'var(--color-text-muted)',
        }}>
          {question.points} {question.points === 1 ? 'pt' : 'pts'}
        </span>
        <button
          onClick={onFlag}
          style={{
            background: flagged ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${flagged ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 8, padding: '4px 12px', cursor: 'pointer',
            color: flagged ? '#fbbf24' : 'var(--color-text-muted)', fontSize: '0.8rem', fontWeight: 600,
          }}
        >
          {flagged ? '🚩 Flagged' : '⚑ Flag'}
        </button>
      </div>

      {/* Question text */}
      <div style={{
        fontSize: '1.2rem', fontWeight: 500, lineHeight: 1.7,
        color: 'var(--color-text-primary)', marginBottom: 36,
        padding: '24px', borderRadius: 16,
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      }}>
        {question.questionText}
      </div>

      {/* Answer input by type */}
      <AnswerInput question={question} answer={answer} onAnswer={onAnswer} />
    </div>
  );
}

function AnswerInput({
  question, answer, onAnswer,
}: {
  question: ExamQuestion; answer: string; onAnswer: (v: string) => void;
}) {
  const { type, options } = question;

  if (type === 'MCQ' && options) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Object.entries(options).map(([key, text]) => {
          const selected = answer === key;
          return (
            <button
              key={key}
              onClick={() => onAnswer(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 16,
                padding: '16px 20px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                background: selected ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)',
                border: `1.5px solid ${selected ? '#6366f1' : 'rgba(255,255,255,0.08)'}`,
                color: selected ? '#e0e7ff' : 'var(--color-text-secondary)',
                transition: 'all 0.15s',
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: selected ? '#6366f1' : 'rgba(255,255,255,0.06)',
                border: `2px solid ${selected ? '#818cf8' : 'rgba(255,255,255,0.1)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '0.85rem', color: selected ? '#fff' : 'var(--color-text-muted)',
              }}>
                {key}
              </div>
              <span style={{ flex: 1, lineHeight: 1.5 }}>{text}</span>
            </button>
          );
        })}
      </div>
    );
  }

  if (type === 'TRUE_FALSE') {
    return (
      <div style={{ display: 'flex', gap: 16 }}>
        {['True', 'False'].map(v => {
          const selected = answer === v;
          const isTrue = v === 'True';
          return (
            <button
              key={v}
              onClick={() => onAnswer(v)}
              style={{
                flex: 1, padding: '20px', borderRadius: 14, cursor: 'pointer',
                background: selected ? (isTrue ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)') : 'rgba(255,255,255,0.03)',
                border: `2px solid ${selected ? (isTrue ? '#10b981' : '#f43f5e') : 'rgba(255,255,255,0.08)'}`,
                color: selected ? (isTrue ? '#34d399' : '#fb7185') : 'var(--color-text-secondary)',
                fontWeight: 700, fontSize: '1.1rem', transition: 'all 0.15s',
              }}
            >
              {isTrue ? '✓ True' : '✗ False'}
            </button>
          );
        })}
      </div>
    );
  }

  if (type === 'SHORT') {
    return (
      <textarea
        value={answer}
        onChange={e => onAnswer(e.target.value)}
        placeholder="Type your answer here…"
        rows={5}
        style={{
          width: '100%', padding: '16px', borderRadius: 14, resize: 'vertical',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
          color: 'var(--color-text-primary)', fontSize: '1rem', outline: 'none',
          fontFamily: 'var(--font-sans)', lineHeight: 1.6,
        }}
      />
    );
  }

  if (type === 'FILL') {
    return (
      <input
        value={answer}
        onChange={e => onAnswer(e.target.value)}
        placeholder="Fill in the blank…"
        style={{
          width: '100%', padding: '16px 20px', borderRadius: 14,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
          color: 'var(--color-text-primary)', fontSize: '1.05rem', outline: 'none',
        }}
      />
    );
  }

  return null;
}

function typeColor(type: QuestionType): string {
  return { MCQ: '#6366f1', TRUE_FALSE: '#10b981', SHORT: '#06b6d4', FILL: '#f59e0b' }[type] ?? '#6366f1';
}

function navBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '10px 24px', borderRadius: 10, fontWeight: 600, fontSize: '0.9rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? 'rgba(255,255,255,0.03)' : 'rgba(99,102,241,0.12)',
    border: `1px solid ${disabled ? 'rgba(255,255,255,0.06)' : 'rgba(99,102,241,0.3)'}`,
    color: disabled ? 'var(--color-text-muted)' : '#a5b4fc',
    opacity: disabled ? 0.5 : 1, transition: 'all 0.2s',
  };
}

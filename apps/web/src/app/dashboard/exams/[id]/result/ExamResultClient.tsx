'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import type { ExamQuestion, AttemptAnswer, ScoreResponse, TopicBreakdownItem } from '../../types';

interface Props {
  examId: string;
  exam: {
    id: string;
    title: string;
    totalQuestions: number;
    durationMinutes: number;
    questions: ExamQuestion[];
  };
  scoreData: ScoreResponse | null;
  answers: AttemptAnswer[];
  token: string;
}

function gradeColor(pct: number): string {
  if (pct >= 80) return '#10b981';
  if (pct >= 60) return '#f59e0b';
  return '#f43f5e';
}

function classificationBadge(pct: number) {
  if (pct < 40)  return { label: 'CRITICAL',  color: '#f43f5e', bg: 'rgba(244,63,94,0.12)'  };
  if (pct < 70)  return { label: 'REVIEW',    color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
  return               { label: 'MASTERED',  color: '#10b981', bg: 'rgba(16,185,129,0.12)' };
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

const CHART_COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#ec4899'];

export default function ExamResultClient({ examId, exam, scoreData, answers, token }: Props) {
  const [expandedQ, setExpandedQ] = useState<Set<string>>(new Set());

  const questions = exam.questions ?? [];
  const answerMap: Record<string, AttemptAnswer> = {};
  (answers as AttemptAnswer[]).forEach(a => { answerMap[a.questionId] = a; });

  const totalScore  = scoreData?.totalScore ?? 0;
  const maxScore    = scoreData?.maxScore ?? questions.reduce((s, q) => s + q.points, 0);
  const percentile  = scoreData?.percentile ?? 0;
  const scorePct    = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  const topicBreakdown: TopicBreakdownItem[] = scoreData?.topicBreakdown ?? [];
  const weakTopics  = scoreData?.weakTopics ?? [];
  const timingData  = scoreData?.timingAnalysis as any ?? {};

  const chartData = topicBreakdown.map((t, i) => ({
    name: t.topicId.length > 12 ? t.topicId.slice(0, 12) + '…' : t.topicId,
    fullId: t.topicId,
    score: t.scorePercent,
    fill: gradeColor(t.scorePercent),
  }));

  function toggleAccordion(qId: string) {
    setExpandedQ(prev => {
      const next = new Set(prev);
      next.has(qId) ? next.delete(qId) : next.add(qId);
      return next;
    });
  }

  const correctCount = answers.filter(a => a.isCorrect).length;

  return (
    <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{
                fontSize: '2rem', fontFamily: 'var(--font-display)', fontWeight: 700,
                background: 'linear-gradient(135deg, #fff 30%, #a5a6c2)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 6,
              }}>
                Exam Results
              </h1>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.95rem' }}>{exam.title}</p>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <Link
                href={`/dashboard/exams/${examId}/session`}
                style={{
                  padding: '10px 20px', borderRadius: 10, fontWeight: 600, fontSize: '0.85rem',
                  background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)',
                  color: '#a5b4fc', textDecoration: 'none',
                }}
              >
                Retake
              </Link>
              <Link
                href="/dashboard/exams/create"
                style={{
                  padding: '10px 20px', borderRadius: 10, fontWeight: 600, fontSize: '0.85rem',
                  background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                  border: 'none', color: '#fff', textDecoration: 'none',
                  boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
                }}
              >
                + New Exam
              </Link>
            </div>
          </div>
        </div>

        {/* ── Score card ─────────────────────────────────────────────────────── */}
        <div className="glass-panel" style={{ marginBottom: 28, overflow: 'visible' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 40, alignItems: 'center' }}>
            {/* Big score ring */}
            <div style={{ position: 'relative', width: 160, height: 160 }}>
              <svg width="160" height="160" viewBox="0 0 160 160">
                <circle cx="80" cy="80" r="68" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="14" />
                <circle
                  cx="80" cy="80" r="68" fill="none"
                  stroke={gradeColor(scorePct)} strokeWidth="14"
                  strokeDasharray={`${2 * Math.PI * 68 * scorePct / 100} ${2 * Math.PI * 68}`}
                  strokeLinecap="round"
                  transform="rotate(-90 80 80)"
                  style={{ transition: 'stroke-dasharray 1s ease', filter: `drop-shadow(0 0 8px ${gradeColor(scorePct)})` }}
                />
              </svg>
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: '2.2rem', fontWeight: 800, color: gradeColor(scorePct), lineHeight: 1 }}>
                  {scorePct}%
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>Score</span>
              </div>
            </div>

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {[
                { label: 'Points',      val: `${totalScore} / ${maxScore}`,       icon: '🎯' },
                { label: 'Correct',     val: `${correctCount} / ${questions.length}`, icon: '✅' },
                { label: 'Percentile',  val: `Top ${(100 - percentile).toFixed(0)}%`, icon: '📊' },
                { label: 'Avg Time',    val: formatMs(timingData.avgMs ?? 0),      icon: '⏱' },
              ].map(s => (
                <div key={s.label} style={{
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 12, padding: '16px 20px',
                }}>
                  <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>{s.icon}</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#fff' }}>{s.val}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Topic Breakdown BarChart ────────────────────────────────────── */}
        {chartData.length > 0 && (
          <div className="glass-panel" style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#fff', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
              📊 Topic Breakdown
            </h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-secondary)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 10, color: '#fff', fontSize: '0.85rem',
                  }}
                  formatter={(val: any, _: any, props: any) => [`${Number(val ?? 0).toFixed(1)}%`, props.payload?.fullId || '']}
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                />
                <Bar dataKey="score" radius={[6, 6, 0, 0]} maxBarSize={60}>
                  {chartData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Topic classification pills */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20 }}>
              {topicBreakdown.map(t => {
                const badge = classificationBadge(t.scorePercent);
                return (
                  <div key={t.topicId} style={{
                    background: badge.bg, border: `1px solid ${badge.color}44`,
                    borderRadius: 10, padding: '6px 14px', fontSize: '0.8rem',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span style={{ color: badge.color, fontWeight: 700 }}>{badge.label}</span>
                    <span style={{ color: 'var(--color-text-secondary)' }}>
                      {t.topicId.length > 18 ? t.topicId.slice(0, 18) + '…' : t.topicId}
                    </span>
                    <span style={{ color: '#fff', fontWeight: 700 }}>{t.scorePercent.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Weak Topics ───────────────────────────────────────────────────── */}
        {weakTopics.length > 0 && (
          <div className="glass-panel" style={{ marginBottom: 28, border: '1px solid rgba(244,63,94,0.2)' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#fff', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
              ⚠️ Weak Topics — Recommended for Review
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {weakTopics.map(tid => (
                <Link
                  key={tid}
                  href={`/dashboard/adaptive?topicId=${encodeURIComponent(tid)}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)',
                    borderRadius: 12, padding: '10px 18px', textDecoration: 'none',
                    color: '#fb7185', fontSize: '0.85rem', fontWeight: 600,
                    transition: 'all 0.2s',
                  }}
                >
                  🎯 {tid.length > 20 ? tid.slice(0, 20) + '…' : tid}
                  <span style={{ color: 'rgba(251,113,133,0.6)', fontSize: '0.75rem' }}>→ Practice</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── Per-question Accordion ────────────────────────────────────────── */}
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--glass-border)' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
              📋 Question Review
            </h2>
          </div>
          {questions.map((q, i) => {
            const ans       = answerMap[q.id];
            const expanded  = expandedQ.has(q.id);
            const correct   = ans?.isCorrect ?? false;
            const userAns   = ans?.userAnswer ?? '—';
            const pts       = ans?.pointsAwarded ?? 0;

            return (
              <div key={q.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                {/* Accordion header */}
                <button
                  onClick={() => toggleAccordion(q.id)}
                  style={{
                    width: '100%', padding: '18px 24px', background: 'none', border: 'none',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
                  }}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem',
                    background: correct ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)',
                    border: `1px solid ${correct ? '#10b981' : '#f43f5e'}`,
                    color: correct ? '#34d399' : '#fb7185',
                  }}>
                    {correct ? '✓' : '✗'}
                  </div>
                  <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--color-text-primary)', fontWeight: 500, lineHeight: 1.4 }}>
                    <span style={{ color: 'var(--color-text-muted)', marginRight: 8, fontSize: '0.8rem' }}>Q{i + 1}.</span>
                    {q.questionText.length > 90 ? q.questionText.slice(0, 90) + '…' : q.questionText}
                  </span>
                  <span style={{
                    fontSize: '0.8rem', fontWeight: 700, padding: '3px 10px', borderRadius: 8,
                    background: correct ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)',
                    color: correct ? '#34d399' : '#fb7185',
                  }}>
                    {pts.toFixed(1)}/{q.points}pt
                  </span>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '1rem' }}>
                    {expanded ? '▲' : '▼'}
                  </span>
                </button>

                {/* Accordion body */}
                {expanded && (
                  <div style={{
                    padding: '0 24px 24px 24px',
                    borderTop: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    {/* Full question */}
                    <div style={{
                      background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: '16px',
                      marginTop: 16, marginBottom: 16, fontSize: '0.95rem', lineHeight: 1.7,
                      color: 'var(--color-text-primary)', border: '1px solid rgba(255,255,255,0.05)',
                    }}>
                      {q.questionText}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                      {/* User answer */}
                      <div style={{
                        background: correct ? 'rgba(16,185,129,0.07)' : 'rgba(244,63,94,0.07)',
                        border: `1px solid ${correct ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)'}`,
                        borderRadius: 12, padding: '14px 16px',
                      }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                          Your Answer
                        </div>
                        <div style={{ fontSize: '0.9rem', color: correct ? '#34d399' : '#fb7185', fontWeight: 600 }}>
                          {userAns || <span style={{ opacity: 0.5 }}>No answer</span>}
                        </div>
                      </div>

                      {/* Correct answer */}
                      <div style={{
                        background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)',
                        borderRadius: 12, padding: '14px 16px',
                      }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                          Correct Answer
                        </div>
                        <div style={{ fontSize: '0.9rem', color: '#34d399', fontWeight: 600 }}>
                          {q.correctAnswer}
                        </div>
                      </div>
                    </div>

                    {/* Explanation */}
                    {q.explanation && (
                      <div style={{
                        background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.18)',
                        borderRadius: 12, padding: '14px 16px',
                      }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                          💡 Explanation
                        </div>
                        <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', lineHeight: 1.7, margin: 0 }}>
                          {q.explanation}
                        </p>
                      </div>
                    )}

                    {/* Timing */}
                    {ans?.timeTakenMs != null && (
                      <div style={{ marginTop: 12, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                        ⏱ Time taken: {formatMs(ans.timeTakenMs)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ height: 60 }} />
      </div>
    </div>
  );
}

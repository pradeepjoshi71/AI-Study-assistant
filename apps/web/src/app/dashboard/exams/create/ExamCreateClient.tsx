'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Document, Topic, DifficultyMix, QuestionType, ExamType } from '../types';

interface Props {
  token: string;
  documents: Document[];
  topics: Topic[];
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

const Q_TYPES: { id: QuestionType; label: string; icon: string }[] = [
  { id: 'MCQ',        label: 'Multiple Choice', icon: '⊙' },
  { id: 'TRUE_FALSE', label: 'True / False',    icon: '⊤' },
  { id: 'SHORT',      label: 'Short Answer',    icon: '✎' },
  { id: 'FILL',       label: 'Fill in Blank',   icon: '▭' },
];

const EXAM_TYPES: { id: ExamType; label: string; desc: string }[] = [
  { id: 'PRACTICE', label: 'Practice',  desc: 'Untimed, review mode' },
  { id: 'MOCK',     label: 'Mock Test', desc: 'Simulated exam' },
  { id: 'TIMED',    label: 'Timed',     desc: 'Strict countdown' },
];

type Step = 1 | 2 | 3;

export default function ExamCreateClient({ token, documents, topics }: Props) {
  const router = useRouter();

  // ── Step 1 state ────────────────────────────────────────────────────────────
  const [selectedDocs,   setSelectedDocs]   = useState<Set<string>>(new Set());
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [title,          setTitle]          = useState('');
  const [examType,       setExamType]       = useState<ExamType>('PRACTICE');

  // ── Step 2 state ────────────────────────────────────────────────────────────
  const [totalQuestions,   setTotalQuestions]   = useState(20);
  const [durationMinutes,  setDurationMinutes]  = useState(30);
  const [difficultyMix,    setDifficultyMix]    = useState<DifficultyMix>({ easy: 40, medium: 40, hard: 20 });

  // ── Step 3 state ────────────────────────────────────────────────────────────
  const [questionTypes, setQuestionTypes] = useState<Set<QuestionType>>(new Set(['MCQ']));

  // ── Nav ──────────────────────────────────────────────────────────────────────
  const [step,     setStep]     = useState<Step>(1);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // ── Difficulty mix helpers ───────────────────────────────────────────────────
  const mixTotal = difficultyMix.easy + difficultyMix.medium + difficultyMix.hard;
  const mixValid = Math.abs(mixTotal - 100) <= 1;

  function updateMix(key: keyof DifficultyMix, val: number) {
    const next = { ...difficultyMix, [key]: val };
    setDifficultyMix(next);
  }

  // ── Validation ───────────────────────────────────────────────────────────────
  const step1Valid = title.trim().length > 0 && selectedDocs.size > 0 && selectedTopics.size > 0;
  const step2Valid = mixValid;
  const step3Valid = questionTypes.size > 0;

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!step3Valid) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/exams`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          docIds:         [...selectedDocs],
          topicIds:       [...selectedTopics],
          totalQuestions,
          durationMinutes,
          difficultyMix,
          questionTypes:  [...questionTypes],
          type:           examType,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || `Error ${res.status}`);
      }
      const exam = await res.json();
      router.push(`/dashboard/exams/${exam.id}/status`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Toggle helpers ───────────────────────────────────────────────────────────
  function toggleSet<T extends string>(set: Set<T>, id: T): Set<T> {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  }

  return (
    <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <h1 style={{
            fontSize: '2.2rem', fontFamily: 'var(--font-display)', fontWeight: 700,
            background: 'linear-gradient(135deg, #fff 30%, #a5a6c2)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            Create Exam
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', marginTop: 6 }}>
            AI-generated exam from your knowledge base
          </p>
        </div>

        {/* Stepper */}
        <StepIndicator current={step} />

        {/* Error */}
        {error && (
          <div style={{
            background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)',
            borderRadius: 12, padding: '12px 16px', marginBottom: 24, color: '#f87171', fontSize: '0.9rem',
          }}>
            {error}
          </div>
        )}

        {/* ── STEP 1: Doc + Topic selector ─────────────────────────────────── */}
        {step === 1 && (
          <div className="glass-panel" style={{ marginBottom: 24 }}>
            <SectionTitle icon="📄" label="Step 1 — Select Documents & Topics" />

            {/* Title */}
            <label style={labelStyle}>Exam Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Midterm Review — Chapter 1-5"
              style={inputStyle}
            />

            {/* Exam type */}
            <label style={{ ...labelStyle, marginTop: 20 }}>Exam Mode</label>
            <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
              {EXAM_TYPES.map(et => (
                <button
                  key={et.id}
                  onClick={() => setExamType(et.id)}
                  style={{
                    flex: 1, padding: '12px 8px', borderRadius: 10, cursor: 'pointer',
                    background: examType === et.id ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${examType === et.id ? '#6366f1' : 'rgba(255,255,255,0.08)'}`,
                    color: examType === et.id ? '#a5b4fc' : 'var(--color-text-secondary)',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{et.label}</div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: 4 }}>{et.desc}</div>
                </button>
              ))}
            </div>

            {/* Documents */}
            <label style={labelStyle}>Documents ({selectedDocs.size} selected)</label>
            <CheckboxList
              items={documents.map(d => ({ id: d.id, label: d.title || d.fileType }))}
              selected={selectedDocs}
              onToggle={id => setSelectedDocs(toggleSet(selectedDocs, id))}
              emptyText="No documents found. Upload documents first."
            />

            {/* Topics */}
            <label style={{ ...labelStyle, marginTop: 20 }}>Topics ({selectedTopics.size} selected)</label>
            <CheckboxList
              items={topics.map(t => ({ id: t.id, label: t.name }))}
              selected={selectedTopics}
              onToggle={id => setSelectedTopics(toggleSet(selectedTopics, id))}
              emptyText="No topics found."
            />

            <StepFooter
              onNext={() => setStep(2)}
              nextDisabled={!step1Valid}
              nextLabel="Next: Configure →"
            />
          </div>
        )}

        {/* ── STEP 2: Sliders ──────────────────────────────────────────────── */}
        {step === 2 && (
          <div className="glass-panel" style={{ marginBottom: 24 }}>
            <SectionTitle icon="⚙️" label="Step 2 — Exam Configuration" />

            <SliderField
              label="Total Questions"
              value={totalQuestions}
              min={5} max={100} step={5}
              onChange={setTotalQuestions}
              display={`${totalQuestions} questions`}
            />
            <SliderField
              label="Duration"
              value={durationMinutes}
              min={5} max={180} step={5}
              onChange={setDurationMinutes}
              display={`${durationMinutes} minutes`}
            />

            <label style={{ ...labelStyle, marginTop: 28, marginBottom: 8 }}>
              Difficulty Mix
              {!mixValid && (
                <span style={{ color: '#f87171', marginLeft: 10, fontWeight: 400, fontSize: '0.8rem' }}>
                  Must sum to 100% (currently {mixTotal}%)
                </span>
              )}
            </label>
            <DifficultyMixSliders mix={difficultyMix} onChange={updateMix} />

            {/* Visual bar */}
            <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 16, marginBottom: 28 }}>
              <div style={{ flex: difficultyMix.easy, background: '#10b981', transition: 'flex 0.3s' }} />
              <div style={{ flex: difficultyMix.medium, background: '#f59e0b', transition: 'flex 0.3s' }} />
              <div style={{ flex: difficultyMix.hard, background: '#f43f5e', transition: 'flex 0.3s' }} />
            </div>
            <div style={{ display: 'flex', gap: 20, marginBottom: 8, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              <span><span style={{ color: '#10b981' }}>●</span> Easy {difficultyMix.easy}%</span>
              <span><span style={{ color: '#f59e0b' }}>●</span> Medium {difficultyMix.medium}%</span>
              <span><span style={{ color: '#f43f5e' }}>●</span> Hard {difficultyMix.hard}%</span>
            </div>

            <StepFooter
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
              nextDisabled={!step2Valid}
              nextLabel="Next: Question Types →"
            />
          </div>
        )}

        {/* ── STEP 3: Question type toggles ────────────────────────────────── */}
        {step === 3 && (
          <div className="glass-panel" style={{ marginBottom: 24 }}>
            <SectionTitle icon="❓" label="Step 3 — Question Types" />
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', marginBottom: 24 }}>
              Select one or more question formats to include in the exam.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
              {Q_TYPES.map(qt => {
                const active = questionTypes.has(qt.id);
                return (
                  <button
                    key={qt.id}
                    onClick={() => setQuestionTypes(toggleSet(questionTypes, qt.id))}
                    style={{
                      padding: '20px 16px', borderRadius: 14, cursor: 'pointer',
                      background: active ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)',
                      border: `1.5px solid ${active ? '#6366f1' : 'rgba(255,255,255,0.07)'}`,
                      color: active ? '#a5b4fc' : 'var(--color-text-secondary)',
                      transition: 'all 0.2s', textAlign: 'left',
                    }}
                  >
                    <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>{qt.icon}</div>
                    <div style={{ fontWeight: 600 }}>{qt.label}</div>
                    <div style={{
                      marginTop: 6, fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.05em',
                      color: active ? '#818cf8' : 'var(--color-text-muted)',
                    }}>
                      {active ? '✓ SELECTED' : 'Click to select'}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Summary */}
            <div style={{
              background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.15)',
              borderRadius: 12, padding: '16px 20px', marginBottom: 28, fontSize: '0.85rem',
              color: 'var(--color-text-secondary)',
            }}>
              <strong style={{ color: 'var(--color-text-primary)' }}>Exam Summary</strong>
              <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
                <span>📄 Docs: <strong style={{ color: '#fff' }}>{selectedDocs.size}</strong></span>
                <span>📌 Topics: <strong style={{ color: '#fff' }}>{selectedTopics.size}</strong></span>
                <span>❓ Questions: <strong style={{ color: '#fff' }}>{totalQuestions}</strong></span>
                <span>⏱ Duration: <strong style={{ color: '#fff' }}>{durationMinutes} min</strong></span>
                <span>🎯 Types: <strong style={{ color: '#fff' }}>{[...questionTypes].join(', ')}</strong></span>
                <span>⚖️ Mode: <strong style={{ color: '#fff' }}>{examType}</strong></span>
              </div>
            </div>

            <StepFooter
              onBack={() => setStep(2)}
              onNext={handleSubmit}
              nextDisabled={!step3Valid || loading}
              nextLabel={loading ? 'Generating…' : '🚀 Create Exam'}
              isSubmit
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { n: 1, label: 'Sources' },
    { n: 2, label: 'Config' },
    { n: 3, label: 'Types' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 32, gap: 0 }}>
      {steps.map((s, i) => (
        <React.Fragment key={s.n}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontWeight: 700, fontSize: '0.9rem',
              background: current === s.n ? '#6366f1' : current > s.n ? '#10b981' : 'rgba(255,255,255,0.06)',
              border: `2px solid ${current === s.n ? '#818cf8' : current > s.n ? '#34d399' : 'rgba(255,255,255,0.1)'}`,
              color: current >= s.n ? '#fff' : 'var(--color-text-muted)',
              transition: 'all 0.3s',
            }}>
              {current > s.n ? '✓' : s.n}
            </div>
            <span style={{
              fontSize: '0.75rem', fontWeight: 500,
              color: current === s.n ? '#a5b4fc' : 'var(--color-text-muted)',
            }}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div style={{
              flex: 1, height: 2, margin: '0 8px', marginBottom: 22,
              background: current > s.n ? '#10b981' : 'rgba(255,255,255,0.08)', transition: 'background 0.3s',
            }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function SectionTitle({ icon, label }: { icon: string; label: string }) {
  return (
    <h2 style={{
      fontSize: '1.1rem', fontFamily: 'var(--font-display)', fontWeight: 600,
      color: 'var(--color-text-primary)', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span>{icon}</span> {label}
    </h2>
  );
}

function CheckboxList({
  items, selected, onToggle, emptyText,
}: {
  items: { id: string; label: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: 20 }}>{emptyText}</p>;
  }
  return (
    <div style={{
      maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8,
      paddingRight: 4,
    }}>
      {items.map(item => {
        const checked = selected.has(item.id);
        return (
          <label key={item.id} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10,
            cursor: 'pointer',
            background: checked ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${checked ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.06)'}`,
            transition: 'all 0.15s',
          }}>
            <div style={{
              width: 18, height: 18, borderRadius: 5, flexShrink: 0,
              background: checked ? '#6366f1' : 'transparent',
              border: `2px solid ${checked ? '#6366f1' : 'rgba(255,255,255,0.2)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}>
              {checked && <span style={{ color: '#fff', fontSize: '0.7rem', lineHeight: 1 }}>✓</span>}
            </div>
            <input type="checkbox" checked={checked} onChange={() => onToggle(item.id)} style={{ display: 'none' }} />
            <span style={{ fontSize: '0.9rem', color: checked ? '#e0e0ff' : 'var(--color-text-secondary)' }}>
              {item.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function SliderField({
  label, value, min, max, step, onChange, display,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; display: string;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <label style={labelStyle}>{label}</label>
        <span style={{
          background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', borderRadius: 8,
          padding: '2px 10px', fontSize: '0.85rem', fontWeight: 600,
        }}>{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#6366f1', cursor: 'pointer' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
        <span>{min}</span><span>{max}</span>
      </div>
    </div>
  );
}

function DifficultyMixSliders({
  mix, onChange,
}: { mix: DifficultyMix; onChange: (k: keyof DifficultyMix, v: number) => void }) {
  const fields: { key: keyof DifficultyMix; label: string; color: string }[] = [
    { key: 'easy',   label: 'Easy',   color: '#10b981' },
    { key: 'medium', label: 'Medium', color: '#f59e0b' },
    { key: 'hard',   label: 'Hard',   color: '#f43f5e' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {fields.map(f => (
        <div key={f.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ color: f.color, fontWeight: 600, fontSize: '0.85rem' }}>{f.label}</span>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.9rem' }}>{mix[f.key]}%</span>
          </div>
          <input
            type="range" min={0} max={100} step={5} value={mix[f.key]}
            onChange={e => onChange(f.key, Number(e.target.value))}
            style={{ width: '100%', accentColor: f.color, cursor: 'pointer' }}
          />
        </div>
      ))}
    </div>
  );
}

function StepFooter({
  onBack, onNext, nextDisabled, nextLabel, isSubmit,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  nextLabel: string;
  isSubmit?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 }}>
      {onBack ? (
        <button onClick={onBack} style={ghostBtnStyle}>← Back</button>
      ) : <div />}
      <button
        onClick={onNext}
        disabled={nextDisabled}
        style={{
          padding: '12px 28px', borderRadius: 12, fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer',
          background: nextDisabled ? 'rgba(99,102,241,0.2)' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
          border: 'none', color: nextDisabled ? 'rgba(165,164,252,0.4)' : '#fff',
          boxShadow: nextDisabled ? 'none' : '0 4px 20px rgba(99,102,241,0.4)',
          transition: 'all 0.2s', opacity: nextDisabled ? 0.6 : 1,
        }}
      >
        {nextLabel}
      </button>
    </div>
  );
}

// ── Style constants ────────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-secondary)',
  marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 16px', borderRadius: 12, marginBottom: 8,
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  color: 'var(--color-text-primary)', fontSize: '1rem', outline: 'none',
};

const ghostBtnStyle: React.CSSProperties = {
  padding: '12px 20px', borderRadius: 12, fontWeight: 500, fontSize: '0.9rem', cursor: 'pointer',
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  color: 'var(--color-text-secondary)',
};

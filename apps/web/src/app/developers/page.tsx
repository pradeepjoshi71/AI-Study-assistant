'use client';

import React from 'react';
import Link from 'next/link';

export default function DevelopersLandingPage() {
  return (
    <div style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', paddingBottom: '80px' }}>
      {/* Decorative Glows */}
      <div className="bg-glow-1" />
      <div className="bg-glow-2" />

      {/* Navigation */}
      <nav style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '24px 5%',
        borderBottom: '1px solid var(--glass-border)',
        background: 'rgba(10, 10, 12, 0.6)',
        backdropFilter: 'blur(12px)',
        position: 'relative',
        zIndex: 10
      }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700, background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          StudyAssistant Devs
        </div>
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <Link href="/developers/docs" style={{ color: 'var(--color-text-secondary)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-secondary)'}>
            Documentation
          </Link>
          <Link href="/developers/playground" style={{ color: 'var(--color-text-secondary)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-text-primary)'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-secondary)'}>
            Playground
          </Link>
          <Link href="/developers/dashboard" style={{
            background: 'linear-gradient(135deg, var(--color-primary), #4f46e5)',
            color: '#fff',
            textDecoration: 'none',
            padding: '10px 20px',
            borderRadius: '10px',
            fontWeight: 500,
            fontSize: '0.95rem',
            boxShadow: '0 4px 14px rgba(99, 102, 241, 0.3)',
            transition: 'transform 0.2s'
          }} onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
            Developer Console
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <header style={{
        maxWidth: '1200px',
        margin: '80px auto 0 auto',
        padding: '0 24px',
        textAlign: 'center',
        position: 'relative',
        zIndex: 2
      }}>
        <h1 style={{
          fontSize: '3.5rem',
          fontWeight: 700,
          lineHeight: 1.1,
          fontFamily: 'var(--font-display)',
          marginBottom: '24px'
        }}>
          Power your applications with<br />
          <span style={{ background: 'linear-gradient(135deg, #a5b4fc, var(--color-secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Production-Ready Study APIs
          </span>
        </h1>
        <p style={{
          color: 'var(--color-text-secondary)',
          fontSize: '1.25rem',
          maxWidth: '650px',
          margin: '0 auto 40px auto',
          lineHeight: 1.6
        }}>
          Access spaced-repetition flashcards, interactive multi-document AI chat sessions, automated grading, and real-time event webhooks with a single API key.
        </p>
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
          <Link href="/developers/dashboard" style={{
            background: 'linear-gradient(135deg, var(--color-primary), #4f46e5)',
            color: '#fff',
            textDecoration: 'none',
            padding: '14px 28px',
            borderRadius: '12px',
            fontWeight: 600,
            transition: 'transform 0.2s, box-shadow 0.2s'
          }} onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(99, 102, 241, 0.4)'; }} onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
            Get API Key
          </Link>
          <Link href="/developers/docs" style={{
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid var(--glass-border)',
            color: 'var(--color-text-primary)',
            textDecoration: 'none',
            padding: '14px 28px',
            borderRadius: '12px',
            fontWeight: 600,
            backdropFilter: 'blur(10px)',
            transition: 'background-color 0.2s'
          }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'}>
            Explore API Docs
          </Link>
        </div>
      </header>

      {/* Feature Showcase Grid */}
      <section style={{ maxWidth: '1200px', margin: '100px auto 0 auto', padding: '0 24px', position: 'relative', zIndex: 2 }}>
        <h2 style={{ fontSize: '2rem', textAlign: 'center', marginBottom: '48px', fontFamily: 'var(--font-display)' }}>
          Robust Features Built for Developers
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
          <div className="glass-panel" style={{ padding: '32px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', backgroundColor: 'var(--color-primary-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px', color: 'var(--color-primary)', fontSize: '1.5rem', fontWeight: 'bold' }}>
              📚
            </div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '12px', color: 'var(--color-text-primary)' }}>Document Processing</h3>
            <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.5, fontSize: '0.95rem' }}>
              Upload files to queue RAG chunking and vector embeddings. Manage organization learning material via API.
            </p>
          </div>
          <div className="glass-panel" style={{ padding: '32px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', backgroundColor: 'var(--color-secondary-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px', color: 'var(--color-secondary)', fontSize: '1.5rem', fontWeight: 'bold' }}>
              💬
            </div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '12px', color: 'var(--color-text-primary)' }}>Streaming Chat Sessions</h3>
            <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.5, fontSize: '0.95rem' }}>
              Create conversation sessions on multiple documents. Fetch responses via SSE stream channels natively.
            </p>
          </div>
          <div className="glass-panel" style={{ padding: '32px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', backgroundColor: 'var(--color-success-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px', color: 'var(--color-success)', fontSize: '1.5rem', fontWeight: 'bold' }}>
              ✏️
            </div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '12px', color: 'var(--color-text-primary)' }}>Automated Quizzes</h3>
            <p style={{ color: 'var(--color-text-secondary)', lineHeight: 1.5, fontSize: '0.95rem' }}>
              Generate comprehensive evaluations automatically. Grade answers instantly and update difficulty curves.
            </p>
          </div>
        </div>
      </section>

      {/* SDK Installation Snippets */}
      <section style={{ maxWidth: '800px', margin: '100px auto 0 auto', padding: '0 24px', position: 'relative', zIndex: 2 }}>
        <div className="glass-panel" style={{ padding: '32px' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '24px', fontFamily: 'var(--font-display)' }}>
            Get Started with Our SDKs
          </h2>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>TypeScript SDK</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-primary)' }}>npm</span>
              </div>
              <div style={{
                background: '#070709',
                border: '1px solid var(--glass-border)',
                padding: '16px 20px',
                borderRadius: '10px',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
                color: '#e4e4e7',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span>npm install @study-assistant/sdk-typescript</span>
                <button onClick={() => navigator.clipboard.writeText('npm install @study-assistant/sdk-typescript')} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', outline: 'none' }} title="Copy">
                  📋
                </button>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Python SDK</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-secondary)' }}>pip</span>
              </div>
              <div style={{
                background: '#070709',
                border: '1px solid var(--glass-border)',
                padding: '16px 20px',
                borderRadius: '10px',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
                color: '#e4e4e7',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span>pip install study-assistant-sdk-python</span>
                <button onClick={() => navigator.clipboard.writeText('pip install study-assistant-sdk-python')} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', outline: 'none' }} title="Copy">
                  📋
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

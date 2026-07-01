'use client';

import React from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

// Import SwaggerUI CSS
import 'swagger-ui-react/swagger-ui.css';

// Dynamically import SwaggerUI to prevent Server-Side Rendering (SSR) issues in Next.js
const SwaggerUI = dynamic(() => import('swagger-ui-react'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px', color: 'var(--color-text-secondary)' }}>
      <div style={{ fontSize: '1.2rem', fontFamily: 'var(--font-sans)' }}>Loading Swagger UI...</div>
    </div>
  ),
});

export default function DevelopersDocsPage() {
  // Construct the absolute openapi.json endpoint relative to backend domain
  const publicApiUrl = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:3001/api/public/v1/openapi.json`
    : 'http://localhost:3001/api/public/v1/openapi.json';

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f0f11', color: '#f4f4f7' }}>
      {/* Navigation */}
      <nav style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 5%',
        borderBottom: '1px solid #222227',
        background: '#121216',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <Link href="/developers" style={{
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
            fontSize: '0.95rem',
            fontWeight: 500,
            transition: 'color 0.2s'
          }} onMouseEnter={(e) => e.currentTarget.style.color = '#fff'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-secondary)'}>
            ← Back to Landing
          </Link>
          <span style={{ color: '#333339' }}>|</span>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700 }}>
            API References
          </div>
        </div>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <Link href="/developers/playground" style={{ color: 'var(--color-text-secondary)', textDecoration: 'none', fontSize: '0.95rem' }} onMouseEnter={(e) => e.currentTarget.style.color = '#fff'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text-secondary)'}>
            Playground
          </Link>
          <Link href="/developers/dashboard" style={{
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid #222227',
            color: '#fff',
            textDecoration: 'none',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '0.9rem',
            fontWeight: 500
          }}>
            Developer Console
          </Link>
        </div>
      </nav>

      {/* Embedded Swagger Specs */}
      <div style={{ maxWidth: '1400px', margin: '40px auto 0 auto', padding: '0 24px pb-60' }}>
        <div className="swagger-dark-wrapper" style={{
          background: '#fff', // SwaggerUI default background is white, which is easier to read for its defaults unless heavily customized
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
          border: '1px solid #222227'
        }}>
          <SwaggerUI url={publicApiUrl} docExpansion="list" />
        </div>
      </div>

      <style jsx global>{`
        /* Minimal styling adjustments to clean up Swagger default margins */
        .swagger-ui {
          font-family: var(--font-sans) !important;
        }
        .swagger-ui .info {
          margin: 30px 0 !important;
          padding: 0 40px !important;
        }
        .swagger-ui .scheme-container {
          padding: 20px 40px !important;
          background: #f7f7f9 !important;
        }
        .swagger-ui .wrapper {
          padding: 0 !important;
          max-width: 100% !important;
        }
        .swagger-ui .opblock-tag-section {
          padding: 0 40px !important;
        }
      `}</style>
    </div>
  );
}

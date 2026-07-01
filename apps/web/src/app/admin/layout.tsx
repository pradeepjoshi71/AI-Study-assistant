'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [tokenSynced, setTokenSynced] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    // --- Token Cookie Sync --------------------------------------------------
    // Next.js middleware needs the token in cookies, but the app stores it
    // in localStorage. We sync it on mount for admin pages.
    const token = localStorage.getItem('token');
    if (token) {
      document.cookie = `token=${token}; path=/; max-age=86400; SameSite=Strict`;
      
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          setRole(payload.systemRole);
          if (payload.systemRole !== 'SUPER_ADMIN' && payload.systemRole !== 'ORG_ADMIN') {
            router.push('/');
          }
        }
      } catch (err) {
        router.push('/');
      }
      setTokenSynced(true);
    } else {
      router.push('/');
    }
  }, [router]);

  if (!tokenSynced) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0c', color: '#9496a8' }}>
        <div className="glass-panel" style={{ textAlign: 'center' }}>
          <h2>Authenticating Admin Session...</h2>
          <p style={{ marginTop: '10px' }}>Syncing secure context credentials.</p>
        </div>
      </div>
    );
  }

  const navItems = [
    { name: 'Users', path: '/admin/users' },
    { name: 'Orgs', path: '/admin/orgs' },
    { name: 'Billing', path: '/admin/billing' },
    { name: 'System', path: '/admin/system' },
    { name: 'Flags', path: '/admin/flags' },
    { name: 'Logs', path: '/admin/logs' },
    { name: 'Compliance', path: '/admin/compliance' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#0a0a0c', color: '#f4f4f7' }}>
      {/* -- Fixed Sidebar ------------------------------------------------------ */}
      <aside style={{
        position: 'fixed',
        left: 0,
        top: 0,
        bottom: 0,
        width: '260px',
        backgroundColor: '#121216',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 10,
        padding: '24px 16px'
      }}>
        <div style={{ marginBottom: '32px', paddingLeft: '8px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#6366f1', fontFamily: 'var(--font-display)' }}>
            Study Control
          </h1>
          <span style={{ fontSize: '12px', color: '#5e6175' }}>
            Platform Admin Center ({role || 'ADMIN'})
          </span>
        </div>

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.path);
            return (
              <Link key={item.path} href={item.path} style={{
                textDecoration: 'none',
                color: isActive ? '#f4f4f7' : '#9496a8',
                backgroundColor: isActive ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                border: isActive ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
                borderRadius: '8px',
                padding: '12px 16px',
                fontSize: '14px',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                transition: 'all 0.2s ease-in-out'
              }}>
                <div style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: isActive ? '#6366f1' : 'transparent'
                }} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '16px' }}>
          <button 
            onClick={() => {
              localStorage.removeItem('token');
              document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
              router.push('/');
            }}
            style={{
              width: '100%',
              padding: '10px',
              backgroundColor: 'transparent',
              border: '1px solid rgba(244,63,94,0.3)',
              color: '#f43f5e',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '13px',
              transition: 'all 0.2s'
            }}
          >
            Exit Control Room
          </button>
        </div>
      </aside>

      {/* -- Main Panel -------------------------------------------------------- */}
      <main style={{ marginLeft: '260px', flex: 1, padding: '40px', minWidth: 0 }}>
        {children}
      </main>
    </div>
  );
}

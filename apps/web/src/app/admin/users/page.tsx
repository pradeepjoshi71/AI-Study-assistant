'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface UserItem {
  id: string;
  email: string;
  name: string | null;
  role: string;
  systemRole: string;
  subscriptionPlan: string;
  isActive: boolean;
  deletedAt: string | null;
  createdAt: string;
  organizationMemberships: Array<{
    orgId: string;
    role: string;
    organization: { name: string; slug: string };
  }>;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  
  // Filters
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [orgIdFilter, setOrgIdFilter] = useState('');

  // Selection & Loading
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (planFilter) params.append('plan', planFilter);
      if (roleFilter) params.append('systemRole', roleFilter);
      if (statusFilter) params.append('status', statusFilter);
      if (orgIdFilter) params.append('orgId', orgIdFilter);

      const res = await fetch(`${apiUrl}/admin/users?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error('Failed to load users');
      const data = await res.json();
      
      let items: UserItem[] = data.items || [];
      if (search) {
        const query = search.toLowerCase();
        items = items.filter(u => 
          u.email.toLowerCase().includes(query) || 
          (u.name && u.name.toLowerCase().includes(query))
        );
      }

      setUsers(items);
      setTotal(data.total || items.length);
    } catch (err: any) {
      setMessage({ text: err.message || 'Error loading users', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [page, limit, planFilter, roleFilter, statusFilter, orgIdFilter, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Bulk Selection
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(users.map(u => u.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // Impersonate
  const handleImpersonate = async (id: string) => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiUrl}/admin/users/${id}/impersonate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) throw new Error('Impersonation failed');
      const data = await res.json();
      
      localStorage.setItem('token', data.accessToken);
      document.cookie = `token=${data.accessToken}; path=/; max-age=86400; SameSite=Strict`;
      
      setMessage({ text: 'Impersonating user. Redirecting to workspace...', type: 'success' });
      setTimeout(() => {
        router.push('/chat');
      }, 1500);
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    }
  };

  // Delete (soft)
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to soft-delete this user? Their email will be anonymized.')) return;
    try {
      const token = localStorage.getItem('token');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiUrl}/admin/users/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error('Delete failed');
      setMessage({ text: 'User soft-deleted successfully', type: 'success' });
      fetchUsers();
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    }
  };

  // Export CSV
  const handleExport = async () => {
    try {
      const token = localStorage.getItem('token');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
      const res = await fetch(`${apiUrl}/admin/users/export`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan: planFilter || undefined,
          systemRole: roleFilter || undefined,
          status: statusFilter || undefined,
          orgId: orgIdFilter || undefined,
        }),
      });

      if (!res.ok) throw new Error('Export trigger failed');
      const data = await res.json();
      
      setMessage({ text: `Export job ${data.jobId} queued successfully!`, type: 'success' });
    } catch (err: any) {
      setMessage({ text: err.message, type: 'error' });
    }
  };

  // Bulk Actions
  const handleBulkAction = async (action: string) => {
    if (selectedIds.size === 0) return;
    
    if (action === 'delete') {
      if (!confirm(`Are you sure you want to soft-delete ${selectedIds.size} users?`)) return;
      let count = 0;
      for (const id of Array.from(selectedIds)) {
        try {
          const token = localStorage.getItem('token');
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
          await fetch(`${apiUrl}/admin/users/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
          });
          count++;
        } catch {}
      }
      setMessage({ text: `Successfully processed ${count} soft-deletions`, type: 'success' });
      setSelectedIds(new Set());
      fetchUsers();
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h2 style={{ fontSize: '28px', color: '#f4f4f7' }}>Users Control Room</h2>
          <p style={{ color: '#9496a8', marginTop: '4px' }}>Monitor profiles, status overrides, and active memberships.</p>
        </div>
        <button 
          onClick={handleExport}
          className="glass-panel" 
          style={{
            padding: '10px 20px',
            color: '#6366f1',
            border: '1px solid rgba(99,102,241,0.3)',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '14px',
            backgroundColor: 'rgba(99,102,241,0.06)'
          }}
        >
          Export CSV (BullMQ)
        </button>
      </header>

      {message && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '8px',
          marginBottom: '20px',
          fontSize: '14px',
          fontWeight: 500,
          backgroundColor: message.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)',
          border: message.type === 'success' ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(244,63,94,0.3)',
          color: message.type === 'success' ? '#10b981' : '#f43f5e',
        }}>
          {message.text}
        </div>
      )}

      {/* Filters Area */}
      <div className="glass-panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px', padding: '16px' }}>
        <input
          type="text"
          placeholder="Search by email, name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            backgroundColor: '#0a0a0c',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px',
            padding: '8px 12px',
            color: '#f4f4f7',
            fontSize: '13px'
          }}
        />

        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          style={{
            backgroundColor: '#0a0a0c',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px',
            padding: '8px 12px',
            color: '#9496a8',
            fontSize: '13px'
          }}
        >
          <option value="">All Plans</option>
          <option value="FREE">Free</option>
          <option value="PRO">Pro</option>
        </select>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          style={{
            backgroundColor: '#0a0a0c',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px',
            padding: '8px 12px',
            color: '#9496a8',
            fontSize: '13px'
          }}
        >
          <option value="">All Roles</option>
          <option value="USER">User</option>
          <option value="ORG_ADMIN">Org Admin</option>
          <option value="SUPER_ADMIN">Super Admin</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            backgroundColor: '#0a0a0c',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px',
            padding: '8px 12px',
            color: '#9496a8',
            fontSize: '13px'
          }}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="deleted">Deleted</option>
        </select>

        <input
          type="text"
          placeholder="Organization ID"
          value={orgIdFilter}
          onChange={(e) => setOrgIdFilter(e.target.value)}
          style={{
            backgroundColor: '#0a0a0c',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px',
            padding: '8px 12px',
            color: '#f4f4f7',
            fontSize: '13px'
          }}
        />
      </div>

      {/* Bulk Action Controls */}
      {selectedIds.size > 0 && (
        <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px', padding: '12px 16px', backgroundColor: 'rgba(99,102,241,0.05)' }}>
          <span style={{ fontSize: '13px', color: '#9496a8' }}>
            <strong>{selectedIds.size}</strong> rows selected
          </span>
          <select
            onChange={(e) => handleBulkAction(e.target.value)}
            defaultValue=""
            style={{
              backgroundColor: '#0a0a0c',
              border: '1px solid rgba(244,63,94,0.3)',
              borderRadius: '6px',
              padding: '6px 12px',
              color: '#f43f5e',
              fontSize: '13px',
              fontWeight: 500
            }}
          >
            <option value="" disabled>Bulk Action...</option>
            <option value="delete">Soft Delete Selected</option>
          </select>
        </div>
      )}

      {/* Custom Sleek Data Table */}
      <div className="glass-panel" style={{ padding: 0, overflowX: 'auto', border: '1px solid rgba(255,255,255,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: '#121216', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <th style={{ padding: '16px' }}>
                <input 
                  type="checkbox" 
                  onChange={handleSelectAll} 
                  checked={users.length > 0 && selectedIds.size === users.length} 
                />
              </th>
              <th style={{ padding: '16px', color: '#f4f4f7', fontWeight: 600 }}>User / Email</th>
              <th style={{ padding: '16px', color: '#f4f4f7', fontWeight: 600 }}>System Role</th>
              <th style={{ padding: '16px', color: '#f4f4f7', fontWeight: 600 }}>Plan</th>
              <th style={{ padding: '16px', color: '#f4f4f7', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '16px', color: '#f4f4f7', fontWeight: 600 }}>Joined</th>
              <th style={{ padding: '16px', color: '#f4f4f7', fontWeight: 600, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#9496a8' }}>
                  Querying database records...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#9496a8' }}>
                  No users found matching current filter context.
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const isSelected = selectedIds.has(user.id);
                return (
                  <tr key={user.id} style={{ 
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.03)' : 'transparent',
                    transition: 'background-color 0.2s'
                  }}>
                    <td style={{ padding: '16px' }}>
                      <input 
                        type="checkbox" 
                        checked={isSelected} 
                        onChange={() => handleSelectOne(user.id)} 
                      />
                    </td>
                    <td style={{ padding: '16px' }}>
                      <div style={{ fontWeight: 500, color: '#f4f4f7' }}>{user.name || 'Anonymous User'}</div>
                      <div style={{ color: '#9496a8', fontSize: '11px', marginTop: '2px' }}>{user.email}</div>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: user.systemRole === 'SUPER_ADMIN' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                        color: user.systemRole === 'SUPER_ADMIN' ? '#6366f1' : '#9496a8'
                      }}>
                        {user.systemRole}
                      </span>
                    </td>
                    <td style={{ padding: '16px', color: '#f4f4f7', fontWeight: 500 }}>
                      {user.subscriptionPlan}
                    </td>
                    <td style={{ padding: '16px' }}>
                      <span style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        display: 'inline-block',
                        marginRight: '8px',
                        backgroundColor: user.deletedAt ? '#f43f5e' : user.isActive ? '#10b981' : '#5e6175'
                      }} />
                      <span style={{ color: '#9496a8', fontSize: '12px' }}>
                        {user.deletedAt ? 'Deleted' : user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '16px', color: '#9496a8' }}>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <Link href={`/admin/users/${user.id}`} style={{
                          textDecoration: 'none',
                          color: '#6366f1',
                          fontWeight: 500,
                          fontSize: '12px',
                          padding: '4px 8px',
                          border: '1px solid rgba(99, 102, 241, 0.2)',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(99, 102, 241, 0.04)'
                        }}>
                          Manage
                        </Link>
                        {!user.deletedAt && (
                          <>
                            <button onClick={() => handleImpersonate(user.id)} style={{
                              backgroundColor: 'transparent',
                              border: '1px solid rgba(6,182,212,0.2)',
                              color: '#06b6d4',
                              borderRadius: '4px',
                              padding: '4px 8px',
                              fontSize: '12px',
                              fontWeight: 500,
                              cursor: 'pointer'
                            }}>
                              Impersonate
                            </button>
                            <button onClick={() => handleDelete(user.id)} style={{
                              backgroundColor: 'transparent',
                              border: '1px solid rgba(244,63,94,0.2)',
                              color: '#f43f5e',
                              borderRadius: '4px',
                              padding: '4px 8px',
                              fontSize: '12px',
                              fontWeight: 500,
                              cursor: 'pointer'
                            }}>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px' }}>
        <span style={{ fontSize: '13px', color: '#9496a8' }}>
          Total records: <strong>{total}</strong>
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            disabled={page === 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            style={{
              padding: '6px 12px',
              backgroundColor: '#121216',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '6px',
              color: page === 1 ? '#5e6175' : '#f4f4f7',
              cursor: page === 1 ? 'not-allowed' : 'pointer'
            }}
          >
            Previous
          </button>
          <span style={{ alignSelf: 'center', fontSize: '13px', color: '#9496a8' }}>
            Page <strong>{page}</strong>
          </span>
          <button 
            disabled={page * limit >= total}
            onClick={() => setPage(p => p + 1)}
            style={{
              padding: '6px 12px',
              backgroundColor: '#121216',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '6px',
              color: page * limit >= total ? '#5e6175' : '#f4f4f7',
              cursor: page * limit >= total ? 'not-allowed' : 'pointer'
            }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

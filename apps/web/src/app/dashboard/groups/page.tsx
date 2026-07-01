import { cookies } from 'next/headers';
import Link from 'next/link';
import GroupsClient from './GroupsClient';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

async function fetchGroupsAndDocs(token: string) {
  try {
    const [groupsRes, docsRes] = await Promise.all([
      fetch(`${apiUrl}/groups`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }),
      fetch(`${apiUrl}/documents`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }),
    ]);
    const groups = groupsRes.ok ? await groupsRes.json() : [];
    const docs = docsRes.ok ? await docsRes.json() : [];
    return { groups, docs };
  } catch (err) {
    console.error('Failed to fetch groups/docs:', err);
    return { groups: [], docs: [] };
  }
}

export const metadata = {
  title: 'Study Groups — AI Study Assistant',
  description: 'Collaborate with classmates and study with AI assistants.',
};

export default async function GroupsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;

  if (!token) {
    return (
      <main style={{ padding: '80px 20px', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-text-muted)' }}>Please log in to manage your groups.</p>
        <Link href="/" style={{ color: 'var(--color-primary)' }}>Go home</Link>
      </main>
    );
  }

  const { groups, docs } = await fetchGroupsAndDocs(token);

  return <GroupsClient initialGroups={groups} documents={docs} token={token} />;
}

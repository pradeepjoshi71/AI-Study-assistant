import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import GroupDetailsClient from './GroupDetailsClient';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

async function fetchGroupData(groupId: string, token: string) {
  try {
    const [groupRes, allDocsRes] = await Promise.all([
      fetch(`${apiUrl}/groups/${groupId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }),
      fetch(`${apiUrl}/documents`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }),
    ]);

    if (!groupRes.ok) return null;
    const group = await groupRes.json();
    const allDocs = allDocsRes.ok ? await allDocsRes.json() : [];
    return { group, allDocs };
  } catch (err) {
    console.error('Failed to load group details:', err);
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Group ${id} Details — AI Study Assistant` };
}

export default async function GroupDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;

  if (!token) notFound();

  const data = await fetchGroupData(id, token);
  if (!data) notFound();

  return (
    <GroupDetailsClient
      groupId={id}
      initialGroup={data.group}
      allDocuments={data.allDocs}
      token={token}
    />
  );
}

import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import GroupSessionClient from './GroupSessionClient';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

async function fetchSessionData(groupId: string, sessionId: string, token: string) {
  try {
    const [groupRes, sessionRes] = await Promise.all([
      fetch(`${apiUrl}/groups/${groupId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }),
      // We can get group messages/sessions
      fetch(`${apiUrl}/groups/${groupId}/sessions/${sessionId}/messages?limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }),
    ]);

    if (!groupRes.ok) return null;
    const group = await groupRes.json();
    const initialMessages = sessionRes.ok ? await sessionRes.json() : [];
    
    // Find active session
    const session = group.sessions?.find((s: any) => s.id === sessionId);
    if (!session) return null;

    return { group, session, initialMessages };
  } catch (err) {
    console.error('Failed to load session:', err);
    return null;
  }
}

export const metadata = {
  title: 'Active Study Room — AI Study Assistant',
};

export default async function GroupSessionPage({
  params,
}: {
  params: Promise<{ id: string; sid: string }>;
}) {
  const { id, sid } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;

  if (!token) notFound();

  const data = await fetchSessionData(id, sid, token);
  if (!data) notFound();

  return (
    <GroupSessionClient
      groupId={id}
      sessionId={sid}
      group={data.group}
      session={data.session}
      initialMessages={data.initialMessages}
      token={token}
    />
  );
}

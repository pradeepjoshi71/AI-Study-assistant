import { cookies } from 'next/headers';
import Link from 'next/link';
import ExamCreateClient from './ExamCreateClient';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

async function fetchDocumentsAndTopics(token: string) {
  try {
    const [docsRes, topicsRes] = await Promise.all([
      fetch(`${apiUrl}/documents`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }),
      fetch(`${apiUrl}/topics`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }),
    ]);
    const docs = docsRes.ok ? await docsRes.json() : [];
    const topics = topicsRes.ok ? await topicsRes.json() : [];
    return { docs, topics };
  } catch {
    return { docs: [], topics: [] };
  }
}

export const metadata = {
  title: 'Create Exam — AI Study Assistant',
  description: 'Build an AI-generated exam from your documents and topics.',
};

export default async function ExamCreatePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;

  if (!token) {
    return (
      <main style={{ padding: '80px 20px', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-text-muted)' }}>Please log in to create an exam.</p>
        <Link href="/" style={{ color: 'var(--color-primary)' }}>Go home</Link>
      </main>
    );
  }

  const { docs, topics } = await fetchDocumentsAndTopics(token);

  return <ExamCreateClient token={token} documents={docs} topics={topics} />;
}

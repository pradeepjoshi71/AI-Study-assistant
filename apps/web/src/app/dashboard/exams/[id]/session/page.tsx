import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import ExamSessionClient from './ExamSessionClient';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

async function fetchExamQuestions(examId: string, token: string) {
  const res = await fetch(`${apiUrl}/exams/${examId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json();
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Exam Session ${id} — AI Study Assistant` };
}

export default async function ExamSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;

  if (!token) notFound();

  const exam = await fetchExamQuestions(id, token!);
  if (!exam) notFound();

  return <ExamSessionClient exam={exam} token={token!} />;
}

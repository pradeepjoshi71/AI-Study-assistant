import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import ExamResultClient from './ExamResultClient';

const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

async function fetchResultData(examId: string, attemptId: string, token: string) {
  try {
    // Score the attempt (idempotent on re-call)
    const scoreRes = await fetch(`${apiUrl}/exams/attempts/${attemptId}/score`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    const scoreData = scoreRes.ok ? await scoreRes.json() : null;

    // Fetch exam with questions
    const examRes = await fetch(`${apiUrl}/exams/${examId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const exam = examRes.ok ? await examRes.json() : null;

    // Fetch attempt answers
    const answersRes = await fetch(`${apiUrl}/exams/attempts/${attemptId}/answers`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const answers = answersRes.ok ? await answersRes.json() : [];

    return { scoreData, exam, answers };
  } catch {
    return { scoreData: null, exam: null, answers: [] };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Exam Results — AI Study Assistant` };
}

export default async function ExamResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ attemptId?: string }>;
}) {
  const { id } = await params;
  const { attemptId } = await searchParams;

  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;

  if (!token || !attemptId) notFound();

  const { scoreData, exam, answers } = await fetchResultData(id, attemptId, token!);
  if (!exam) notFound();

  return (
    <ExamResultClient
      examId={id}
      exam={exam}
      scoreData={scoreData}
      answers={answers}
      token={token!}
    />
  );
}

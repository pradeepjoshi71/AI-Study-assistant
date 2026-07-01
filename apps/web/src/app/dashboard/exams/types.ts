// ─── Exam Module Type Definitions ────────────────────────────────────────────

export type ExamType = 'PRACTICE' | 'MOCK' | 'TIMED';
export type ExamStatus = 'DRAFT' | 'READY' | 'ARCHIVED';
export type QuestionType = 'MCQ' | 'TRUE_FALSE' | 'SHORT' | 'FILL';
export type AttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED';
export type Classification = 'CRITICAL' | 'REVIEW' | 'MASTERED';

export interface DifficultyMix {
  easy: number;   // 0-100 %
  medium: number;
  hard: number;
}

export interface Exam {
  id: string;
  title: string;
  orgId: string;
  createdBy: string;
  docIds: string[];
  topicIds: string[];
  totalQuestions: number;
  durationMinutes: number;
  difficulty: number;
  type: ExamType;
  status: ExamStatus;
  createdAt: string;
}

export interface ExamQuestion {
  id: string;
  examId: string;
  questionText: string;
  type: QuestionType;
  options: Record<string, string> | null;
  correctAnswer: string;
  explanation: string;
  topicId: string | null;
  difficulty: number;
  points: number;
}

export interface AttemptAnswer {
  attemptId: string;
  questionId: string;
  userAnswer: string;
  isCorrect: boolean;
  timeTakenMs: number;
  pointsAwarded: number;
}

export interface ExamAttempt {
  id: string;
  examId: string;
  userId: string;
  startedAt: string;
  submittedAt: string | null;
  score: number;
  percentile: number;
  status: AttemptStatus;
}

export interface TopicBreakdownItem {
  topicId: string;
  correct: number;
  total: number;
  scorePercent: number;
  difficultyWeight: number;
}

export interface ExamResult {
  attemptId: string;
  totalScore: number;
  maxScore: number;
  topicBreakdown: TopicBreakdownItem[];
  weakTopics: string[];
  timingAnalysis: {
    avgMs: number;
    minMs: number;
    maxMs: number;
    totalMs: number;
    byType: Record<string, number>;
    slowQuestions: string[];
  };
}

export interface ScoreResponse {
  attemptId: string;
  totalScore: number;
  maxScore: number;
  percentile: number;
  topicBreakdown: TopicBreakdownItem[];
  weakTopics: string[];
  timingAnalysis: Record<string, any>;
}

export interface Document {
  id: string;
  title: string;
  fileType: string;
}

export interface Topic {
  id: string;
  name: string;
  docId?: string;
}

import { PrismaClient, BadgeTriggerType } from "@prisma/client";

const prisma = new PrismaClient();

const BADGES = [
  // ── Actions (Uploads / Quizzes) ──────────────────────────────────────────
  {
    name: "First Upload",
    description: "Upload your first study document to the platform.",
    icon: "file-upload",
    triggerType: BadgeTriggerType.ACTION,
    triggerValue: 1,
  },
  {
    name: "Document Hoarder",
    description: "Ingest a total of 10 documents into your knowledge store.",
    icon: "archive",
    triggerType: BadgeTriggerType.ACTION,
    triggerValue: 10,
  },
  {
    name: "Library Builder",
    description: "Ingest a total of 50 documents into your knowledge store.",
    icon: "library",
    triggerType: BadgeTriggerType.ACTION,
    triggerValue: 50,
  },
  {
    name: "First Quiz",
    description: "Complete your first generated AI quiz attempt.",
    icon: "award",
    triggerType: BadgeTriggerType.ACTION,
    triggerValue: 1,
  },
  {
    name: "Quiz Enthusiast",
    description: "Attempt a total of 10 study quizzes.",
    icon: "brain",
    triggerType: BadgeTriggerType.ACTION,
    triggerValue: 10,
  },
  {
    name: "Quiz Master",
    description: "Attempt a total of 50 study quizzes.",
    icon: "crown",
    triggerType: BadgeTriggerType.ACTION,
    triggerValue: 50,
  },

  // ── Streaks (Consecutive Days Active) ─────────────────────────────────────
  {
    name: "Weekly Warrior",
    description: "Maintain a study streak of 7 consecutive days.",
    icon: "zap",
    triggerType: BadgeTriggerType.STREAK,
    triggerValue: 7,
  },
  {
    name: "Monthly Maven",
    description: "Maintain a study streak of 30 consecutive days.",
    icon: "calendar-check",
    triggerType: BadgeTriggerType.STREAK,
    triggerValue: 30,
  },
  {
    name: "Centurion Scholar",
    description: "Maintain a study streak of 100 consecutive days.",
    icon: "shield",
    triggerType: BadgeTriggerType.STREAK,
    triggerValue: 100,
  },

  // ── Milestones (User Levels) ─────────────────────────────────────────────
  {
    name: "Freshman",
    description: "Reach level 5.",
    icon: "user-graduate",
    triggerType: BadgeTriggerType.MILESTONE,
    triggerValue: 5,
  },
  {
    name: "Sophomore",
    description: "Reach level 10.",
    icon: "book-reader",
    triggerType: BadgeTriggerType.MILESTONE,
    triggerValue: 10,
  },
  {
    name: "Junior Elite",
    description: "Reach level 25.",
    icon: "medal",
    triggerType: BadgeTriggerType.MILESTONE,
    triggerValue: 25,
  },
  {
    name: "Senior Scholar",
    description: "Reach level 50.",
    icon: "trophy",
    triggerType: BadgeTriggerType.MILESTONE,
    triggerValue: 50,
  },

  // ── Milestones (Perfect Quiz Scores) ─────────────────────────────────────
  {
    name: "Flawless Victory",
    description: "Earn a perfect score of 100% on a study quiz.",
    icon: "star",
    triggerType: BadgeTriggerType.MILESTONE,
    triggerValue: 100,
  },
  {
    name: "Triple Crown Perfect",
    description: "Earn a perfect score of 100% on 3 different study quizzes.",
    icon: "stars",
    triggerType: BadgeTriggerType.MILESTONE,
    triggerValue: 3,
  },
];

async function main() {
  console.log("Seeding gamification badges...");
  for (const b of BADGES) {
    const badge = await prisma.badge.upsert({
      where: { name: b.name },
      update: {
        description: b.description,
        icon: b.icon,
        triggerType: b.triggerType,
        triggerValue: b.triggerValue,
      },
      create: b,
    });
    console.log(`Upserted Badge: "${badge.name}" [Trigger: ${badge.triggerType} (${badge.triggerValue})]`);
  }
  console.log("Gamification badges seeded successfully.");
}

main()
  .catch((e) => {
    console.error("Error seeding badges:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

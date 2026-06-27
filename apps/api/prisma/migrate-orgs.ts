import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting organization migration and backfill...");

  // 1. Get the FREE plan
  const freePlan = await prisma.plan.findFirst({
    where: { type: "FREE" }
  });
  if (!freePlan) {
    throw new Error("FREE plan not found in database. Please run the seed script first.");
  }

  // 2. Fetch all users and their existing memberships
  const users = await prisma.user.findMany({
    include: {
      organizationMemberships: true,
    },
  });

  console.log(`Found ${users.length} users to process.`);

  for (const user of users) {
    let orgId: string;

    // Check if user already has an organization membership
    if (user.organizationMemberships.length > 0) {
      orgId = user.organizationMemberships[0].orgId;
      console.log(`User ${user.email} already has organization membership. Org ID: ${orgId}`);
    } else {
      // Create new personal organization
      const orgName = `${user.name || user.email.split("@")[0]}'s Personal Org`;
      const orgSlug = `${user.email.split("@")[0]}-org-${Math.floor(Math.random() * 100000)}`;

      console.log(`Creating personal organization "${orgName}" for user ${user.email}...`);

      const org = await prisma.organization.create({
        data: {
          name: orgName,
          slug: orgSlug,
          planId: freePlan.id,
          billingEmail: user.email,
        },
      });

      orgId = org.id;

      // Add user to the organization as OWNER
      await prisma.orgMember.create({
        data: {
          orgId,
          userId: user.id,
          role: "OWNER",
        },
      });
    }

    // 3. Backfill orgId on user's resources
    console.log(`Backfilling resources for user ${user.email} under Org ID: ${orgId}...`);

    // Backfill Documents
    const docsRes = await prisma.document.updateMany({
      where: { userId: user.id, orgId: null },
      data: { orgId },
    });
    if (docsRes.count > 0) {
      console.log(`- Updated ${docsRes.count} documents.`);
    }

    // Backfill Conversations (Chats)
    const chatsRes = await prisma.conversation.updateMany({
      where: { userId: user.id, orgId: null },
      data: { orgId },
    });
    if (chatsRes.count > 0) {
      console.log(`- Updated ${chatsRes.count} conversations.`);
    }

    // Backfill Quizzes
    const quizzesRes = await prisma.quiz.updateMany({
      where: { userId: user.id, orgId: null },
      data: { orgId },
    });
    if (quizzesRes.count > 0) {
      console.log(`- Updated ${quizzesRes.count} quizzes.`);
    }

    // Backfill UsageRecords
    const usageRes = await prisma.usageRecord.updateMany({
      where: { userId: user.id, orgId: null },
      data: { orgId },
    });
    if (usageRes.count > 0) {
      console.log(`- Updated ${usageRes.count} usage records.`);
    }

    // 4. Ensure a KnowledgeGraph exists for this organization
    const graph = await prisma.knowledgeGraph.findUnique({
      where: { orgId },
    });
    if (!graph) {
      console.log(`- Creating KnowledgeGraph record for Org ID: ${orgId}.`);
      await prisma.knowledgeGraph.create({
        data: { orgId },
      });
    }
  }

  console.log("Organization migration and backfill completed successfully! 🎉");
}

main()
  .catch((e) => {
    console.error("Error during migration:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

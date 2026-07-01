import { PrismaClient, SystemRole } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("Running primary database seed script...");

  // 1. Ensure first user has systemRole = SUPER_ADMIN
  const firstUser = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (firstUser) {
    console.log(`Setting first user (${firstUser.email}) systemRole = SUPER_ADMIN`);
    await prisma.user.update({
      where: { id: firstUser.id },
      data: { systemRole: SystemRole.SUPER_ADMIN },
    });
  } else {
    // If no user exists, create a default super admin
    const hashedPassword = await bcrypt.hash("admin123", 10);
    console.log("No users found. Creating default super admin: admin@study-assistant.com / admin123");
    await prisma.user.create({
      data: {
        email: "admin@study-assistant.com",
        password: hashedPassword,
        name: "Default Super Admin",
        systemRole: SystemRole.SUPER_ADMIN,
        role: "ADMIN" as any, // UserRole enum ADMIN
      },
    });
  }

  console.log("Primary database seeding completed successfully.");
}

main()
  .catch((e) => {
    console.error("Database seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

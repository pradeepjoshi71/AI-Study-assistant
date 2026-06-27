import { PrismaClient, PlanType } from "@prisma/client";
import Stripe from "stripe";

const prisma = new PrismaClient();

// Get Stripe Secret Key from environment, fallback to a placeholder
const stripeKey = process.env.STRIPE_SECRET_KEY || "sk_test_placeholder";
const stripe = new Stripe(stripeKey, {
  apiVersion: "2023-10-16" as any,
});

async function main() {
  console.log("Starting Stripe seeding script...");
  console.log(`Using Stripe key prefix: ${stripeKey.slice(0, 7)}...`);

  // Define plans to seed
  const plansToSeed = [
    {
      name: "Free",
      type: PlanType.FREE,
      priceMonthlyCents: 0,
      description: "Basic features for students",
      limits: {
        maxUsers: 1,
        maxDocuments: 5,
        maxStorageGb: 1,
        maxChatsPerDay: 10,
        maxApiCallsPerDay: 0,
        maxTokensPerMonth: 50000,
      },
    },
    {
      name: "Pro",
      type: PlanType.PRO,
      priceMonthlyCents: 1500, // $15.00
      description: "Advanced features for power users",
      limits: {
        maxUsers: 1,
        maxDocuments: 50,
        maxStorageGb: 10,
        maxChatsPerDay: 100,
        maxApiCallsPerDay: 100,
        maxTokensPerMonth: 500000,
      },
    },
    {
      name: "Premium",
      type: PlanType.TEAM, // Maps to existing PlanType.TEAM
      priceMonthlyCents: 4900, // $49.00
      description: "Unlimited features for teams and groups",
      limits: {
        maxUsers: 10,
        maxDocuments: 500,
        maxStorageGb: 100,
        maxChatsPerDay: 1000,
        maxApiCallsPerDay: 1000,
        maxTokensPerMonth: 5000000,
      },
    },
  ];

  for (const planDef of plansToSeed) {
    let stripePriceId = `mock_price_${planDef.name.toLowerCase()}`;

    // Attempt real Stripe creation if credentials are valid
    if (stripeKey && stripeKey !== "sk_test_placeholder") {
      try {
        console.log(`Creating Stripe Product & Price for ${planDef.name} Plan...`);
        // 1. Create Product
        const product = await stripe.products.create({
          name: `Study Assistant - ${planDef.name} Plan`,
          description: planDef.description,
        });

        // 2. Create Price (Monthly Recurring)
        const price = await stripe.prices.create({
          product: product.id,
          unit_amount: planDef.priceMonthlyCents,
          currency: "usd",
          recurring: { interval: "month" },
        });

        stripePriceId = price.id;
        console.log(`Stripe Product & Price created successfully for ${planDef.name} (${stripePriceId})`);
      } catch (err: any) {
        console.error(
          `Failed to register Stripe product/price for ${planDef.name} plan: ${err.message}. Falling back to mock ID.`
        );
      }
    } else {
      console.log(`Stripe credentials missing. Using mock stripePriceId for ${planDef.name} plan.`);
    }

    // 3. Save stripePriceId to the Plan table
    console.log(`Upserting Plan record in PostgreSQL for ${planDef.name}...`);
    const upsertedPlan = await prisma.plan.upsert({
      where: { type: planDef.type },
      update: {
        name: planDef.name,
        stripePriceId,
        limits: planDef.limits,
        priceMonthlyUsdCents: planDef.priceMonthlyCents,
        isActive: true,
      },
      create: {
        name: planDef.name,
        type: planDef.type,
        stripePriceId,
        limits: planDef.limits,
        priceMonthlyUsdCents: planDef.priceMonthlyCents,
        isActive: true,
      },
    });

    console.log(`Plan ${upsertedPlan.name} upserted successfully in Postgres with stripePriceId: ${upsertedPlan.stripePriceId}`);
  }

  console.log("Stripe Products & Prices Seeding completed!");
}

main()
  .catch((e) => {
    console.error("Seeding script failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

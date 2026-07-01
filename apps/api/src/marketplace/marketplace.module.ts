import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
import { PluginRuntimeModule } from "../plugin-runtime/plugin-runtime.module";
import { AuditModule } from "../audit/audit.module";
import { BillingModule } from "../billing/billing.module";
import { CommonModule } from "../common/common.module";
import { MarketplaceService } from "./marketplace.service";
import { MarketplaceController } from "./marketplace.controller";
import { ListingsController } from "./listings.controller";
import { MarketplaceAdminController } from "./marketplace-admin.controller";
import { ListingModerationProcessor } from "./processors/listing-moderation.processor";
import { MarketplacePurchaseService } from "./marketplace-purchase.service";

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    PluginRuntimeModule,
    AuditModule,
    BillingModule,
    CommonModule,
    BullModule.registerQueue({ name: "listing-moderation" }),
  ],
  providers: [
    MarketplaceService,
    MarketplacePurchaseService,
    ListingModerationProcessor,
  ],
  controllers: [
    MarketplaceController,
    ListingsController,
    MarketplaceAdminController,
  ],
  exports: [MarketplaceService, MarketplacePurchaseService],
})
export class MarketplaceModule {}

import { Module } from "@nestjs/common";
import { ResellerService } from "./reseller.service";
import { ResellerController } from "./reseller.controller";
import { PublicTenantController } from "./public-tenant.controller";
import { PrismaModule } from "../prisma/prisma.module";
import { BillingModule } from "../billing/billing.module";
import { StorageModule } from "../storage/storage.module";
import { CommonModule } from "../common/common.module";
import { BullModule } from "@nestjs/bullmq";

@Module({
  imports: [
    PrismaModule,
    BillingModule,
    StorageModule,
    CommonModule,
    BullModule.registerQueue({
      name: "email",
    }),
  ],
  providers: [ResellerService],
  controllers: [ResellerController, PublicTenantController],
  exports: [ResellerService],
})
export class ResellerModule {}

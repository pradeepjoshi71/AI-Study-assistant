import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { OrganizationService } from "./organization.service";
import { OrgMemberService } from "./org-member.service";
import { OrganizationController } from "./organization.controller";
import { RolesGuard } from "./guards/roles.guard";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    ConfigModule,
    JwtModule.register({}), // secrets resolved at runtime via ConfigService
    BullModule.registerQueue({ name: "org-notifications" }),
  ],
  controllers: [OrganizationController],
  providers: [OrganizationService, OrgMemberService, RolesGuard],
  exports: [OrganizationService, OrgMemberService, RolesGuard],
})
export class OrganizationModule {}

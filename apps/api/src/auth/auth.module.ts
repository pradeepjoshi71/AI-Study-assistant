import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { StorageModule } from "../storage/storage.module";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { UsersModule } from "../users/users.module";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { JwtAuthGuard } from "./guards/jwt.guard";
import { RolesGuard } from "./guards/roles.guard";
import { MobileAuthController } from "./mobile-auth.controller";
import { MobileController } from "./mobile.controller";
import { MobileAuthService } from "./mobile-auth.service";
import { MobileJwtAuthGuard } from "./guards/mobile-jwt.guard";
import { RedisModule } from "../redis/redis.module";
import { MobileGateway } from "./mobile.gateway";
import { VoiceController } from "./voice.controller";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.register({}),
    ConfigModule,
    UsersModule,
    RedisModule,
    StorageModule,
    BullModule.registerQueue(
      { name: "voice-processing" },
      { name: "document-processing" },
    ),
  ],
  controllers: [AuthController, MobileAuthController, MobileController, VoiceController],
  providers: [AuthService, MobileAuthService, JwtStrategy, JwtAuthGuard, MobileJwtAuthGuard, RolesGuard, MobileGateway],
  exports: [AuthService, MobileAuthService, JwtAuthGuard, MobileJwtAuthGuard, RolesGuard, PassportModule, JwtModule, MobileGateway],
})
export class AuthModule {}

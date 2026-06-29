import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule } from "@nestjs/config";
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

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.register({}),
    ConfigModule,
    UsersModule,
    RedisModule,
  ],
  controllers: [AuthController, MobileAuthController, MobileController],
  providers: [AuthService, MobileAuthService, JwtStrategy, JwtAuthGuard, MobileJwtAuthGuard, RolesGuard, MobileGateway],
  exports: [AuthService, MobileAuthService, JwtAuthGuard, MobileJwtAuthGuard, RolesGuard, PassportModule, JwtModule],
})
export class AuthModule {}

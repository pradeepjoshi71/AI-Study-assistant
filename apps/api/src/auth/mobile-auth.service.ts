import {
  Injectable,
  UnauthorizedException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../../prisma/prisma.service";
import { UsersService } from "../../users/users.service";
import { RedisService } from "../../redis/redis.service";
import { MobileLoginDto, MobileRefreshDto } from "./dtos/mobile-auth.dto";

@Injectable()
export class MobileAuthService {
  private readonly logger = new Logger(MobileAuthService.name);
  private readonly accessSecret: string;
  private readonly refreshSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.accessSecret = this.configService.get<string>(
      "JWT_ACCESS_SECRET",
      "access_secret_12345",
    );
    this.refreshSecret = this.configService.get<string>(
      "JWT_REFRESH_SECRET",
      "refresh_secret_12345",
    );
  }

  /**
   * Performs mobile login. Returns accessToken (15m) and refreshToken (30d).
   * Stores the hashed refreshToken in the DeviceToken record mapped by deviceId.
   */
  async login(dto: MobileLoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    if (!user.isActive) {
      throw new UnauthorizedException("User account is deactivated");
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    return this.generateMobileTokens(user.id, user.email, dto.deviceId, dto.platform, dto.fcmToken);
  }

  /**
   * Refreshes JWT tokens for mobile devices. Rotates the refresh token (updates hashed value).
   */
  async refresh(dto: MobileRefreshDto) {
    const deviceToken = await this.prisma.deviceToken.findUnique({
      where: { deviceId: dto.deviceId },
      include: { user: true },
    });

    if (!deviceToken || !deviceToken.refreshTokenHash || !deviceToken.expiresAt) {
      throw new UnauthorizedException("Invalid device session");
    }

    if (deviceToken.expiresAt < new Date()) {
      throw new UnauthorizedException("Refresh token has expired");
    }

    // Validate token hash
    const isValid = await bcrypt.compare(dto.refreshToken, deviceToken.refreshTokenHash);
    if (!isValid) {
      throw new UnauthorizedException("Invalid refresh token credentials");
    }

    return this.generateMobileTokens(
      deviceToken.userId,
      deviceToken.user.email,
      deviceToken.deviceId,
      deviceToken.platform,
      deviceToken.fcmToken || undefined,
    );
  }

  /**
   * Revokes access tokens by blacklisting in Redis, and removes the DB DeviceToken record.
   */
  async logout(userId: string, deviceId: string, accessToken?: string) {
    // 1. Blacklist accessToken in Redis if provided
    if (accessToken) {
      try {
        const decoded = this.jwtService.decode(accessToken) as any;
        if (decoded && decoded.exp) {
          const remainingSeconds = Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
          if (remainingSeconds > 0) {
            await this.redisService
              .getClient()
              .set(`blacklist:${accessToken}`, "revoked", "EX", remainingSeconds);
            this.logger.log(`Access token blacklisted in Redis for ${remainingSeconds}s.`);
          }
        }
      } catch (err: any) {
        this.logger.error(`Error decoding or blacklisting access token: ${err.message}`);
      }
    }

    // 2. Delete DB DeviceToken record
    try {
      await this.prisma.deviceToken.deleteMany({
        where: {
          userId,
          deviceId,
        },
      });
      this.logger.log(`Device session ${deviceId} logged out and deleted from database.`);
      return { success: true };
    } catch (err: any) {
      this.logger.error(`Failed to delete device token record: ${err.message}`);
      return { success: false };
    }
  }

  /**
   * Helper generating token sets and committing updates to DB.
   */
  private async generateMobileTokens(
    userId: string,
    email: string,
    deviceId: string,
    platform: any,
    fcmToken?: string,
  ) {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 Days

    // Resolve user subscription level
    const userRecord = await this.usersService.findById(userId);
    const rawPlan = userRecord?.subscriptionPlan || "FREE";
    const planStr = rawPlan.toLowerCase();
    const tier =
      planStr === "pro"
        ? "pro"
        : planStr === "team" || planStr === "enterprise" || planStr === "premium"
        ? "premium"
        : "free";

    // Resolve orgId
    const membership = await this.prisma.orgMember.findFirst({
      where: { userId },
      orderBy: { joinedAt: "asc" },
    });
    const orgId = membership?.orgId || undefined;

    // Sign tokens
    const accessToken = this.jwtService.sign(
      { sub: userId, email, tier, orgId, deviceId },
      { secret: this.accessSecret, expiresIn: "15m" },
    );

    const refreshToken = this.jwtService.sign(
      { sub: userId, email, deviceId },
      { secret: this.refreshSecret, expiresIn: "30d" },
    );

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    // Upsert DeviceToken record in database
    await this.prisma.deviceToken.upsert({
      where: { deviceId },
      update: {
        userId,
        platform,
        fcmToken: fcmToken || null,
        refreshTokenHash,
        expiresAt,
      },
      create: {
        userId,
        deviceId,
        platform,
        fcmToken: fcmToken || null,
        refreshTokenHash,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes
    };
  }
}

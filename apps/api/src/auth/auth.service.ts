import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import { UsersService } from "../users/users.service";
import { PrismaService } from "../prisma/prisma.service";
import { RegisterDto } from "./dtos/register.dto";
import { LoginDto } from "./dtos/login.dto";
import * as bcrypt from "bcrypt";

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
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

  async register(dto: RegisterDto) {
    const existingUser = await this.usersService.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException("A user with this email already exists");
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.usersService.create({
      email: dto.email,
      password: passwordHash,
      name: dto.name,
      role: dto.role,
    });

    const result = { ...user };
    delete (result as any).password;
    return result;
  }

  async login(dto: LoginDto) {
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

    return this.generateTokensForUser(user.id, user.email);
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.refreshSecret,
      });

      const sessionId = payload.sessionId;
      const userId = payload.sub;

      if (!sessionId || !userId) {
        throw new UnauthorizedException("Invalid token payload");
      }

      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
      });

      if (
        !session ||
        session.expiresAt < new Date() ||
        session.userId !== userId
      ) {
        if (session) {
          await this.prisma.session
            .delete({ where: { id: sessionId } })
            .catch(() => {});
        }
        throw new UnauthorizedException("Session expired or invalid");
      }

      const isHashValid = await bcrypt.compare(
        refreshToken,
        session.refreshTokenHash,
      );
      if (!isHashValid) {
        throw new UnauthorizedException("Invalid token hash");
      }

      // Generate new tokens (rotate refresh token)
      const tokens = await this.generateTokensForUser(
        userId,
        payload.email,
        sessionId,
      );
      return tokens;
    } catch (err) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }
  }

  async logout(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.refreshSecret,
      });

      const sessionId = payload.sessionId;
      if (sessionId) {
        await this.prisma.session.delete({
          where: { id: sessionId },
        });
      }
      return { success: true, message: "Logged out successfully" };
    } catch {
      // Return success even if verify fails to avoid leaking details on invalid requests
      return { success: true, message: "Logged out successfully" };
    }
  }

  public async generateTokensForUser(
    userId: string,
    email: string,
    existingSessionId?: string,
    targetOrgId?: string,
  ) {
    // 1. Create or retrieve session ID
    let sessionId = existingSessionId;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 Days

    if (!sessionId) {
      // Create session skeleton first to get UUID
      const session = await this.prisma.session.create({
        data: {
          userId,
          refreshTokenHash: `temp_${Date.now()}`, // Temporary placeholder
          expiresAt,
        },
      });
      sessionId = session.id;
    }

    const userRecord = await this.usersService.findById(userId);
    const rawPlan = userRecord?.subscriptionPlan || 'FREE';
    const planStr = rawPlan.toLowerCase();
    const tier = planStr === 'pro' ? 'pro' : (planStr === 'team' || planStr === 'enterprise' || planStr === 'premium' ? 'premium' : 'free');

    // Resolve orgId (either requested targetOrgId or the user's default/first organization)
    let orgId = targetOrgId;
    if (!orgId) {
      const membership = await this.prisma.orgMember.findFirst({
        where: { userId },
        orderBy: { joinedAt: "asc" },
      });
      orgId = membership?.orgId || undefined;
    }

    // 2. Sign access & refresh tokens
    const accessToken = this.jwtService.sign(
      { sub: userId, email, tier, orgId },
      { secret: this.accessSecret, expiresIn: "15m" },
    );

    const refreshToken = this.jwtService.sign(
      { sub: userId, email, sessionId },
      { secret: this.refreshSecret, expiresIn: "7d" },
    );

    // 3. Hash refresh token and update database session
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        refreshTokenHash,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  async handleGoogleCallback(code: string) {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID', '');
    const clientSecret = this.configService.get<string>('GOOGLE_CLIENT_SECRET', '');
    const callbackUrl = this.configService.get<string>('GOOGLE_CALLBACK_URL', 'http://localhost:3000/auth/oauth/google/callback');

    if (!clientId || !clientSecret) {
      throw new UnauthorizedException('Google OAuth credentials not configured on the server.');
    }

    let tokenData: any;
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: callbackUrl,
          grant_type: 'authorization_code',
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }
      tokenData = await response.json();
    } catch (e: any) {
      throw new UnauthorizedException(`Failed to exchange Google OAuth code: ${e.message}`);
    }

    const accessToken = tokenData.access_token;

    let profile: any;
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      profile = await response.json();
    } catch (e: any) {
      throw new UnauthorizedException(`Failed to fetch Google user profile: ${e.message}`);
    }

    const email = profile.email;
    const providerUserId = profile.sub;
    const name = profile.name || email.split('@')[0];
    const avatar = profile.picture;

    if (!email) {
      throw new BadRequestException('Google Profile does not contain an email address');
    }

    let user = await this.usersService.findByEmail(email);

    if (!user) {
      const randomPasswordHash = crypto.randomUUID();
      user = await this.usersService.create({
        email,
        password: randomPasswordHash,
        name,
        avatar,
        role: 'STUDENT',
      });

      const slug = `${email.split('@')[0]}-org-${Math.floor(Math.random() * 1000)}`;
      const freePlan = await this.prisma.plan.findUnique({
        where: { type: 'FREE' },
      });

      if (freePlan) {
        await this.prisma.$transaction(async (tx) => {
          const org = await tx.organization.create({
            data: {
              name: `${name}'s Workspace`,
              slug,
              billingEmail: email,
            },
          });
          await tx.subscription.create({
            data: {
              organizationId: org.id,
              planId: freePlan.id,
              status: 'ACTIVE',
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          });
          await tx.orgMember.create({
            data: {
              orgId: org.id,
              userId: user!.id,
              role: 'OWNER',
            },
          });
        });
      }
    }

    const existingLink = await this.prisma.identityProvider.findUnique({
      where: {
        provider_providerUserId: {
          provider: 'GOOGLE',
          providerUserId,
        },
      },
    });

    if (!existingLink) {
      await this.prisma.identityProvider.create({
        data: {
          userId: user.id,
          provider: 'GOOGLE',
          providerUserId,
        },
      });
    }

    return this.generateTokensForUser(user.id, user.email);
  }
}

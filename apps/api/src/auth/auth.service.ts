import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
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

  private async generateTokensForUser(
    userId: string,
    email: string,
    existingSessionId?: string,
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

    // 2. Sign access & refresh tokens
    const accessToken = this.jwtService.sign(
      { sub: userId, email },
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
}

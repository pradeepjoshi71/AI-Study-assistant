import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
  Query,
  BadRequestException,
  UseInterceptors,
  Req,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { ConfigService } from "@nestjs/config";
import { Response, Request } from "express";
import { RegisterDto } from "./dtos/register.dto";
import { LoginDto } from "./dtos/login.dto";
import { RefreshTokenDto } from "./dtos/refresh-token.dto";
import { JwtAuthGuard } from "./guards/jwt.guard";
import { CurrentUser } from "./decorators/current-user.decorator";
import { Audit } from "../audit/decorators/audit.decorator";
import { AuditInterceptor } from "../audit/interceptors/audit.interceptor";
import { Throttle } from "@nestjs/throttler";
import { User } from "@prisma/client";

import { Track } from "../common/decorators/track.decorator";

@Controller("auth")
@UseInterceptors(AuditInterceptor)
export class AuthController {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } }) // Limit to 5 registrations per minute
  @Post("register")
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    let visitorId: string | undefined;
    if (req.headers.cookie) {
      const cookieMap = req.headers.cookie
        .split(";")
        .reduce((acc, c) => {
          const [key, val] = c.trim().split("=");
          if (key) acc[key] = val;
          return acc;
        }, {} as Record<string, string>);
      visitorId = cookieMap["visitorId"];
    }
    return this.authService.register(dto, visitorId);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } }) // Limit to 5 login attempts per minute
  @Post("login")
  @Track("auth.login")
  @Audit("auth.login", "auth")
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post("refresh")
  @Audit("auth.refresh", "auth")
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post("logout")
  @Audit("auth.logout", "auth")
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  async getMe(@CurrentUser() user: User) {
    const result = { ...user };
    delete (result as any).password;
    return result;
  }

  @Get("oauth/google")
  async googleAuth(@Res() res: Response) {
    const clientId = this.configService.get<string>("GOOGLE_CLIENT_ID", "");
    const callbackUrl = this.configService.get<string>("GOOGLE_CALLBACK_URL", "http://localhost:3000/auth/oauth/google/callback");
    
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(
      callbackUrl,
    )}&response_type=code&scope=openid%20email%20profile&access_type=offline&prompt=consent`;

    res.redirect(googleAuthUrl);
  }

  @Get("oauth/google/callback")
  async googleAuthCallback(@Query("code") code: string, @Res() res: Response) {
    if (!code) {
      throw new BadRequestException("Authorization code is missing");
    }

    const tokens = await this.authService.handleGoogleCallback(code);
    const frontendUrl = this.configService.get<string>("FRONTEND_URL", "http://localhost:3000");

    res.redirect(
      `${frontendUrl}/auth/sso/callback?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}`,
    );
  }
}

import { Controller, Post, Body, Req, UseGuards, HttpCode, HttpStatus } from "@nestjs/common";
import { Request } from "express";
import { MobileAuthService } from "./mobile-auth.service";
import { MobileLoginDto, MobileRefreshDto } from "./dtos/mobile-auth.dto";
import { MobileJwtAuthGuard } from "./guards/mobile-jwt.guard";
import { CurrentUser } from "./decorators/current-user.decorator";

@Controller("mobile/auth")
export class MobileAuthController {
  constructor(private readonly mobileAuthService: MobileAuthService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: MobileLoginDto) {
    return this.mobileAuthService.login(dto);
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: MobileRefreshDto) {
    return this.mobileAuthService.refresh(dto);
  }

  @Post("logout")
  @UseGuards(MobileJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser("id") userId: string,
    @Body("deviceId") deviceId: string,
    @Req() req: Request,
  ) {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.split(" ")[1] : undefined;
    return this.mobileAuthService.logout(userId, deviceId, token);
  }
}

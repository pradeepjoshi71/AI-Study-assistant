import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import * as crypto from "crypto";
import { ReferralService } from "./referral.service";
import { RedisService } from "../redis/redis.service";

@Controller("r")
export class ReferralController {
  constructor(
    private readonly referralService: ReferralService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  @Get(":code")
  async trackReferralClick(
    @Param("code") code: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Validate if the referral code exists
    const referralCode = await this.referralService.validateCode(code);
    if (!referralCode) {
      // If code is not valid, still redirect to signup (or we could show an error, but redirecting is usually preferred)
      const frontendUrl = this.configService.get<string>("FRONTEND_URL", "http://localhost:3000");
      return res.redirect(`${frontendUrl}/signup`);
    }

    // Extract or generate visitorId
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

    if (!visitorId) {
      visitorId = crypto.randomUUID();
    }

    // Set visitorId cookie (30 days TTL)
    res.cookie("visitorId", visitorId, {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
    });

    // Store in Redis (ref:click:{visitorId} = code) with 30-day TTL (2592000 seconds)
    const redis = this.redisService.getClient();
    await redis.set(`ref:click:${visitorId}`, code, "EX", 30 * 24 * 60 * 60);

    // Redirect to signup page
    const frontendUrl = this.configService.get<string>("FRONTEND_URL", "http://localhost:3000");
    return res.redirect(`${frontendUrl}/signup`);
  }
}

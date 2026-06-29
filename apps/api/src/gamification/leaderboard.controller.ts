import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { LeaderboardService } from "./leaderboard.service";

@UseGuards(JwtAuthGuard)
@Controller("leaderboard")
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get(":orgId")
  async getLeaderboard(
    @Param("orgId") orgId: string,
    @Query("period") period: "weekly" | "alltime" = "weekly",
    @Query("limit") limit = "20",
    @CurrentUser("id") userId: string,
  ) {
    const parsedLimit = parseInt(limit, 10) || 20;
    return this.leaderboardService.getLeaderboard(orgId, period, userId, parsedLimit);
  }
}

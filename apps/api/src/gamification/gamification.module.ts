import { Module, Global } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { XPService } from "./xp.service";
import { StreakService } from "./streak.service";
import { LeaderboardService } from "./leaderboard.service";
import { LeaderboardController } from "./leaderboard.controller";
import { ProgressController } from "./progress.controller";
import { GamificationEventsListener } from "./gamification-events.listener";
import { PrismaModule } from "../prisma/prisma.module";
import { RedisModule } from "../redis/redis.module";

@Global()
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    BullModule.registerQueue(
      { name: "badge-check" },
      { name: "push-notifications" }
    ),
  ],
  controllers: [LeaderboardController, ProgressController],
  providers: [XPService, StreakService, LeaderboardService, GamificationEventsListener],
  exports: [XPService, StreakService, LeaderboardService],
})
export class GamificationModule {}

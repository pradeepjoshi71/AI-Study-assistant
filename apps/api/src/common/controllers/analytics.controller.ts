import {
  Controller,
  Post,
  Body,
  Req,
  BadRequestException,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../auth/guards/jwt.guard";
import { AnalyticsService } from "../services/analytics.service";

interface BulkEvent {
  event: string;
  properties?: Record<string, any>;
  orgId?: string | null;
  sessionId?: string | null;
}

@Controller("analytics")
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post("track")
  @HttpCode(HttpStatus.OK)
  async trackBulkEvents(@Req() req: any, @Body() events: BulkEvent[]) {
    if (!Array.isArray(events)) {
      throw new BadRequestException("Payload must be a JSON array of events");
    }

    if (events.length > 20) {
      throw new BadRequestException("Bulk batch limit exceeded. Maximum 20 events per call.");
    }

    const tenantId = req.tenantId || "default";
    const userId = req.user?.id || null;

    for (const item of events) {
      if (!item.event || typeof item.event !== "string") {
        throw new BadRequestException("Each event must contain a valid string 'event' name");
      }

      this.analyticsService.track({
        tenantId,
        orgId: item.orgId || req.user?.orgId || null,
        userId,
        event: item.event,
        properties: item.properties || {},
        sessionId: item.sessionId || null,
      });
    }

    return { success: true, count: events.length };
  }
}

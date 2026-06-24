import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);
  private readonly aiServiceUrl: string;

  constructor(
    private analyticsService: AnalyticsService,
    private configService: ConfigService,
  ) {
    this.aiServiceUrl = this.configService.get<string>(
      'NEXT_PUBLIC_AI_SERVICE_URL',
      'http://localhost:8000',
    );
  }

  /**
   * Generates AI study recommendations by sending user analytics dashboard data to the FastAPI AI service.
   */
  async getStudyRecommendations(userId: string, tenantId: string) {
    // 1. Fetch dashboard summaries and masteries
    const summary = await this.analyticsService.getDashboardSummary(userId, tenantId);
    
    // 2. Query FastAPI study recommendations
    const url = `${this.aiServiceUrl}/ai/analytics/insights`;
    this.logger.log(`Calling FastAPI insights engine at: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          summary,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI service insights request failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (err: any) {
      this.logger.error(`Failed to retrieve AI insights: ${err.message}`);
      
      // Fallback local rules if FastAPI is down or key is missing
      const weakTopics = summary.topicMastery.filter(m => m.score < 50);
      const recommendations = [];
      
      if (weakTopics.length > 0) {
        recommendations.push(
          `Revise topic "${weakTopics[0].topic}" immediately. Current mastery is only ${weakTopics[0].score}%.`,
        );
        recommendations.push(
          `Generate an easy practice quiz on "${weakTopics[0].topic}" to check facts and rebuild confidence.`,
        );
      } else {
        recommendations.push(
          'Great job! You have high mastery across all topics. Take a hard quiz to challenge your recall.',
        );
      }

      return {
        insights: [
          `Streak is at ${summary.streakDays} days! Keep it up.`,
          `Average Quiz Accuracy: ${summary.averageQuizScore}%.`,
        ],
        recommendations,
      };
    }
  }
}

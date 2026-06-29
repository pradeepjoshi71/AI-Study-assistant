import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { initializeApp, cert } from "firebase-admin/app";
import { getMessaging, Message } from "firebase-admin/messaging";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private isFirebaseInitialized = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    try {
      const serviceAccountJson = this.configService.get<string>("FIREBASE_SERVICE_ACCOUNT");
      if (serviceAccountJson) {
        const serviceAccount = JSON.parse(serviceAccountJson);
        initializeApp({
          credential: cert(serviceAccount),
        });
        this.isFirebaseInitialized = true;
        this.logger.log("Firebase Admin successfully initialized.");
      } else {
        this.logger.warn("FIREBASE_SERVICE_ACCOUNT not configured. Push Service running in mock/log mode.");
      }
    } catch (err: any) {
      this.logger.error(`Failed to initialize Firebase Admin: ${err.message}`);
    }
  }

  /**
   * Evaluates notification preferences, queries device tokens, and dispatches FCM payloads.
   */
  async sendPushNotification(
    userId: string,
    type: string,
    payload: { title: string; body: string; data?: Record<string, string> }
  ) {
    // 1. Check user notification preferences
    const pref = await this.prisma.notificationPreference.findUnique({
      where: {
        userId_type: { userId, type },
      },
    });

    // If preference is explicitly set to false, skip sending push
    if (pref && !pref.enabled) {
      this.logger.log(`Skipping notification for user ${userId} of type ${type} per user preferences.`);
      return;
    }

    // 2. Fetch active device tokens
    const tokens = await this.prisma.deviceToken.findMany({
      where: {
        userId,
        fcmToken: { not: null },
      },
    });

    if (tokens.length === 0) {
      this.logger.log(`No active FCM device tokens registered for user: ${userId}`);
      return;
    }

    this.logger.log(`Sending push of type ${type} to ${tokens.length} devices for user ${userId}...`);

    for (const token of tokens) {
      if (!token.fcmToken) continue;

      if (!this.isFirebaseInitialized) {
        // Mock logging output if firebase credential not configured
        this.logger.log(
          `[MOCK PUSH] to User: ${userId}, Platform: ${token.platform}, Token: ${token.fcmToken}. Title: "${payload.title}"`
        );
        continue;
      }

      try {
        const fcmPayload: Message = {
          token: token.fcmToken,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: payload.data || {},
          apns: token.platform === "IOS" ? {
            headers: {
              "apns-priority": "10",
              "apns-topic": "com.studyassistant.app", // iOS APNs topic configuration
            },
            payload: {
              aps: {
                alert: {
                  title: payload.title,
                  body: payload.body,
                },
                sound: "default",
              },
            },
          } : undefined,
        };

        await getMessaging().send(fcmPayload);
        this.logger.log(`Push notification sent successfully to token: ${token.fcmToken}`);
      } catch (err: any) {
        this.logger.error(`Error sending push notification to device ${token.deviceId}: ${err.message}`);
        
        // Handle FCM 404 / 410 / Invalid Registration Errors: Delete stale DeviceToken
        if (
          err.code === "messaging/invalid-argument" ||
          err.code === "messaging/registration-token-not-registered" ||
          err.message.includes("404") ||
          err.message.includes("not-registered")
        ) {
          this.logger.warn(`FCM token invalid or unregistered. Deleting stale DeviceToken ${token.id}...`);
          await this.prisma.deviceToken.delete({
            where: { id: token.id },
          }).catch(() => {});
        }
      }
    }
  }
}

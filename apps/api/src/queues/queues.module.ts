import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { DocumentProcessingProcessor } from "./document-processing.processor";

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>("REDIS_HOST", "localhost"),
          port: Number(configService.get<number>("REDIS_PORT", 6379)),
          password:
            configService.get<string>("REDIS_PASSWORD", "") || undefined,
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: "document-processing",
    }),
  ],
  providers: [DocumentProcessingProcessor],
  exports: [BullModule, DocumentProcessingProcessor],
})
export class QueuesModule {}

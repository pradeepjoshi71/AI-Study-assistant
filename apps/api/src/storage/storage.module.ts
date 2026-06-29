import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { StorageService } from "./storage.service";
import { S3Service } from "./s3.service"; // kept for backwards-compat with existing callers

@Module({
  imports: [ConfigModule],
  providers: [StorageService, S3Service],
  exports: [StorageService, S3Service],
})
export class StorageModule {}

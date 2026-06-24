import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

@Injectable()
export class S3Service {
  private readonly s3Client: S3Client | null = null;
  private readonly bucketName: string;
  private readonly region: string;
  private readonly logger = new Logger(S3Service.name);

  constructor(private configService: ConfigService) {
    const accessKeyId = this.configService.get<string>("AWS_ACCESS_KEY_ID");
    const secretAccessKey = this.configService.get<string>(
      "AWS_SECRET_ACCESS_KEY",
    );
    this.region = this.configService.get<string>("AWS_REGION", "us-east-1");
    this.bucketName = this.configService.get<string>(
      "AWS_S3_BUCKET",
      "study-assistant-bucket",
    );

    if (accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region: this.region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      this.logger.log("S3 Service initialized with AWS Credentials.");
    } else {
      this.logger.warn(
        "AWS Credentials not found. S3 Service running in Mock Dry-Run Mode.",
      );
    }
  }

  async uploadFile(
    file: Express.Multer.File,
    userId: string,
  ): Promise<{ url: string; key: string }> {
    const uniqueId =
      Math.random().toString(36).substring(2, 15) + "-" + Date.now();
    const key = `uploads/${userId}/${uniqueId}-${file.originalname}`;

    if (!this.s3Client) {
      const mockUrl = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;
      this.logger.log(
        `[Mock S3 Upload] File: ${file.originalname} mapped to Key: ${key}`,
      );
      return { url: mockUrl, key };
    }

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );

      const url = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;
      return { url, key };
    } catch (err: any) {
      this.logger.error(`S3 Upload Failed: ${err.message}`);
      throw err;
    }
  }

  async deleteFile(key: string): Promise<void> {
    if (!this.s3Client) {
      this.logger.log(`[Mock S3 Delete] File removed: Key: ${key}`);
      return;
    }

    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );
    } catch (err: any) {
      this.logger.error(`S3 Deletion Failed: ${err.message}`);
      throw err;
    }
  }
}

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketVersioningCommand,
  PutBucketLifecycleConfigurationCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";

export interface UploadResult {
  /** Full public URL (or Minio path URL) */
  url: string;
  /** Canonical storage key: orgs/{orgId}/docs/{docId}/{filename} */
  key: string;
  /** Resolved bucket */
  bucket: string;
}

/**
 * StorageService
 *
 * Wraps the AWS SDK S3Client pointed at a MinIO endpoint.
 * All config is read from environment variables at construction time.
 *
 * File path pattern: orgs/{orgId}/docs/{docId}/{filename}
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly publicEndpoint: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: ConfigService) {
    const accessKeyId = config.get<string>("MINIO_ACCESS_KEY", "minioadmin");
    const secretAccessKey = config.get<string>("MINIO_SECRET_KEY", "minioadmin");
    const region = config.get<string>("MINIO_REGION", "us-east-1");
    const useSsl = config.get<string>("MINIO_USE_SSL", "false") === "true";

    // Internal Minio endpoint (docker network URL)
    this.endpoint = config.get<string>("MINIO_ENDPOINT", "http://localhost:9000");

    // Public-facing URL for pre-signed URLs (may differ in production behind a proxy)
    this.publicEndpoint = config.get<string>(
      "MINIO_PUBLIC_ENDPOINT",
      this.endpoint,
    );

    this.bucket = config.get<string>("MINIO_BUCKET", "study-assistant");

    this.client = new S3Client({
      region,
      endpoint: this.endpoint,
      credentials: { accessKeyId, secretAccessKey },
      // Required for Minio path-style access (bucket in URL path, not subdomain)
      forcePathStyle: true,
      tls: useSsl,
    });

    this.logger.log(
      `StorageService initialised → endpoint=${this.endpoint} bucket=${this.bucket}`,
    );
  }

  // ── Key helper ────────────────────────────────────────────────────────────

  /**
   * Builds the canonical storage key.
   *
   * Pattern: orgs/{orgId}/docs/{docId}/{sanitised-filename}
   */
  buildKey(orgId: string, docId: string, filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `orgs/${orgId}/docs/${docId}/${safe}`;
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  /**
   * Upload a Multer file buffer to Minio.
   *
   * @param file       Multer file (in-memory buffer)
   * @param orgId      Organisation ID (used in path)
   * @param docId      Document ID (used in path)
   * @returns          { url, key, bucket }
   */
  async upload(
    file: Express.Multer.File,
    orgId: string,
    docId: string,
  ): Promise<UploadResult> {
    const key = this.buildKey(orgId, docId, file.originalname);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ContentLength: file.size,
        Metadata: {
          orgId,
          docId,
          originalName: file.originalname,
        },
      }),
    );

    const url = `${this.publicEndpoint}/${this.bucket}/${key}`;
    this.logger.debug(`Uploaded: ${key} (${file.size} bytes)`);
    return { url, key, bucket: this.bucket };
  }

  /**
   * Upload a raw buffer to Minio.
   */
  async uploadBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<{ url: string; key: string; bucket: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ContentLength: buffer.length,
      }),
    );
    const url = `${this.publicEndpoint}/${this.bucket}/${key}`;
    this.logger.debug(`Uploaded Buffer: ${key} (${buffer.length} bytes)`);
    return { url, key, bucket: this.bucket };
  }

  // ── Signed URL ────────────────────────────────────────────────────────────

  /**
   * Generate a pre-signed GET URL for private object access.
   *
   * @param key          Storage key
   * @param expiresIn    TTL in seconds (default 1 hour)
   */
  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    // Build a presigner that uses the PUBLIC endpoint so the signed URL is
    // accessible from outside the Docker network.
    const publicClient = new S3Client({
      region: this.client.config.region as string,
      endpoint: this.publicEndpoint,
      credentials: await this.client.config.credentials(),
      forcePathStyle: true,
    });

    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(publicClient as any, command as any, { expiresIn });
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  /**
   * Permanently delete an object by its storage key.
   */
  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    this.logger.debug(`Deleted: ${key}`);
  }

  // ── Head (existence check) ────────────────────────────────────────────────

  /**
   * Returns object metadata without downloading the body.
   * Useful for verifying a file exists before generating a signed URL.
   */
  async head(key: string): Promise<{ contentLength: number; contentType: string } | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        contentLength: res.ContentLength ?? 0,
        contentType: res.ContentType ?? "application/octet-stream",
      };
    } catch (err: any) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  // ── Stream download ───────────────────────────────────────────────────────

  /**
   * Returns the raw S3 body stream for a key.
   * Use when you need to pipe the file directly to an HTTP response.
   */
  async stream(key: string): Promise<Readable> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`Empty body for key: ${key}`);
    return res.Body as Readable;
  }

  get bucketName(): string {
    return this.bucket;
  }

  async configureCompliance(): Promise<void> {
    try {
      await this.client.send(new PutBucketVersioningCommand({
        Bucket: this.bucket,
        VersioningConfiguration: { Status: 'Enabled' },
      }));
      this.logger.log(`Minio bucket versioning enabled successfully.`);

      await this.client.send(new PutBucketLifecycleConfigurationCommand({
        Bucket: this.bucket,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: 'block-delete-compliance',
              Status: 'Enabled',
              Filter: { Prefix: 'audits/' },
              NoncurrentVersionExpiration: { NoncurrentDays: 36500 },
            }
          ]
        }
      }));
      this.logger.log(`Minio compliance lifecycle rules applied successfully.`);
    } catch (err: any) {
      this.logger.error(`Failed to configure Minio compliance rules: ${err.message}`);
    }
  }
}

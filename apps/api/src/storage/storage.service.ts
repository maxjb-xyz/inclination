import { Injectable } from "@nestjs/common";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { envBool, envOrDefault } from "@inclination/shared";
import type { HealthProbe } from "../health/checks";

@Injectable()
export class StorageService implements HealthProbe {
  readonly name = "minio";
  private readonly client: S3Client;
  private readonly bucket: string;
  /** Memoized bucket-existence promise so we ensure the bucket at most once. */
  private bucketReady?: Promise<void>;

  constructor() {
    this.bucket = envOrDefault("MINIO_BUCKET", "inclination");
    this.client = new S3Client({
      endpoint: envOrDefault("S3_ENDPOINT", "http://localhost:9000"),
      region: envOrDefault("S3_REGION", "us-east-1"),
      forcePathStyle: envBool("S3_FORCE_PATH_STYLE", true),
      credentials: {
        accessKeyId: envOrDefault("S3_ACCESS_KEY", "inclination"),
        secretAccessKey: envOrDefault("S3_SECRET_KEY", "inclination_dev_pw"),
      },
    });
  }

  /** Readiness probe — listing buckets proves credentials + connectivity. */
  async ping(): Promise<unknown> {
    return this.client.send(new ListBucketsCommand({}));
  }

  /** The application bucket all uploads live in. */
  bucketName(): string {
    return this.bucket;
  }

  /**
   * Ensure the application bucket exists (idempotent, memoized). MinIO in dev
   * normally has it bootstrapped by `createbuckets`, but in tests / fresh boots
   * we create it on demand so presign + PUT round-trips work. A concurrent
   * "already exists" race is treated as success.
   */
  async ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = this.ensureBucketOnce().catch((err) => {
        // Reset so a transient failure can be retried on the next call.
        this.bucketReady = undefined;
        throw err;
      });
    }
    return this.bucketReady;
  }

  private async ensureBucketOnce(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch {
      // Not present (or no head permission) — attempt to create it.
    }
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      // Tolerate the bucket already existing (concurrent create / owned by us).
      const name = (err as { name?: string }).name ?? "";
      if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
        throw err;
      }
    }
  }

  /**
   * Presigned PUT URL the browser uploads bytes to directly (spec §9). The URL
   * is scoped to a single `objectKey` in the application bucket and expires.
   * `contentType` is bound into the signature so the upload must declare the
   * same content type we validated against the allowlist.
   */
  async presignPut(
    objectKey: string,
    contentType: string,
    expiresInSeconds = 900,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /** Presigned GET URL for downloading a stored object (spec §9). */
  async presignGet(objectKey: string, expiresInSeconds = 900): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: objectKey });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}

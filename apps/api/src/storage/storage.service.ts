import { Injectable } from "@nestjs/common";
import { ListBucketsCommand, S3Client } from "@aws-sdk/client-s3";
import { envBool, envOrDefault } from "@inclination/shared";
import type { HealthProbe } from "../health/checks";

@Injectable()
export class StorageService implements HealthProbe {
  readonly name = "minio";
  private readonly client: S3Client;

  constructor() {
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
}

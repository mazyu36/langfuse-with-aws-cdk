import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Database } from '../database';
import { Cache } from '../cache';
import { ClickHouse } from './clickhouse';
import { LOG_LEVEL } from '../../stack-config';

export interface CommonEnvironmentProps {
  logLevel: LOG_LEVEL;
  database: Database;
  cache: Cache;
  clickhouse: ClickHouse;
  bucket: s3.IBucket;
}

export class CommonEnvironment extends Construct {
  public readonly commonEnvironment: { [key: string]: string };
  public readonly commonSecrets: { [key: string]: ecs.Secret };
  constructor(scope: Construct, id: string, props: CommonEnvironmentProps) {
    super(scope, id);

    const { logLevel, database, cache, clickhouse, bucket } = props;

    /**
     * Encryption Key and Salt for Langfuse Services
     */
    const encryptionKey = new secretsmanager.Secret(this, 'EncryptionKey', {
      generateSecretString: {
        passwordLength: 64,
        excludeCharacters: 'ghijklmnopqrstuvwxyzGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+=-[]{};:,.<>?/', // only 0-9, a-f used
        excludePunctuation: true,
        excludeUppercase: true,
        requireEachIncludedType: false,
      },
    });

    const salt = new secretsmanager.Secret(this, 'Salt', {
      generateSecretString: {
        passwordLength: 32,
        excludePunctuation: true,
      },
    });

    /**
     * Common environment variables and secrest for Langfuse Web/Worker
     * @see https://langfuse.com/self-hosting/configuration
     */
    this.commonEnvironment = {
      TELEMETRY_ENABLED: 'true',
      LANGFUSE_ENABLE_EXPERIMENTAL_FEATURES: 'true',
      LANGFUSE_LOG_LEVEL: logLevel,

      DATABASE_NAME: database.databaseName,

      REDIS_HOST: cache.host,
      REDIS_PORT: cache.port.toString(),
      REDIS_TLS_ENABLED: 'true',

      CLICKHOUSE_MIGRATION_URL: 'clickhouse://clickhouse-tcp.local:9000',
      CLICKHOUSE_URL: 'http://clickhouse-http.local:8123',
      CLICKHOUSE_USER: clickhouse.clickhouseUser,
      CLICKHOUSE_CLUSTER_ENABLED: 'false',

      LANGFUSE_S3_EVENT_UPLOAD_BUCKET: bucket.bucketName,
      LANGFUSE_S3_EVENT_UPLOAD_PREFIX: 'events/',
      LANGFUSE_S3_MEDIA_UPLOAD_BUCKET: bucket.bucketName,
      LANGFUSE_S3_MEDIA_UPLOAD_PREFIX: 'media/',
    };

    this.commonSecrets = {
      SALT: ecs.Secret.fromSecretsManager(salt),
      ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(encryptionKey),

      DATABASE_HOST: ecs.Secret.fromSecretsManager(database.secret, 'host'),
      DATABASE_USERNAME: ecs.Secret.fromSecretsManager(database.secret, 'username'),
      DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(database.secret, 'password'),

      REDIS_AUTH: ecs.Secret.fromSecretsManager(cache.secret),

      CLICKHOUSE_PASSWORD: ecs.Secret.fromSecretsManager(clickhouse.clickhousePassword),
    };
  }
}

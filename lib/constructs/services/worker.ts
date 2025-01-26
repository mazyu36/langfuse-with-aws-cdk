import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Duration } from 'aws-cdk-lib';
import { Database } from '../database';
import { Cache } from '../cache';
import { ClickHouse } from './clickhouse';
import { LOG_LEVEL } from '../../stack-config';

export interface WorkerProps {
  cluster: ecs.ICluster;
  imageTag: string;
  logLevel: LOG_LEVEL;
  encryptionKey: secretsmanager.ISecret;
  salt: secretsmanager.ISecret;

  database: Database;
  cache: Cache;
  clickhouse: ClickHouse;
  bucket: s3.IBucket;
}

export class Worker extends Construct {
  constructor(scope: Construct, id: string, props: WorkerProps) {
    super(scope, id);

    const { cluster, imageTag, logLevel, encryptionKey, salt, database, cache, clickhouse, bucket } = props;

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64 },
    });

    taskDefinition.addContainer('Container', {
      image: ecs.ContainerImage.fromRegistry(`langfuse/langfuse-worker:${imageTag}`),
      portMappings: [{ containerPort: 3030, name: 'worker' }],
      logging: new ecs.AwsLogDriver({ streamPrefix: 'log' }),

      // https://langfuse.com/self-hosting/configuration
      environment: {
        TELEMETRY_ENABLED: 'true',
        LANGFUSE_ENABLE_EXPERIMENTAL_FEATURES: 'true',
        LANGFUSE_LOG_LEVEL: logLevel,

        DATABASE_NAME: database.databaseName,

        REDIS_HOST: cache.endpoint,
        REDIS_PORT: cache.port.toString(),
        REDIS_AUTH: cache.token,

        CLICKHOUSE_MIGRATION_URL: 'clickhouse://clickhouse-tcp.local:9000',
        CLICKHOUSE_URL: 'http://clickhouse-http.local:8123',
        CLICKHOUSE_USER: clickhouse.clickhouseUser,
        CLICKHOUSE_CLUSTER_ENABLED: 'false',

        LANGFUSE_S3_EVENT_UPLOAD_BUCKET: bucket.bucketName,
        LANGFUSE_S3_EVENT_UPLOAD_PREFIX: 'events/',
        LANGFUSE_S3_MEDIA_UPLOAD_BUCKET: bucket.bucketName,
        LANGFUSE_S3_MEDIA_UPLOAD_PREFIX: 'media/',
      },
      secrets: {
        DATABASE_HOST: ecs.Secret.fromSecretsManager(database.secret, 'host'),
        DATABASE_USERNAME: ecs.Secret.fromSecretsManager(database.secret, 'username'),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(database.secret, 'password'),
        SALT: ecs.Secret.fromSecretsManager(salt),
        ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(encryptionKey),

        CLICKHOUSE_PASSWORD: ecs.Secret.fromSecretsManager(clickhouse.clickhousePassword),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:3030/ || exit 1'],
        interval: Duration.seconds(15),
        startPeriod: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
      },
    });

    bucket.grantReadWrite(taskDefinition.taskRole);

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDefinition,
      serviceConnectConfiguration: {
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'service-connect',
        }),
      },
      enableExecuteCommand: true,
    });

    service.connections.allowToDefaultPort(database);
    service.connections.allowToDefaultPort(cache);
    service.connections.allowToDefaultPort(clickhouse);
    service.connections.allowTo(clickhouse, ec2.Port.tcp(9000));
  }
}

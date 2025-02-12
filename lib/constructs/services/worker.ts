import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Duration } from 'aws-cdk-lib';
import { Database } from '../database';
import { Cache } from '../cache';
import { ClickHouse } from './clickhouse';
import { CommonEnvironment } from './common-environment';

export interface WorkerProps {
  cluster: ecs.ICluster;
  enableFargateSpot?: boolean;
  taskDefCpu?: number;
  taskDefMemoryLimitMiB?: number;
  imageTag: string;
  commonEnvironment: CommonEnvironment;

  database: Database;
  cache: Cache;
  clickhouse: ClickHouse;
  bucket: s3.IBucket;
}

export class Worker extends Construct {
  constructor(scope: Construct, id: string, props: WorkerProps) {
    super(scope, id);

    const {
      cluster,
      enableFargateSpot,
      taskDefCpu,
      taskDefMemoryLimitMiB,
      imageTag,
      commonEnvironment,

      database,
      cache,
      clickhouse,
      bucket,
    } = props;

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: taskDefCpu ?? 1024,
      memoryLimitMiB: taskDefMemoryLimitMiB ?? 2048,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64 },
    });

    /**
     * Set environment variables and sectrets
     * @see https://langfuse.com/self-hosting/configuration
     */
    const environment = {
      ...commonEnvironment.commonEnvironment,
    };

    const secrets = {
      ...commonEnvironment.commonSecrets,
    };

    taskDefinition.addContainer('Container', {
      image: ecs.ContainerImage.fromRegistry(`langfuse/langfuse-worker:${imageTag}`),
      portMappings: [{ containerPort: 3030, name: 'worker' }],
      logging: new ecs.AwsLogDriver({ streamPrefix: 'log' }),
      environment,
      secrets,
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
      capacityProviderStrategies: enableFargateSpot
        ? [
            {
              capacityProvider: 'FARGATE',
              weight: 0,
            },
            {
              capacityProvider: 'FARGATE_SPOT',
              weight: 1,
            },
          ]
        : undefined,
    });

    service.connections.allowToDefaultPort(database);
    service.connections.allowToDefaultPort(cache);
    service.connections.allowToDefaultPort(clickhouse);
    service.connections.allowTo(clickhouse, ec2.Port.tcp(9000));
  }
}

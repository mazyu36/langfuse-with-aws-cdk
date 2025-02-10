import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';

export interface ClickHouseProps {
  vpc: ec2.IVpc;
  cluster: ecs.ICluster;
  enableFargateSpot?: boolean;
  taskDefCpu?: number;
  taskDefMemoryLimitMiB?: number;
  imageTag: string;
}

export class ClickHouse extends Construct implements ec2.IConnectable {
  public readonly clickhouseDatabaseName = 'default';
  public readonly clickhouseUser = 'clickhouse';
  public readonly clickhousePassword: secretsmanager.ISecret;
  public readonly connections: ec2.Connections;
  public readonly port = 8123;

  constructor(scope: Construct, id: string, props: ClickHouseProps) {
    super(scope, id);

    const { vpc, cluster, enableFargateSpot, taskDefCpu, taskDefMemoryLimitMiB, imageTag } = props;

    const fileSystem = new efs.FileSystem(this, 'EfsFileSystem', {
      vpc: vpc,
      encrypted: true,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    fileSystem.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['elasticfilesystem:ClientMount'],
        principals: [new iam.AnyPrincipal()],
        conditions: {
          Bool: {
            'elasticfilesystem:AccessedViaMountTarget': 'true',
          },
        },
      }),
    );

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: taskDefCpu ?? 1024,
      memoryLimitMiB: taskDefMemoryLimitMiB ?? 2048,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64 },
      volumes: [
        {
          name: 'clickhouse',
          efsVolumeConfiguration: {
            fileSystemId: fileSystem.fileSystemId,
          },
        },
      ],
    });

    fileSystem.grantRootAccess(taskDefinition.taskRole);

    this.clickhousePassword = new secretsmanager.Secret(this, 'ClickhousePassword', {
      generateSecretString: {
        passwordLength: 16,
        excludePunctuation: true,
      },
    });

    const container = taskDefinition.addContainer('Container', {
      image: ecs.ContainerImage.fromRegistry(`clickhouse/clickhouse-server:${imageTag}`),
      portMappings: [
        // https://clickhouse.com/docs/en/guides/sre/network-ports
        {
          name: 'clickhouse-http',
          hostPort: 8123,
          containerPort: 8123,
          appProtocol: ecs.AppProtocol.http,
        },
        {
          name: 'clickhouse-tcp',
          hostPort: 9000,
          containerPort: 9000,
        },
      ],
      logging: new ecs.AwsLogDriver({ streamPrefix: 'log' }),

      environment: {
        CLICKHOUSE_DB: this.clickhouseDatabaseName,
        CLICKHOUSE_USER: this.clickhouseUser,
      },
      secrets: {
        CLICKHOUSE_PASSWORD: ecs.Secret.fromSecretsManager(this.clickhousePassword),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:8123/ping || exit 1'],
        interval: Duration.seconds(5),
        timeout: Duration.seconds(5),
        retries: 10,
        startPeriod: Duration.seconds(10),
      },
    });

    container.addMountPoints({
      sourceVolume: 'clickhouse',
      containerPath: '/var/lib/clickhouse',
      readOnly: false,
    });

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc,
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDefinition,
      serviceConnectConfiguration: {
        services: [
          {
            portMappingName: 'clickhouse-http',
            port: 8123,
          },
          {
            portMappingName: 'clickhouse-tcp',
            port: 9000,
          },
        ],
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'service-connect',
        }),
      },
      enableExecuteCommand: true,
      securityGroups: [securityGroup],
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

    fileSystem.connections.allowDefaultPortFrom(service.connections);

    this.connections = new ec2.Connections({ securityGroups: [securityGroup], defaultPort: ec2.Port.tcp(this.port) });
  }
}

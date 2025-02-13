import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Duration, Stack } from 'aws-cdk-lib';
import { CdnLoadBalancer } from '../cdn-load-balancer';
import { CognitoAuth } from '../auth/cognito-auth';
import { Cache } from '../cache';
import { Database } from '../database';
import { ClickHouse } from './clickhouse';
import { CommonEnvironment } from './common-environment';

export interface WebProps {
  vpc: ec2.IVpc;

  cluster: ecs.ICluster;
  enableFargateSpot?: boolean;
  taskDefCpu?: number;
  taskDefMemoryLimitMiB?: number;
  langfuseWebTaskCount?: number;
  imageTag: string;
  commonEnvironment: CommonEnvironment;

  disableEmailPasswordAuth?: boolean;
  certificateForCognito?: acm.ICertificate;
  cognitoAuth?: CognitoAuth;

  cdnLoadBalancer: CdnLoadBalancer;

  database: Database;
  cache: Cache;
  clickhouse: ClickHouse;
  bucket: s3.IBucket;
}

export class Web extends Construct {
  constructor(scope: Construct, id: string, props: WebProps) {
    super(scope, id);

    const {
      vpc,

      cluster,
      enableFargateSpot,
      taskDefCpu,
      taskDefMemoryLimitMiB,
      langfuseWebTaskCount,
      imageTag,
      commonEnvironment,

      disableEmailPasswordAuth,
      cognitoAuth,

      cdnLoadBalancer,
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

    const nextAuthSecret = new secretsmanager.Secret(this, 'NextAuthSecret', {
      generateSecretString: {
        passwordLength: 32,
        excludePunctuation: true,
      },
    });

    const environment = {
      NEXTAUTH_URL: cdnLoadBalancer.url,
      HOSTNAME: '0.0.0.0',
      ...commonEnvironment.commonEnvironment,
      ...(disableEmailPasswordAuth && {
        AUTH_DISABLE_USERNAME_PASSWORD: `${disableEmailPasswordAuth}`,
      }),
      ...(cognitoAuth && {
        AUTH_COGNITO_CLIENT_ID: cognitoAuth.userPoolclient.userPoolClientId,
        AUTH_COGNITO_CLIENT_SECRET: cognitoAuth.userPoolclient.userPoolClientSecret.unsafeUnwrap(),
        AUTH_COGNITO_ISSUER: `https://cognito-idp.${Stack.of(this).region}.amazonaws.com/${cognitoAuth.userPool.userPoolId}`,
        AUTH_COGNITO_ALLOW_ACCOUNT_LINKING: 'true',
      }),
    };

    const secrets = {
      NEXTAUTH_SECRET: ecs.Secret.fromSecretsManager(nextAuthSecret),
      ...commonEnvironment.commonSecrets,
    };

    taskDefinition.addContainer('Container', {
      image: ecs.ContainerImage.fromRegistry(`langfuse/langfuse:${imageTag}`),
      portMappings: [{ containerPort: 3000, name: 'web' }],
      logging: new ecs.AwsLogDriver({ streamPrefix: 'log' }),
      environment,
      secrets,
      healthCheck: {
        command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1'],
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
      desiredCount: langfuseWebTaskCount,
    });

    service.connections.allowToDefaultPort(database);
    service.connections.allowToDefaultPort(cache);
    service.connections.allowToDefaultPort(clickhouse);
    service.connections.allowTo(clickhouse, ec2.Port.tcp(9000));

    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      targets: [service],
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 3000,
      deregistrationDelay: Duration.seconds(10),
      healthCheck: {
        interval: Duration.seconds(20),
        healthyHttpCodes: '200-299,307',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 6,
      },
    });

    cdnLoadBalancer.listener.addTargetGroups('Web', {
      targetGroups: [targetGroup],
    });
  }
}

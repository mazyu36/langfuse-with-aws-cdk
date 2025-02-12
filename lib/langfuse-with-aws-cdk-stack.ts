import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';

import { Construct } from 'constructs';
import { Web } from './constructs/services/web';
import { Worker } from './constructs/services/worker';
import { Database } from './constructs/database';
import { Cache } from './constructs/cache';
import { ClickHouse } from './constructs/services/clickhouse';
import { LOG_LEVEL, StackConfig, getStackConfig } from './stack-config';
import { Bastion } from './constructs/bastion';
import { CommonEnvironment } from './constructs/services/common-environment';

export interface LangfuseWithAwsCdkStackProps extends cdk.StackProps {
  envName: string;
  hostName?: string;
  domainName?: string;

  disableEmailPasswordAuth?: boolean;
  enableCognitoAuth?: boolean;
  certificateForCognito?: acm.ICertificate;
}

export class LangfuseWithAwsCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LangfuseWithAwsCdkStackProps) {
    super(scope, id, props);

    const { envName, hostName, domainName, disableEmailPasswordAuth, enableCognitoAuth, certificateForCognito } = props;

    /**
     * Configurations
     */
    const stackConfig: StackConfig = getStackConfig(envName);

    const allowedIPv4Cidrs = stackConfig.allowedIPv4Cidrs ?? ['0.0.0.0/0'];
    const allowedIPv6Cidrs = stackConfig.allowedIPv6Cidrs ?? ['::/0'];
    const langfuseImageTag = stackConfig.langfuseImageTag ?? 'latest';
    const clickhouseImageTag = stackConfig.clickhouseImageTag ?? 'latest';
    const langfuseLogLvel = stackConfig.langfuseLogLevel ?? LOG_LEVEL.INFO;

    /**
     * VPC
     */
    const vpc = new ec2.Vpc(this, 'VPC', {
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
      ...(stackConfig.useNatIncetance
        ? {
            natGatewayProvider: ec2.NatProvider.instanceV2({
              instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
              associatePublicIpAddress: true,
            }),
            natGateways: 1,
          }
        : undefined),
    });

    /**
     * ECS Cluster
     */
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      defaultCloudMapNamespace: {
        name: 'local',
        useForServiceConnect: true,
      },
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    /**
     * S3 Bucket
     */
    const langfuseBucket = new s3.Bucket(this, 'Bucket', {
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      enforceSSL: true,
    });

    /**
     * Database (PostgreSQL)
     */
    const database = new Database(this, 'Database', {
      vpc,
      auroraScalesToZero: stackConfig.auroraScalesToZero,
    });

    /**
     * Cache (Valkey)
     */
    const cache = new Cache(this, 'Cache', {
      vpc,
      cacheMultiAz: stackConfig.cacheMultiAz,
    });

    /**
     * Fargate Service (ClickHouse)
     */
    const clickhouse = new ClickHouse(this, 'ClickHouse', {
      vpc,
      cluster,
      enableFargateSpot: stackConfig.enableFargateSpot,
      taskDefCpu: stackConfig.taskDefCpu,
      taskDefMemoryLimitMiB: stackConfig.taskDefMemoryLimitMiB,
      imageTag: clickhouseImageTag,
    });

    const commonEnvironment = new CommonEnvironment(this, 'CommonEnvironment', {
      logLevel: langfuseLogLvel,
      database,
      cache,
      clickhouse,
      bucket: langfuseBucket,
    });

    /**
     * Fargate Service (Langfuse Web)
     */
    const web = new Web(this, 'Web', {
      hostName: hostName,
      domainName: domainName,
      disableEmailPasswordAuth,
      enableCognitoAuth,
      certificateForCognito,

      vpc,
      allowedIPv4Cidrs,
      allowedIPv6Cidrs,

      cluster,
      enableFargateSpot: stackConfig.enableFargateSpot,
      taskDefCpu: stackConfig.taskDefCpu,
      taskDefMemoryLimitMiB: stackConfig.taskDefMemoryLimitMiB,
      langfuseWebTaskCount: stackConfig.langfuseWebTaskCount,
      imageTag: langfuseImageTag,
      commonEnvironment,

      database,
      cache,
      clickhouse,
      bucket: langfuseBucket,
    });

    /**
     * Fargate Service (Langfuse Worker)
     */
    new Worker(this, 'Worker', {
      cluster,
      enableFargateSpot: stackConfig.enableFargateSpot,
      taskDefCpu: stackConfig.taskDefCpu,
      taskDefMemoryLimitMiB: stackConfig.taskDefMemoryLimitMiB,
      imageTag: langfuseImageTag,
      commonEnvironment,
      database,
      cache,
      clickhouse,
      bucket: langfuseBucket,
    });

    /**
     * Bastion
     */
    if (stackConfig.createBastion) {
      new Bastion(this, 'Bastion', {
        vpc,
        database,
      });
    }

    /**
     * Outputs
     */
    new cdk.CfnOutput(this, 'LangfuseURL', {
      value: web.url,
      description: 'The URL of the Langfuse application',
      exportName: 'LangfuseURL',
    });
  }
}

import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as logs from 'aws-cdk-lib/aws-logs';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface CacheProps {
  vpc: ec2.IVpc;
  cacheMultiAz?: boolean;
}

export class Cache extends Construct implements ec2.IConnectable {
  public readonly endpoint: string;
  public readonly connections: ec2.Connections;
  public readonly port: number = 6379;
  public readonly token: string;

  constructor(scope: Construct, id: string, props: CacheProps) {
    super(scope, id);

    const { vpc, cacheMultiAz } = props;

    const subnetGroup = new elasticache.CfnSubnetGroup(this, 'SubnetGroup', {
      subnetIds: vpc.privateSubnets.map(({ subnetId }) => subnetId),
      description: 'Subnet Group for Langfuse ElastiCache',
    });

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc,
    });

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const parameterGroup = new elasticache.CfnParameterGroup(this, 'RedisParameterGroup', {
      cacheParameterGroupFamily: 'valkey8',
      description: 'Custom parameter group for Langfuse ElastiCache',
      properties: {
        'maxmemory-policy': 'noeviction',
      },
    });

    const cache = new elasticache.CfnReplicationGroup(this, 'Resource', {
      engine: 'Valkey',
      cacheNodeType: 'cache.t4g.micro',
      engineVersion: '8.0',
      port: this.port,
      replicasPerNodeGroup: cacheMultiAz ? 1 : 0,
      numNodeGroups: 1,
      replicationGroupDescription: 'Valkey Cache for Langfuse',
      cacheSubnetGroupName: subnetGroup.ref,
      automaticFailoverEnabled: cacheMultiAz,
      multiAzEnabled: cacheMultiAz,
      securityGroupIds: [securityGroup.securityGroupId],
      transitEncryptionEnabled: true,
      transitEncryptionMode: 'preferred', // In `required` mode, Langfuse services cannot connect to Cache.
      atRestEncryptionEnabled: true,
      cacheParameterGroupName: parameterGroup.ref,
      logDeliveryConfigurations: [
        {
          logFormat: 'json',
          logType: 'engine-log',
          destinationType: 'cloudwatch-logs',
          destinationDetails: {
            cloudWatchLogsDetails: {
              logGroup: logGroup.logGroupName,
            },
          },
        },
      ],
    });

    this.endpoint = cache.attrPrimaryEndPointAddress;
    this.token = cache.authToken!;

    this.connections = new ec2.Connections({ securityGroups: [securityGroup], defaultPort: ec2.Port.tcp(this.port) });
  }
}

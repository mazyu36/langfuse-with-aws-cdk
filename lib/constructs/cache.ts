import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface CacheProps {
  vpc: ec2.IVpc;
  cacheMultiAz?: boolean;
}

export class Cache extends Construct implements ec2.IConnectable {
  public readonly host: string;
  public readonly port: number = 6379;
  public readonly secret: secretsmanager.Secret;
  public readonly connections: ec2.Connections;

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

    this.secret = new secretsmanager.Secret(this, 'AuthToken', {
      generateSecretString: {
        passwordLength: 30,
        excludePunctuation: true,
      },
    });

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      removalPolicy: RemovalPolicy.DESTROY,
    });

    /**
     * We must set the parameter `maxmemory-policy` to `noeviction` to ensure that the queue jobs are not evicted from the cache.
     * @see https://langfuse.com/self-hosting/infrastructure/cache#deployment-options
     */
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
      transitEncryptionMode: 'required',
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
      authToken: this.secret.secretValue.unsafeUnwrap(),
    });

    this.host = cache.attrPrimaryEndPointAddress;

    this.connections = new ec2.Connections({ securityGroups: [securityGroup], defaultPort: ec2.Port.tcp(this.port) });
  }
}

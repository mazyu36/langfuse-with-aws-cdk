import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface DatabasesProps {
  vpc: ec2.IVpc;
  auroraScalesToZero?: boolean;
}

export class Database extends Construct implements ec2.IConnectable {
  public readonly connections: ec2.Connections;
  public readonly cluster: rds.DatabaseCluster;
  public readonly secret: secretsmanager.ISecret;
  public readonly databaseName = 'langfuse';

  constructor(scope: Construct, id: string, props: DatabasesProps) {
    super(scope, id);

    const { vpc, auroraScalesToZero } = props;

    const engine = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.VER_16_6,
    });

    const cluster = new rds.DatabaseCluster(this, 'Cluster', {
      engine,
      vpc,
      serverlessV2MinCapacity: auroraScalesToZero ? 0 : 0.5,
      serverlessV2MaxCapacity: 2.0,
      writer: rds.ClusterInstance.serverlessV2('Writer', {
        autoMinorVersionUpgrade: true,
        publiclyAccessible: false,
      }),
      defaultDatabaseName: this.databaseName,
      enableDataApi: true,
      storageEncrypted: true,
      removalPolicy: RemovalPolicy.DESTROY,
      parameterGroup: new rds.ParameterGroup(this, 'ParameterGroup', {
        engine,
        parameters: {
          // Terminate idle session for Aurora Serverless V2 auto-pause
          idle_session_timeout: '60000',
        },
      }),
    });

    this.connections = cluster.connections;
    this.cluster = cluster;
    this.secret = cluster.secret!;
  }
}

import { CfnOutput, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Database } from './database';

export interface BastionProps {
  vpc: ec2.IVpc;
  database: Database;
}

export class Bastion extends Construct {
  constructor(scope: Construct, id: string, props: BastionProps) {
    super(scope, id);

    const { vpc, database } = props;

    const host = new ec2.BastionHostLinux(this, 'BastionHost', {
      vpc,
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
      blockDevices: [
        {
          deviceName: '/dev/sdf',
          volume: ec2.BlockDeviceVolume.ebs(8, {
            encrypted: true,
          }),
        },
      ],
    });

    new CfnOutput(this, 'PortForwardCommand', {
      value: `aws ssm start-session --region ${Stack.of(this).region} --target ${
        host.instanceId
      } --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters '{"portNumber":["${
        database.cluster.clusterEndpoint.port
      }"], "localPortNumber":["${database.cluster.clusterEndpoint.port}"], "host": ["${database.cluster.clusterEndpoint.hostname}"]}'`,
    });

    new CfnOutput(this, 'DatabaseSecretsCommand', {
      value: `aws secretsmanager get-secret-value --secret-id ${database.cluster.secret!.secretName} --region ${
        Stack.of(this).region
      }`,
    });
  }
}

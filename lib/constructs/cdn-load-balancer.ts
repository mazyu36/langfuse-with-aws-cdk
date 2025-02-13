import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface CdnLoadBalancerProps {
  hostName?: string;
  hostedZone?: route53.IHostedZone;
  vpc: ec2.IVpc;
  allowedIPv4Cidrs: string[];
  allowedIPv6Cidrs: string[];
}

export class CdnLoadBalancer extends Construct {
  public readonly albARecord?: route53.ARecord;
  public readonly url: string;
  public readonly listener: elbv2.ApplicationListener;
  constructor(scope: Construct, id: string, props: CdnLoadBalancerProps) {
    super(scope, id);

    const { hostName, hostedZone, vpc, allowedIPv4Cidrs, allowedIPv6Cidrs } = props;

    const certificate = hostedZone
      ? new acm.Certificate(this, 'Certificate', {
          domainName: `${hostName}.${hostedZone.zoneName}`,
          validation: acm.CertificateValidation.fromDns(hostedZone),
        })
      : undefined;

    const alb = new elbv2.ApplicationLoadBalancer(this, 'ApplicationLoadBalancer', {
      vpc,
      vpcSubnets: vpc.selectSubnets({ subnets: vpc.publicSubnets }),
      internetFacing: true,
    });

    const protocol = hostedZone ? elbv2.ApplicationProtocol.HTTPS : elbv2.ApplicationProtocol.HTTP;

    const accessLogBucket = new s3.Bucket(this, 'AlbAccessLogBucket', {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    alb.logAccessLogs(accessLogBucket, 'AlbAccessLogs');

    this.listener = alb.addListener('Listener', {
      protocol,
      open: false,
      defaultAction: elbv2.ListenerAction.fixedResponse(400),
      certificates: certificate ? [certificate] : undefined,
    });

    allowedIPv4Cidrs.forEach(cidr => this.listener.connections.allowDefaultPortFrom(ec2.Peer.ipv4(cidr)));
    allowedIPv6Cidrs.forEach(cidr => this.listener.connections.allowDefaultPortFrom(ec2.Peer.ipv6(cidr)));

    this.albARecord = hostedZone
      ? new route53.ARecord(this, 'AliasRecord', {
          zone: hostedZone,
          recordName: hostName,
          target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb)),
        })
      : undefined;

    this.url = hostedZone
      ? `${protocol.toLowerCase()}://${hostName}.${hostedZone.zoneName}`
      : `${protocol.toLowerCase()}://${alb.loadBalancerDnsName}`;
  }
}

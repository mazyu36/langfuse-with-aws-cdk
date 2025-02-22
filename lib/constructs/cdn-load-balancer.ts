import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cr from 'aws-cdk-lib/custom-resources';

export interface CdnLoadBalancerProps {
  hostName?: string;
  hostedZone?: route53.IHostedZone;
  vpc: ec2.IVpc;
  allowedIPv4Cidrs: string[];
  allowedIPv6Cidrs: string[];

  enableCloudFrontVpcOrign?: boolean;
  certificateForCloudFront?: acm.ICertificate;
  webAclForCloudFrontArn?: string;
}

export class CdnLoadBalancer extends Construct {
  public readonly aRecord?: route53.ARecord;
  public readonly url: string;
  public readonly listener: elbv2.ApplicationListener;
  private readonly props: CdnLoadBalancerProps;
  constructor(scope: Construct, id: string, props: CdnLoadBalancerProps) {
    super(scope, id);

    this.props = props;
    const { listener, url, aRecord } = this.props.enableCloudFrontVpcOrign ? this.createCloudFrontWithAlb() : this.createAlb();

    this.listener = listener;
    this.url = url;
    this.aRecord = aRecord;
  }

  /**
   * Create CloudFront Distribution with VPC Origin and ALB
   */
  private createCloudFrontWithAlb() {
    const { hostName, hostedZone, vpc, certificateForCloudFront, webAclForCloudFrontArn } = this.props;

    const alb = new elbv2.ApplicationLoadBalancer(this, 'ApplicationLoadBalancer', {
      vpc,
      vpcSubnets: vpc.selectSubnets({ subnets: vpc.privateSubnets }),
      internetFacing: false,
    });

    const protocol = elbv2.ApplicationProtocol.HTTP;

    const accessLogBucket = new s3.Bucket(this, 'AlbAccessLogBucket', {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    alb.logAccessLogs(accessLogBucket, 'AlbAccessLogs');

    const listener = alb.addListener('Listener', {
      protocol,
      open: false,
      defaultAction: elbv2.ListenerAction.fixedResponse(400),
    });

    const cloudFrontAccessLogBucket = new s3.Bucket(this, 'CloudFrontAccessLogBucket', {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,

    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Distribution for Langfuse',
      ...(certificateForCloudFront
        ? {
          domainNames: [`${hostName}.${hostedZone!.zoneName}`],
          certificate: certificateForCloudFront,
        }
        : {}),
      webAclId: webAclForCloudFrontArn,
      defaultBehavior: {
        origin: origins.VpcOrigin.withApplicationLoadBalancer(alb,{
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          httpPort: 80,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
        cachePolicy: cloudfront.CachePolicy.USE_ORIGIN_CACHE_CONTROL_HEADERS_QUERY_STRINGS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
      logBucket: cloudFrontAccessLogBucket,
    });

    const getSg = new cr.AwsCustomResource(this, 'GetSecurityGroup', {
      onCreate: {
        service: 'ec2',
        action: 'describeSecurityGroups',
        parameters: {
          Filters: [
            { Name: 'vpc-id', Values: [vpc.vpcId] },
            { Name: 'group-name', Values: ['CloudFront-VPCOrigins-Service-SG'] },
          ],
        },
        physicalResourceId: cr.PhysicalResourceId.of('CloudFront-VPCOrigins-Service-SG'),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: [`arn:aws:ec2:${Stack.of(this).region}:${Stack.of(this).account}:security-group/*` ] }),
    });

    getSg.node.addDependency(distribution);

    const sgVpcOrigins = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'VpcOriginsSecurityGroup',
      getSg.getResponseField('SecurityGroups.0.GroupId'),
    );

    listener.connections.allowDefaultPortFrom(sgVpcOrigins);

    const aRecord = hostedZone
      ? new route53.ARecord(this, 'AliasRecord', {
        zone: hostedZone,
        recordName: hostName,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      })
      : undefined;

    const url = hostedZone
      ? `https://${hostName}.${hostedZone.zoneName}`
      : `https://${distribution.domainName}`;

    return { listener, url, aRecord };
  }

  /**
   * Create intenet facing ALB
   */
  private createAlb() {
    const { hostName, hostedZone, vpc, allowedIPv4Cidrs, allowedIPv6Cidrs } = this.props;

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

    const listener = alb.addListener('Listener', {
      protocol,
      open: false,
      defaultAction: elbv2.ListenerAction.fixedResponse(400),
      certificates: certificate ? [certificate] : undefined,
    });

    allowedIPv4Cidrs.forEach(cidr => listener.connections.allowDefaultPortFrom(ec2.Peer.ipv4(cidr)));
    allowedIPv6Cidrs.forEach(cidr => listener.connections.allowDefaultPortFrom(ec2.Peer.ipv6(cidr)));

    const aRecord = hostedZone
      ? new route53.ARecord(this, 'AliasRecord', {
        zone: hostedZone,
        recordName: hostName,
        target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb)),
      })
      : undefined;

    const url = hostedZone
      ? `${protocol.toLowerCase()}://${hostName}.${hostedZone.zoneName}`
      : `${protocol.toLowerCase()}://${alb.loadBalancerDnsName}`;

    return { listener, url, aRecord };
  }
}

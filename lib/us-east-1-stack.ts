import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

import { Construct } from 'constructs';
import { DomainConfig } from '../bin/app-config';

export interface UsEast1StackProps extends cdk.StackProps {
  domainConfig: DomainConfig;
  enableCognitoAuth?: boolean;
  enableCloudFrontVpcOrign?: boolean;
  allowedIPv4Cidrs?: string[];
  allowedIPv6Cidrs?: string[];
}

export class UsEast1Stack extends cdk.Stack {
  public readonly certificateForCognito?: acm.ICertificate;
  public readonly certificateForCloudFront?: acm.ICertificate;
  public readonly webAclForCloudFrontArn?: string;
  constructor(scope: Construct, id: string, props: UsEast1StackProps) {
    super(scope, id, props);

    const { hostName, domainName } = props.domainConfig;

    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', { domainName });

    this.certificateForCognito = props.enableCognitoAuth
      ? new acm.Certificate(this, 'certificateForCognito', {
        domainName: `auth.${hostName}.${hostedZone!.zoneName}`,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      })
      : undefined;

    this.certificateForCloudFront = props.enableCloudFrontVpcOrign
      ? new acm.Certificate(this, 'certificateForCloudFront', {
        domainName: `${hostName}.${hostedZone!.zoneName}`,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      })
      : undefined;

    if (props.enableCloudFrontVpcOrign && (props.allowedIPv4Cidrs || props.allowedIPv6Cidrs)) {

      const ipv4IpSet = props.allowedIPv4Cidrs ? new wafv2.CfnIPSet(this, 'AlloIpv4IPSet', {
        ipAddressVersion: 'IPV4',
        scope: 'CLOUDFRONT',
        addresses: props.allowedIPv4Cidrs,
      }) : undefined;

      const ipv6IpSet = props.allowedIPv6Cidrs ? new wafv2.CfnIPSet(this, 'AlloIpv6IPSet', {
        ipAddressVersion: 'IPV6',
        scope: 'CLOUDFRONT',
        addresses: props.allowedIPv6Cidrs,
      }) : undefined;

      const rules: wafv2.CfnWebACL.RuleProperty[] = [];
      let priority = 0;

      if (ipv4IpSet) {
        rules.push({
          name: 'AllowIPv4',
          priority: priority++,
          action: { allow: {} },
          statement: {
            ipSetReferenceStatement: {
              arn: ipv4IpSet.attrArn,
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AllowIPv4',
            sampledRequestsEnabled: true,
          },
        });
      }

      if (ipv6IpSet) {
        rules.push({
          name: 'AllowIPv6',
          priority: priority++,
          action: { allow: {} },
          statement: {
            ipSetReferenceStatement: {
              arn: ipv6IpSet.attrArn,
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AllowIPv6',
            sampledRequestsEnabled: true,
          },
        });
      }

      const webAclForCloudFront = new wafv2.CfnWebACL(this, 'WebACL', {
        defaultAction: { allow: {} },
        scope: 'CLOUDFRONT',
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: 'WebACL',
          sampledRequestsEnabled: true,
        },
        rules: rules,
      });

      this.webAclForCloudFrontArn = webAclForCloudFront.attrArn;
    }
  }
}

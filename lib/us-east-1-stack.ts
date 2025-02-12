import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';

import { Construct } from 'constructs';
import { DomainConfig } from '../bin/app-config';

export interface UsEast1StackProps extends cdk.StackProps {
  domainConfig?: DomainConfig;
}

export class UsEast1Stack extends cdk.Stack {
  public readonly certificateForCognito: acm.ICertificate;
  constructor(scope: Construct, id: string, props: UsEast1StackProps) {
    super(scope, id, props);

    if (!props.domainConfig) {
      throw new Error(`To enable Cognito auth, you must set domainConfig.`);
    }

    const { hostName, domainName } = props.domainConfig;

    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', { domainName });

    this.certificateForCognito = new acm.Certificate(this, 'certificateForCognito', {
      domainName: `auth.${hostName}.${hostedZone!.zoneName}`,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });
  }
}

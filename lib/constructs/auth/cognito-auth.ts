import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { RemovalPolicy } from 'aws-cdk-lib';
import { CdnLoadBalancer } from '../cdn-load-balancer';

export interface CognitoAuthProps {
  hostedZone?: route53.IHostedZone;
  hostName?: string;
  certificateForCognito: acm.ICertificate;
  cdnLoadBalancer: CdnLoadBalancer;
}

export class CognitoAuth extends Construct {
  public readonly userPool: cognito.IUserPool;
  public readonly userPoolclient: cognito.IUserPoolClient;

  constructor(scope: Construct, id: string, props: CognitoAuthProps) {
    super(scope, id);

    const { certificateForCognito, hostName, hostedZone, cdnLoadBalancer } = props;

    if (hostedZone === undefined || hostName === undefined) {
      throw new Error(
        `Unexpected Error (bug): hostedZone and hostName should be defined when certificateForCognito exists, got: hostedZone=${hostedZone}, hostName=${hostName}.`,
      );
    }

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      signInAliases: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      selfSignUpEnabled: true,
      userVerification: {
        emailSubject: 'Langfuse - Verify your new account',
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.userPoolclient = this.userPool.addClient('CognitoClient', {
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: [`${cdnLoadBalancer.url}/api/auth/callback/cognito`],
      },
      generateSecret: true,
    });

    new cognito.CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: this.userPool.userPoolId,
      clientId: this.userPoolclient.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    const domain = this.userPool.addDomain('CognitoDomain', {
      customDomain: {
        domainName: `auth.${hostName}.${hostedZone.zoneName}`,
        certificate: certificateForCognito,
      },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    domain.node.addDependency(cdnLoadBalancer.aRecord!);

    new route53.ARecord(this, 'CognitoARecord', {
      zone: hostedZone,
      recordName: `auth.${hostName}`,
      target: route53.RecordTarget.fromAlias(new targets.UserPoolDomainTarget(domain)),
    });
  }
}

import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Cache } from '../cache';
import { Database } from '../database';
import { ClickHouse } from './clickhouse';
import { CommonEnvironment } from './common-environment';

export interface WebProps {
  domainName?: string;
  hostName?: string;

  disableEmailPasswordAuth?: boolean;
  enableCognitoAuth?: boolean;
  certificateForCognito?: acm.ICertificate;

  vpc: ec2.IVpc;
  allowedIPv4Cidrs: string[];
  allowedIPv6Cidrs: string[];

  cluster: ecs.ICluster;
  enableFargateSpot?: boolean;
  taskDefCpu?: number;
  taskDefMemoryLimitMiB?: number;
  langfuseWebTaskCount?: number;
  imageTag: string;
  commonEnvironment: CommonEnvironment;

  database: Database;
  cache: Cache;
  clickhouse: ClickHouse;
  bucket: s3.IBucket;
}

export class Web extends Construct {
  public readonly url: string;

  private userPool: cognito.IUserPool;
  private userPoolclient: cognito.IUserPoolClient;

  constructor(scope: Construct, id: string, props: WebProps) {
    super(scope, id);

    const {
      hostName,
      domainName,

      disableEmailPasswordAuth,
      enableCognitoAuth,
      certificateForCognito,

      vpc,
      allowedIPv4Cidrs,
      allowedIPv6Cidrs,

      cluster,
      enableFargateSpot,
      taskDefCpu,
      taskDefMemoryLimitMiB,
      langfuseWebTaskCount,
      imageTag,
      commonEnvironment,

      database,
      cache,
      clickhouse,
      bucket,
    } = props;

    /**
     * Route53, Application Load Balancer
     */
    const hostedZone = domainName ? route53.HostedZone.fromLookup(this, 'HostedZone', { domainName }) : undefined;

    const protocol = hostedZone ? elbv2.ApplicationProtocol.HTTPS : elbv2.ApplicationProtocol.HTTP;

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

    if (hostedZone) {
      const albARecord = new route53.ARecord(this, 'AliasRecord', {
        zone: hostedZone,
        recordName: hostName,
        target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb)),
      });
      this.url = `${protocol.toLowerCase()}://${hostName}.${hostedZone.zoneName}`;

      this.createCognitoAuthResource(
        hostName!,
        hostedZone,
        albARecord,
        enableCognitoAuth,
        certificateForCognito,
      );
    } else {
      this.url = `${protocol.toLowerCase()}://${alb.loadBalancerDnsName}`;
    }

    /**
     * ECS Service
     */
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu: taskDefCpu ?? 1024,
      memoryLimitMiB: taskDefMemoryLimitMiB ?? 2048,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64 },
    });

    const nextAuthSecret = new secretsmanager.Secret(this, 'NextAuthSecret', {
      generateSecretString: {
        passwordLength: 32,
        excludePunctuation: true,
      },
    });

    /**
     * Set environment variables and sectrets
     * @see https://langfuse.com/self-hosting/configuration
     */
    const environment = {
      NEXTAUTH_URL: this.url,
      HOSTNAME: '0.0.0.0',
      ...commonEnvironment.commonEnvironment,
      ...(disableEmailPasswordAuth && { AUTH_DISABLE_USERNAME_PASSWORD: `${disableEmailPasswordAuth}` }),
      ...(enableCognitoAuth && {
        AUTH_COGNITO_CLIENT_ID: this.userPoolclient.userPoolClientId,
        AUTH_COGNITO_CLIENT_SECRET: this.userPoolclient.userPoolClientSecret.unsafeUnwrap(),
        AUTH_COGNITO_ISSUER: `https://cognito-idp.${Stack.of(this).region}.amazonaws.com/${this.userPool.userPoolId}`,
        AUTH_COGNITO_ALLOW_ACCOUNT_LINKING: 'true',
      }),
    };

    const secrets = {
      NEXTAUTH_SECRET: ecs.Secret.fromSecretsManager(nextAuthSecret),
      ...commonEnvironment.commonSecrets,
    };

    taskDefinition.addContainer('Container', {
      image: ecs.ContainerImage.fromRegistry(`langfuse/langfuse:${imageTag}`),
      portMappings: [{ containerPort: 3000, name: 'web' }],
      logging: new ecs.AwsLogDriver({ streamPrefix: 'log' }),
      environment,
      secrets,
      healthCheck: {
        command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1'],
        interval: Duration.seconds(15),
        startPeriod: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
      },
    });

    bucket.grantReadWrite(taskDefinition.taskRole);

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDefinition,
      serviceConnectConfiguration: {
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'service-connect',
        }),
      },
      enableExecuteCommand: true,
      capacityProviderStrategies: enableFargateSpot
        ? [
          {
            capacityProvider: 'FARGATE',
            weight: 0,
          },
          {
            capacityProvider: 'FARGATE_SPOT',
            weight: 1,
          },
        ]
        : undefined,
      desiredCount: langfuseWebTaskCount,
    });

    service.connections.allowToDefaultPort(database);
    service.connections.allowToDefaultPort(cache);
    service.connections.allowToDefaultPort(clickhouse);
    service.connections.allowTo(clickhouse, ec2.Port.tcp(9000));

    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      targets: [service],
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 3000,
      deregistrationDelay: Duration.seconds(10),
      healthCheck: {
        interval: Duration.seconds(20),
        healthyHttpCodes: '200-299,307',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 6,
      },
    });

    listener.addTargetGroups('Web', {
      targetGroups: [targetGroup],
    });
  }


  /**
   * Create Cognito UserPool, UserPool Client, and domain.
   */
  private createCognitoAuthResource(
    hostName: string,
    hostedZone: route53.IHostedZone,
    albArecord: route53.ARecord,
    enableCognitoAuth?: boolean,
    certificateForCognito?: acm.ICertificate,
  ) {
    if (!enableCognitoAuth || !certificateForCognito) {
      return;
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
        callbackUrls: [`${this.url}/api/auth/callback/cognito`],
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
    domain.node.addDependency(albArecord);

    new route53.ARecord(this, 'CognitoARecord', {
      zone: hostedZone,
      recordName: `auth.${hostName}`,
      target: route53.RecordTarget.fromAlias(new targets.UserPoolDomainTarget(domain)),
    });
  }
}

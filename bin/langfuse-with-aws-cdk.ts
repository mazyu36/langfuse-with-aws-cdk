#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { LangfuseWithAwsCdkStack } from '../lib/langfuse-with-aws-cdk-stack';
import { getAppConfig } from './app-config';
import { UsEast1Stack } from '../lib/us-east-1-stack';

const app = new cdk.App();

const envName = app.node.tryGetContext('env');

if (envName === undefined) {
  throw new Error(
    'Please specify the environment name using the --context parameter. For example: cdk deploy --context env=dev',
  );
}

const appConfig = getAppConfig(envName);

if (appConfig.enableCognitoAuth === true && appConfig.domainConfig === undefined) {
  throw new Error(`To enable Cognito auth, you must set domainConfig, env: ${envName}.`);
}

let usEast1Stack: UsEast1Stack | undefined;

if (
  appConfig.domainConfig !== undefined &&
  (appConfig.enableCognitoAuth === true || appConfig.enableCloudFrontVpcOrign === true)
) {
  usEast1Stack = new UsEast1Stack(app, `UsEast1Stack-${envName}`, {
    env: {
      account: appConfig.env?.account ?? process.env.CDK_DEFAULT_ACCOUNT,
      region: 'us-east-1',
    },
    crossRegionReferences: true,
    domainConfig: appConfig.domainConfig,
    enableCognitoAuth: appConfig.enableCognitoAuth,
    enableCloudFrontVpcOrign: appConfig.enableCloudFrontVpcOrign,

    allowedIPv4Cidrs: appConfig.allowedIPv4Cidrs,
    allowedIPv6Cidrs: appConfig.allowedIPv6Cidrs,
  });
}

const stack = new LangfuseWithAwsCdkStack(app, `LangfuseWithAwsCdkStack-${envName}`, {
  env: {
    account: appConfig.env?.account ?? process.env.CDK_DEFAULT_ACCOUNT,
    region: appConfig.env?.region ?? process.env.CDK_DEFAULT_REGION,
  },
  envName,
  allowedIPv4Cidrs: appConfig.allowedIPv4Cidrs,
  allowedIPv6Cidrs: appConfig.allowedIPv6Cidrs,

  hostName: appConfig.domainConfig?.hostName,
  domainName: appConfig.domainConfig?.domainName,
  crossRegionReferences: true,

  disableEmailPasswordAuth: appConfig.disableEmailPasswordAuth,
  certificateForCognito: usEast1Stack?.certificateForCognito,

  enableCloudFrontVpcOrign: appConfig.enableCloudFrontVpcOrign,
  certificateForCloudFront: usEast1Stack?.certificateForCloudFront,
  webAclForCloudFrontArn: usEast1Stack?.webAclForCloudFrontArn,
});

cdk.Tags.of(stack).add('Environment', envName);

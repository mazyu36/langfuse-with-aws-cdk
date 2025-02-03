#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { LangfuseWithAwsCdkStack } from '../lib/langfuse-with-aws-cdk-stack';
import { getAppConfig } from './app-config';

const app = new cdk.App();

const envName = app.node.tryGetContext('env');

if (envName === undefined) {
  throw new Error(
    'Please specify the environment name using the --context parameter. For example: cdk deploy --context env=dev',
  );
}

const appConfig = getAppConfig(envName);

const stack = new LangfuseWithAwsCdkStack(app, `LangfuseWithAwsCdkStack-${envName}`, {
  env: {
    account: appConfig.env?.account ?? process.env.CDK_DEFAULT_ACCOUNT,
    region: appConfig.env?.region ?? process.env.CDK_DEFAULT_REGION,
  },
  envName,
  hostName: appConfig.domainConfig?.hostName,
  domainName: appConfig.domainConfig?.domainName,
});

cdk.Tags.of(stack).add('Environment', envName);

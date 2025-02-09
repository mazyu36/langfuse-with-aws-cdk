import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as LangfuseWithAwsCdk from '../lib/langfuse-with-aws-cdk-stack';
import { getAppConfig } from '../bin/app-config';

test('snapshot test for stg', () => {
  const envName = 'stg';

  const app = new cdk.App();

  const appConfig = getAppConfig(envName);

  // WHEN
  const stack = new LangfuseWithAwsCdk.LangfuseWithAwsCdkStack(app, 'MyTestStack', {
    env: {
      account: '123456789012',
      region: 'us-east-1',
    },
    envName,
    hostName: appConfig.domainConfig?.hostName,
    domainName: appConfig.domainConfig?.domainName,
  });

  // THEN
  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});

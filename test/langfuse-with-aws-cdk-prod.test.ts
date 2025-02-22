import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as LangfuseWithAwsCdk from '../lib/langfuse-with-aws-cdk-stack';
import { getAppConfig } from '../bin/app-config';
import { UsEast1Stack } from '../lib/us-east-1-stack';

test('snapshot test for prod', () => {
  const envName = 'prod';

  const app = new cdk.App();

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
        account: '123456789012',
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

  const stack = new LangfuseWithAwsCdk.LangfuseWithAwsCdkStack(app, 'MyTestStack', {
    env: {
      account: '123456789012',
      region: 'us-east-1',
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

  // THEN
  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});

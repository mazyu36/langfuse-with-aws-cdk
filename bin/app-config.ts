import { Environment } from 'aws-cdk-lib';

export interface AppConfig {
  /**
   * The AWS environment settings for the application, including the AWS account and region.
   * If not provided, the default values for the current AWS account and region are used.
   *
   * @default - use CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION
   */
  env?: Environment;
}

const appConfigMap: Record<string, AppConfig> = {
  dev: {
    env: {
      // account: '123456789012',
      region: 'us-east-1',
    },
  },
  stg: {
    env: {
      // account: '123456789012',
      region: 'us-east-1',
    },
  },
  prod: {
    env: {
      // account: '123456789012',
      region: 'us-east-1',
    },
  },
};

export function getAppConfig(envName: string): AppConfig {
  const config = appConfigMap[envName];
  if (!config) {
    throw new Error(`AppConfig does not exist. envName:${envName}`);
  }
  return config;
}

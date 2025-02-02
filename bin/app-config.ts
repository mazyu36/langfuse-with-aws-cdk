import { Environment } from 'aws-cdk-lib';

export interface AppConfig {
  /**
   * The AWS environment settings for the application, including the AWS account and region.
   * If not provided, the default values for the current AWS account and region are used.
   *
   * @default - use CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION
   */
  env?: Environment;

  /**
   * Custom domain settings for Langfuse Application.
   *
   * @default - Use HTTP if not specified.
   */
  domainConfig?: DomainConfig;
}

export interface DomainConfig {
  /**
   * The hostname for the Langfuse Application (e.g., 'app' for 'app.example.com').
   */
  hostName: string;

  /**
   * The Route 53 domain name for the Langfuse Application (e.g., 'example.com').
   * This is used to construct the full domain (e.g., 'app.example.com').
   */
  domainName: string;
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
    domainConfig: {
      hostName: 'langfuse',
      domainName: 'example.com',
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

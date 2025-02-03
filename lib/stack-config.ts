export interface StackConfig {
  /**
   * List of allowed IPv4 CIDR blocks for accessing the Langfuse Application.
   *
   * @default - '0.0.0.0/0'
   */
  allowedIPv4Cidrs?: string[];

  /**
   * List of allowed IPv6 CIDR blocks for accessing the Langfuse Application.
   *
   * @default - '::/0'
   */
  allowedIPv6Cidrs?: string[];

  /**
   * The Docker image tag for the Langfuse application.
   *
   * @default 'latest'
   */
  langfuseImageTag?: string;

  /**
   * The Docker image tag for the ClickHouse database.
   *
   * @default 'latest'
   */
  clickhouseImageTag?: string;

  /**
   * The logging level for the Langfuse application.
   *
   * @default LOG_LEVEL.INFO
   */
  langfuseLogLevel?: LOG_LEVEL;

  /**
   * Whether to create a Bastion Host for secure access to the infrastructure.
   *
   * @default - Not created
   */
  createBastion?: boolean;

  /**
   * Whether Aurora Serverless scales to zero when idle to reduce costs.
   *
   * @default - Scaling to zero is disabled
   * @see https://aws.amazon.com/jp/blogs/database/introducing-scaling-to-0-capacity-with-amazon-aurora-serverless-v2/
   */
  auroraScalesToZero?: boolean;

  /**
   * Whether the ElastiCache Cluset is deployed in a Multi-AZ configuration for high availability.
   *
   * @default - Single-AZ if not specified.
   */
  cacheMultiAz?: boolean;
}

export enum LOG_LEVEL {
  TRACE = 'trace',
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATL = 'fatal',
}

const stackConfigMap: Record<string, StackConfig> = {
  dev: {
    createBastion: true,
    langfuseLogLevel: LOG_LEVEL.DEBUG,
    auroraScalesToZero: true,
    cacheMultiAz: false,
  },
  stg: {
    createBastion: true,
    auroraScalesToZero: true,
    cacheMultiAz: false,
  },
  prod: {
    createBastion: true,
    langfuseLogLevel: LOG_LEVEL.INFO,
    langfuseImageTag: 'latest',
    auroraScalesToZero: false,
    cacheMultiAz: false,
  },
};

export function getStackConfig(envName: string): StackConfig {
  const config = stackConfigMap[envName];
  if (!config) {
    throw new Error(`StackConfig does not exist. envName:${envName}`);
  }
  return config;
}

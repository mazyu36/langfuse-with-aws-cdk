export interface StackConfig {
  /**
   * Whether to use a t4g.nano NAT instance instead of NAT Gateway.
   *
   * @default - Not use a NAT Instance (use a NAT Gateway)
   */
  useNatIncetance?: boolean;

  /**
   * Whether to use Fargate Spot for Langfuse web/server and ClickHouse.
   *
   * @default - Not use Fargate Spot
   */
  enableFargateSpot?: boolean;

  /**
   * The vCPU of Fargate Task Definition for Langfuse web/server and ClickHouse.
   *
   * Langfuse recommend that you should have at least 2 CPUs for production environments.
   *
   * @default 1024
   * @see https://langfuse.com/self-hosting/infrastructure/containers#recommended-sizing
   */
  taskDefCpu?: number;

  /**
   * The amount (in MiN) of Memory of Fargate Task Definition for Langfuse web/server and ClickHouse.
   *
   * Langfuse recommend that you should have at 4 GB of RAM for production environments.
   *
   * @default 2048
   * @see https://langfuse.com/self-hosting/infrastructure/containers#recommended-sizing
   */
  taskDefMemoryLimitMiB?: number;

  /**
   * The number of task for Langfuse Web.
   *
   * Langfuse recommend that you should have at least two containers for production environments.
   *
   * @default undefined - ECS default setting is 1
   * @see https://langfuse.com/self-hosting/infrastructure/containers#recommended-sizing
   */
  langfuseWebTaskCount?: number;

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
   * @see https://aws.amazon.com/blogs/database/introducing-scaling-to-0-capacity-with-amazon-aurora-serverless-v2/
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
    useNatIncetance: true,
    enableFargateSpot: true,
    createBastion: true,
    langfuseLogLevel: LOG_LEVEL.DEBUG,
    langfuseImageTag: '3.65.1',
    auroraScalesToZero: true,
    cacheMultiAz: false,
  },
  stg: {
    createBastion: true,
    auroraScalesToZero: true,
    cacheMultiAz: false,
  },
  prod: {
    taskDefCpu: 2048,
    taskDefMemoryLimitMiB: 4096,
    langfuseWebTaskCount: 2,
    createBastion: true,
    langfuseLogLevel: LOG_LEVEL.INFO,
    langfuseImageTag: '3.65.1',
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

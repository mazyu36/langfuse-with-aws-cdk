# Langfuse v3 with AWS CDK

This project helps you build and deploy [Langfuse v3](https://langfuse.com/changelog/2024-12-09-Langfuse-v3-stable-release) using AWS CDK.

## Architecture

![Architecture](./img/architecture.drawio.svg)

* Deploys Langfuse Web/Worker Services and ClickHouse using ECS on Fargate
  * Enables service-to-service communication through ECS Service Connect
  * Utilizes EFS for ClickHouse storage
* Implements Aurora Serverless V2 for the relational database
* Uses ElastiCache Valkey for caching and queue management
* Employs S3 for blob storage

## Set Up Your Environment

Ensure you have Node.js, npm, and the AWS CDK CLI installed.

## Usage

### 1. **Set Configuration Properties**
Modify the following configuration files:
   * [`/bin/app-config.ts`](/bin/app-config.ts): AWS infrastructure configurations (e.g., AWS Account ID, Region)
   * [`/lib/stack-config.ts`](/lib/stack-config.ts): AWS infrastructure and Langfuse service configurations

### 2. **Deploy**
Run the following commands to deploy your stack:

```sh
npm ci
npx cdk deploy --context env=dev
```

Deployment takes approximately 20 minutes.
Upon completion, you'll receive the Langfuse App URL in the output:

```sh
Outputs:
# omit

LangfuseWithAwsCdkStack-prod.LangfuseURL = https://langfuse.example.com

# omit
✨  Total time: 1040.53s
```

You can now start using your Langfuse application!

### 3. **Clean Up**
If you no longer need the resources, destroy the stack with:

```sh
npx cdk destroy --context env=dev
```
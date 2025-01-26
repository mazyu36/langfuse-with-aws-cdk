import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as LangfuseWithAwsCdk from '../lib/langfuse-with-aws-cdk-stack';

test('snapshot test', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new LangfuseWithAwsCdk.LangfuseWithAwsCdkStack(app, 'MyTestStack', {
    env: {
      account: '123456789012',
      region: 'us-east-1',
    },
    envName: 'for-snapshot-test',
  });
  // THEN
  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});

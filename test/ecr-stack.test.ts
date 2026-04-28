import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BgTestEcrStack } from '../lib/ecr-stack';

function synthEcr() {
  const app = new cdk.App();
  const stack = new BgTestEcrStack(app, 'Ecr', {
    env: { account: '123456789012', region: 'ap-northeast-2' },
  });
  return Template.fromStack(stack);
}

describe('BgTestEcrStack', () => {
  it('creates ECR repo named bg-app with image scan on push', () => {
    const t = synthEcr();
    t.hasResourceProperties('AWS::ECR::Repository', {
      RepositoryName: 'bg-app',
      ImageScanningConfiguration: { ScanOnPush: true },
    });
  });

  it('configures lifecycle policy to keep last 10 images', () => {
    const t = synthEcr();
    t.hasResourceProperties('AWS::ECR::Repository', {
      LifecyclePolicy: {
        LifecyclePolicyText: Match.stringLikeRegexp('"countNumber":10'),
      },
    });
  });

  it('applies common tags (Project=bg-test) to the repository', () => {
    const t = synthEcr();
    t.hasResourceProperties('AWS::ECR::Repository', {
      Tags: Match.arrayWith([
        { Key: 'Name', Value: 'bg-ecr' },
        { Key: 'Project', Value: 'bg-test' },
      ]),
    });
  });
});

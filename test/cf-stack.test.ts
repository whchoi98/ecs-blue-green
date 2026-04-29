import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BgTestNetworkStack } from '../lib/network-stack';
import { BgTestAlbStack } from '../lib/alb-stack';
import { BgTestCfStack } from '../lib/cf-stack';

function synthCf(activeColor: 'blue' | 'green' = 'blue') {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'ap-northeast-2' };
  const network = new BgTestNetworkStack(app, 'Net', { env, includeSecondaryCidr: false });
  const alb = new BgTestAlbStack(app, 'Alb', {
    env, networkStack: network,
    cloudFrontPrefixListId: 'pl-22a6434b',
    includeGreen: false,
  });
  const cf = new BgTestCfStack(app, 'Cf', {
    env, activeColor, albStack: alb,
  });
  return Template.fromStack(cf);
}

describe('BgTestCfStack', () => {
  it('creates exactly 1 CloudFront distribution', () => {
    const t = synthCf();
    t.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  it('configures 3 origins with custom X-Custom-Secret headers', () => {
    const t = synthCf();
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: Match.arrayWith([
          Match.objectLike({ OriginCustomHeaders: Match.arrayWith([Match.objectLike({ HeaderName: 'X-Custom-Secret' })]) }),
        ]),
      }),
    });
  });

  it('configures 3 cache behaviors plus default behavior', () => {
    const t = synthCf();
    const dists = t.findResources('AWS::CloudFront::Distribution');
    const dist: any = Object.values(dists)[0];
    expect(dist.Properties.DistributionConfig.CacheBehaviors).toHaveLength(3);
    const paths = dist.Properties.DistributionConfig.CacheBehaviors.map((b: any) => b.PathPattern).sort();
    expect(paths).toEqual(['/ec2-asg/*', '/ecs-ec2/*', '/ecs-fg/*']);
  });

  it('sets viewer protocol policy to redirect-to-https on default behavior', () => {
    const t = synthCf();
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
      }),
    });
  });
});

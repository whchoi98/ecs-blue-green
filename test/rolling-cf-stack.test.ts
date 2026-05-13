import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BgTestNetworkStack } from '../lib/network-stack';
import { BgTestDataStack } from '../lib/data-stack';
import { BgTestEcrStack } from '../lib/ecr-stack';
import { BgTestRollingStack } from '../lib/rolling-stack';
import { BgTestRollingCfStack } from '../lib/rolling-cf-stack';

function synthRollingCf() {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'ap-northeast-2' };
  const network = new BgTestNetworkStack(app, 'Net', { env, includeSecondaryCidr: true });
  const data = new BgTestDataStack(app, 'Data', { env, networkStack: network });
  const ecr = new BgTestEcrStack(app, 'Ecr', { env });
  const rolling = new BgTestRollingStack(app, 'Rolling', {
    env, networkStack: network, dataStack: data, ecrStack: ecr,
    cloudFrontPrefixListId: 'pl-22a6434b',
    launchVersion: 'v1', targetSubnet: 'private1',
  });
  const cf = new BgTestRollingCfStack(app, 'RollingCf', { env, rollingStack: rolling });
  return Template.fromStack(cf);
}

describe('BgTestRollingCfStack', () => {
  it('creates 1 CloudFront distribution', () => {
    const t = synthRollingCf();
    t.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  it('viewer protocol redirect-to-https, origin http-only', () => {
    const t = synthRollingCf();
    const dists = t.findResources('AWS::CloudFront::Distribution');
    const dist = Object.values(dists)[0] as any;
    const cfg = dist.Properties.DistributionConfig;
    expect(cfg.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https');
    expect(cfg.Origins[0].CustomOriginConfig.OriginProtocolPolicy).toBe('http-only');
  });

  it('origin custom header X-Custom-Secret is set', () => {
    const t = synthRollingCf();
    const dists = t.findResources('AWS::CloudFront::Distribution');
    const dist = Object.values(dists)[0] as any;
    const headers = dist.Properties.DistributionConfig.Origins[0].OriginCustomHeaders;
    expect(headers).toHaveLength(1);
    expect(headers[0].HeaderName).toBe('X-Custom-Secret');
  });
});

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BgTestNetworkStack } from '../lib/network-stack';
import { BgTestDataStack } from '../lib/data-stack';
import { BgTestEcrStack } from '../lib/ecr-stack';
import { BgTestRollingStack } from '../lib/rolling-stack';

function synthRolling(opts: {
  launchVersion?: 'v1' | 'v2';
  targetSubnet?: 'private1' | 'private2';
} = {}) {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'ap-northeast-2' };
  const network = new BgTestNetworkStack(app, 'Net', { env, includeSecondaryCidr: true });
  const data = new BgTestDataStack(app, 'Data', { env, networkStack: network });
  const ecr = new BgTestEcrStack(app, 'Ecr', { env });
  const rolling = new BgTestRollingStack(app, 'Rolling', {
    env,
    networkStack: network,
    dataStack: data,
    ecrStack: ecr,
    cloudFrontPrefixListId: 'pl-22a6434b',
    launchVersion: opts.launchVersion ?? 'v1',
    targetSubnet: opts.targetSubnet ?? 'private1',
  });
  return Template.fromStack(rolling);
}

describe('BgTestRollingStack', () => {
  test('stack synthesizes without error', () => {
    expect(() => synthRolling()).not.toThrow();
  });
});

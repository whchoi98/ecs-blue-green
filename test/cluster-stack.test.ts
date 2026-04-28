import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BgTestNetworkStack } from '../lib/network-stack';
import { BgTestClusterStack } from '../lib/cluster-stack';

function synthCluster() {
  const app = new cdk.App();
  const network = new BgTestNetworkStack(app, 'Net', {
    env: { account: '123456789012', region: 'ap-northeast-2' },
    includeSecondaryCidr: false,
  });
  const cluster = new BgTestClusterStack(app, 'Cluster', {
    env: { account: '123456789012', region: 'ap-northeast-2' },
    networkStack: network,
  });
  return Template.fromStack(cluster);
}

describe('BgTestClusterStack', () => {
  it('creates ECS cluster named test-cluster with Container Insights', () => {
    const t = synthCluster();
    t.hasResourceProperties('AWS::ECS::Cluster', {
      ClusterName: 'test-cluster',
      ClusterSettings: [{ Name: 'containerInsights', Value: 'enabled' }],
    });
  });
});

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BgTestNetworkStack } from '../lib/network-stack';
import { BgTestDataStack } from '../lib/data-stack';
import { BgTestEcrStack } from '../lib/ecr-stack';
import { BgTestClusterStack } from '../lib/cluster-stack';
import { BgTestAlbStack } from '../lib/alb-stack';
import { BgTestComputeStack } from '../lib/compute-stack';

function synthCompute(opts: { color: 'blue' | 'green'; subnetGroup: 'private1' | 'private2'; includeGreen?: boolean }) {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'ap-northeast-2' };
  const network = new BgTestNetworkStack(app, 'Net', { env, includeSecondaryCidr: opts.subnetGroup === 'private2' });
  const data = new BgTestDataStack(app, 'Data', { env, networkStack: network });
  const ecr = new BgTestEcrStack(app, 'Ecr', { env });
  const cluster = new BgTestClusterStack(app, 'Cluster', { env, networkStack: network });
  const alb = new BgTestAlbStack(app, 'Alb', {
    env, networkStack: network,
    cloudFrontPrefixListId: 'pl-22a6434b',
    includeGreen: opts.includeGreen ?? (opts.color === 'green'),
  });
  const compute = new BgTestComputeStack(app, `Compute${opts.color}`, {
    env, color: opts.color, computeSubnetGroup: opts.subnetGroup,
    networkStack: network, dataStack: data, ecrStack: ecr, clusterStack: cluster, albStack: alb,
  });
  return Template.fromStack(compute);
}

describe('BgTestComputeStack', () => {
  it('does NOT create ALBs (ALB ownership is in BgTestAlbStack)', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
  });

  it('creates EC2 ASG with desired=4, min=4, max=8, t4g.xlarge', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
      DesiredCapacity: '4', MinSize: '4', MaxSize: '8',
    });
    t.hasResourceProperties('AWS::EC2::LaunchTemplate', Match.objectLike({
      LaunchTemplateData: Match.objectLike({ InstanceType: 't4g.xlarge' }),
    }));
  });

  it('creates 2 ASGs (EC2 ASG + ECS host ASG)', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.resourceCountIs('AWS::AutoScaling::AutoScalingGroup', 2);
  });

  it('creates 2 ECS services (ecs-ec2 + fargate)', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.resourceCountIs('AWS::ECS::Service', 2);
  });

  it('ECS-EC2 service uses placement constraint to filter color hosts', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.hasResourceProperties('AWS::ECS::Service', Match.objectLike({
      PlacementConstraints: Match.arrayWith([
        Match.objectLike({ Type: 'memberOf', Expression: Match.stringLikeRegexp('attribute:color == blue') }),
      ]),
    }));
  });

  it('Fargate task definition uses ARM64 runtime platform', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.hasResourceProperties('AWS::ECS::TaskDefinition', {
      RequiresCompatibilities: ['FARGATE'],
      RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' },
    });
  });

  it('EC2 task definition uses bridge networking', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.hasResourceProperties('AWS::ECS::TaskDefinition', {
      RequiresCompatibilities: Match.arrayWith(['EC2']),
      NetworkMode: 'bridge',
    });
  });

  it('does NOT create cluster capacity provider associations (no CP strategy used)', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.resourceCountIs('AWS::ECS::ClusterCapacityProviderAssociations', 0);
  });
});

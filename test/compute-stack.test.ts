import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BgTestNetworkStack } from '../lib/network-stack';
import { BgTestDataStack } from '../lib/data-stack';
import { BgTestEcrStack } from '../lib/ecr-stack';
import { BgTestClusterStack } from '../lib/cluster-stack';
import { BgTestComputeStack } from '../lib/compute-stack';

function synthCompute(opts: { color: 'blue' | 'green'; subnetGroup: 'private1' | 'private2' }) {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'ap-northeast-2' };
  const network = new BgTestNetworkStack(app, 'Net', { env, includeSecondaryCidr: opts.subnetGroup === 'private2' });
  const data = new BgTestDataStack(app, 'Data', { env, networkStack: network });
  const ecr = new BgTestEcrStack(app, 'Ecr', { env });
  const cluster = new BgTestClusterStack(app, 'Cluster', { env, networkStack: network });
  const compute = new BgTestComputeStack(app, `Compute${opts.color}`, {
    env, color: opts.color, computeSubnetGroup: opts.subnetGroup,
    networkStack: network, dataStack: data, ecrStack: ecr, clusterStack: cluster,
    cloudFrontPrefixListId: 'pl-22a6434b',
  });
  return Template.fromStack(compute);
}

describe('BgTestComputeStack (Blue, private-1)', () => {
  it('creates 3 ALBs (ec2asg, ecsec2, ecsfg) all internet-facing', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 3);
    const albs = t.findResources('AWS::ElasticLoadBalancingV2::LoadBalancer');
    Object.values(albs).forEach((alb: any) => {
      expect(alb.Properties.Scheme).toBe('internet-facing');
    });
  });

  it('creates 3 listeners with default 403 fixed-response', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 3);
    const listeners = t.findResources('AWS::ElasticLoadBalancingV2::Listener');
    Object.values(listeners).forEach((l: any) => {
      const def = l.Properties.DefaultActions[0];
      expect(def.Type).toBe('fixed-response');
      expect(def.FixedResponseConfig.StatusCode).toBe('403');
    });
  });

  it('creates 3 listener rules with X-Custom-Secret header condition', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 3);
    const rules = t.findResources('AWS::ElasticLoadBalancingV2::ListenerRule');
    Object.values(rules).forEach((r: any) => {
      const cond = r.Properties.Conditions[0];
      expect(cond.Field).toBe('http-header');
      expect(cond.HttpHeaderConfig.HttpHeaderName).toBe('X-Custom-Secret');
    });
  });

  it('creates 3 target groups (ec2asg=instance:80, ecsec2=instance, ecsfg=ip:3000)', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 3);
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      TargetType: 'ip', Port: 3000,
    });
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      TargetType: 'instance', Port: 80,
    });
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

  it('creates 2 ECS services (ecs-ec2 + fargate)', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.resourceCountIs('AWS::ECS::Service', 2);
  });

  it('creates Fargate task definition with ARM64 runtime', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.hasResourceProperties('AWS::ECS::TaskDefinition', {
      RequiresCompatibilities: ['FARGATE'],
      RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' },
    });
  });

  it('creates EC2-launch-type task definition with bridge network mode', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.hasResourceProperties('AWS::ECS::TaskDefinition', {
      RequiresCompatibilities: Match.arrayWith(['EC2']),
      NetworkMode: 'bridge',
    });
  });
});

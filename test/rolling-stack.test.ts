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
  it('stack synthesizes without error', () => {
    expect(() => synthRolling()).not.toThrow();
  });

  it('creates exactly 1 ALB (internet-facing)', () => {
    const t = synthRolling();
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
      Name: 'bg-rolling-alb',
    });
  });

  it('creates exactly 1 TG (instance type, port 80, /health check)', () => {
    const t = synthRolling();
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 1);
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      Name: 'bg-rolling-tg',
      TargetType: 'instance',
      Port: 80,
      HealthCheckPath: '/health',
    });
  });

  it('creates listener with default 403 fixed-response', () => {
    const t = synthRolling();
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 1);
    const listeners = t.findResources('AWS::ElasticLoadBalancingV2::Listener');
    const def = Object.values(listeners)[0] as any;
    expect(def.Properties.DefaultActions[0].Type).toBe('fixed-response');
    expect(def.Properties.DefaultActions[0].FixedResponseConfig.StatusCode).toBe('403');
  });

  it('creates priority-1 ListenerRule with X-Custom-Secret header and single forward', () => {
    const t = synthRolling();
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 1);
    const rules = t.findResources('AWS::ElasticLoadBalancingV2::ListenerRule');
    const r = Object.values(rules)[0] as any;
    expect(r.Properties.Priority).toBe(1);
    expect(r.Properties.Conditions[0].Field).toBe('http-header');
    expect(r.Properties.Conditions[0].HttpHeaderConfig.HttpHeaderName).toBe('X-Custom-Secret');
    expect(r.Properties.Actions[0].Type).toBe('forward');
    const tgs = r.Properties.Actions[0].ForwardConfig.TargetGroups;
    expect(tgs).toHaveLength(1);
  });

  it('ALB SG has CfnSecurityGroupIngress from CloudFront prefix list only', () => {
    const t = synthRolling();
    const ingresses = t.findResources('AWS::EC2::SecurityGroupIngress', {
      Properties: { SourcePrefixListId: 'pl-22a6434b', FromPort: 80, ToPort: 80 },
    });
    expect(Object.keys(ingresses).length).toBe(1);
  });

  it('creates 1 LaunchTemplate with bg-rolling-lt name', () => {
    const t = synthRolling({ launchVersion: 'v1' });
    t.resourceCountIs('AWS::EC2::LaunchTemplate', 1);
    t.hasResourceProperties('AWS::EC2::LaunchTemplate', {
      LaunchTemplateName: 'bg-rolling-lt',
    });
  });

  it('LaunchTemplate v1 user-data references COLOR=blue and VERSION=v1', () => {
    const t = synthRolling({ launchVersion: 'v1' });
    const lts = t.findResources('AWS::EC2::LaunchTemplate');
    const lt = Object.values(lts)[0] as any;
    const ud = JSON.stringify(lt.Properties.LaunchTemplateData.UserData);
    expect(ud).toMatch(/COLOR=blue/);
    expect(ud).toMatch(/VERSION=v1/);
  });

  it('LaunchTemplate v2 user-data references COLOR=green and VERSION=v2', () => {
    const t = synthRolling({ launchVersion: 'v2' });
    const lts = t.findResources('AWS::EC2::LaunchTemplate');
    const lt = Object.values(lts)[0] as any;
    const ud = JSON.stringify(lt.Properties.LaunchTemplateData.UserData);
    expect(ud).toMatch(/COLOR=green/);
    expect(ud).toMatch(/VERSION=v2/);
  });

  it('creates 1 ASG named bg-rolling-ec2asg with desired=4', () => {
    const t = synthRolling();
    t.resourceCountIs('AWS::AutoScaling::AutoScalingGroup', 1);
    t.hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
      AutoScalingGroupName: 'bg-rolling-ec2asg',
      DesiredCapacity: '4',
      MinSize: '4',
      MaxSize: '8',
    });
  });

  it('instance SG ingress references ALB SG (SG-to-SG, not CIDR)', () => {
    const t = synthRolling();
    // CDK places addIngressRule inline inside AWS::EC2::SecurityGroup, not as a separate
    // AWS::EC2::SecurityGroupIngress resource, so we inspect the SG directly.
    const sgs = t.findResources('AWS::EC2::SecurityGroup');
    const instanceSg = Object.values(sgs).find((sg: any) =>
      sg.Properties.GroupName === 'bg-rolling-instance-sg'
    ) as any;
    expect(instanceSg).toBeDefined();
    const ingressRules: any[] = instanceSg.Properties.SecurityGroupIngress ?? [];
    const sgToSg = ingressRules.filter((r: any) =>
      r.FromPort === 80 && r.ToPort === 80 && r.IpProtocol === 'tcp' &&
      r.SourceSecurityGroupId !== undefined
    );
    expect(sgToSg.length).toBeGreaterThanOrEqual(1);
  });

  it('attaches a Warm Pool with PoolState=Stopped, MaxPrepared=4, MinSize=4', () => {
    const t = synthRolling();
    t.resourceCountIs('AWS::AutoScaling::WarmPool', 1);
    t.hasResourceProperties('AWS::AutoScaling::WarmPool', {
      PoolState: 'Stopped',
      MaxGroupPreparedCapacity: 4,
      MinSize: 4,
    });
  });

  it('throws when targetSubnet=private2 but no private2 subnets exist', () => {
    expect(() => {
      const app = new cdk.App();
      const env = { account: '123456789012', region: 'ap-northeast-2' };
      const network = new BgTestNetworkStack(app, 'Net', { env, includeSecondaryCidr: false });
      const data = new BgTestDataStack(app, 'Data', { env, networkStack: network });
      const ecr = new BgTestEcrStack(app, 'Ecr', { env });
      new BgTestRollingStack(app, 'Rolling', {
        env, networkStack: network, dataStack: data, ecrStack: ecr,
        cloudFrontPrefixListId: 'pl-22a6434b',
        launchVersion: 'v2', targetSubnet: 'private2',
      });
    }).toThrow(/No subnets/i);
  });

  it('exports CfnOutput RollingAlbDns and RollingSecret', () => {
    const t = synthRolling();
    t.hasOutput('RollingAlbDns', { Export: { Name: 'BgRollingAlb-Dns' } });
    t.hasOutput('RollingSecret', { Export: { Name: 'BgRollingAlb-Secret' } });
  });
});

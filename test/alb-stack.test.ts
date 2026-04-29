import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BgTestNetworkStack } from '../lib/network-stack';
import { BgTestAlbStack } from '../lib/alb-stack';

function synthAlb(opts: { includeGreen: boolean }) {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'ap-northeast-2' };
  const network = new BgTestNetworkStack(app, 'Net', { env, includeSecondaryCidr: opts.includeGreen });
  const alb = new BgTestAlbStack(app, 'Alb', {
    env, networkStack: network,
    cloudFrontPrefixListId: 'pl-22a6434b',
    includeGreen: opts.includeGreen,
  });
  return Template.fromStack(alb);
}

describe('BgTestAlbStack', () => {
  it('creates 3 ALBs (ec2asg, ecsec2, ecsfg) all internet-facing', () => {
    const t = synthAlb({ includeGreen: false });
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 3);
    const albs = t.findResources('AWS::ElasticLoadBalancingV2::LoadBalancer');
    Object.values(albs).forEach((alb: any) => {
      expect(alb.Properties.Scheme).toBe('internet-facing');
    });
  });

  it('creates 3 listeners with default 403 fixed-response', () => {
    const t = synthAlb({ includeGreen: false });
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 3);
    const listeners = t.findResources('AWS::ElasticLoadBalancingV2::Listener');
    Object.values(listeners).forEach((l: any) => {
      const def = l.Properties.DefaultActions[0];
      expect(def.Type).toBe('fixed-response');
      expect(def.FixedResponseConfig.StatusCode).toBe('403');
    });
  });

  it('creates 3 Blue TGs only when includeGreen=false', () => {
    const t = synthAlb({ includeGreen: false });
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 3);
  });

  it('creates 6 TGs (3 Blue + 3 Green) when includeGreen=true', () => {
    const t = synthAlb({ includeGreen: true });
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 6);
  });

  it('creates 3 listener rules (L1 CfnListenerRule) with X-Custom-Secret header condition', () => {
    const t = synthAlb({ includeGreen: false });
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 3);
    const rules = t.findResources('AWS::ElasticLoadBalancingV2::ListenerRule');
    Object.values(rules).forEach((r: any) => {
      const cond = r.Properties.Conditions[0];
      expect(cond.Field).toBe('http-header');
      expect(cond.HttpHeaderConfig.HttpHeaderName).toBe('X-Custom-Secret');
    });
  });

  it('listener rule uses weighted forward to Blue and Green TGs when includeGreen=true', () => {
    const t = synthAlb({ includeGreen: true });
    const rules = t.findResources('AWS::ElasticLoadBalancingV2::ListenerRule');
    Object.values(rules).forEach((r: any) => {
      const action = r.Properties.Actions[0];
      expect(action.Type).toBe('forward');
      const tgs = action.ForwardConfig.TargetGroups;
      expect(tgs).toHaveLength(2);
      expect(tgs[0].Weight).toBe(100);
      expect(tgs[1].Weight).toBe(0);
    });
  });

  it('TG target type is INSTANCE for ec2asg/ecsec2 and IP for ecsfg', () => {
    const t = synthAlb({ includeGreen: false });
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', { TargetType: 'ip', Port: 3000 });
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', { TargetType: 'instance', Port: 80 });
  });
});

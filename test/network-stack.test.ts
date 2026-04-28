import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BgTestNetworkStack } from '../lib/network-stack';

function synth(props: { includeSecondaryCidr?: boolean } = {}) {
  const app = new cdk.App();
  const stack = new BgTestNetworkStack(app, 'TestNetwork', {
    env: { account: '123456789012', region: 'ap-northeast-2' },
    includeSecondaryCidr: props.includeSecondaryCidr ?? false,
  });
  return Template.fromStack(stack);
}

describe('BgTestNetworkStack', () => {
  it('creates VPC with 10.1.0.0/16 and Name tag test-vpc', () => {
    const t = synth();
    t.hasResourceProperties('AWS::EC2::VPC', {
      CidrBlock: '10.1.0.0/16',
      Tags: Match.arrayWith([{ Key: 'Name', Value: 'test-vpc' }]),
    });
  });
});

describe('BgTestNetworkStack subnets', () => {
  it('creates 8 subnets when secondary CIDR disabled (4 types × 2 AZ)', () => {
    const t = synth();
    t.resourceCountIs('AWS::EC2::Subnet', 8);
  });

  it('creates 2 NAT gateways (one per AZ) for HA', () => {
    const t = synth();
    t.resourceCountIs('AWS::EC2::NatGateway', 2);
  });

  it('adds secondary CIDR association when includeSecondaryCidr=true', () => {
    const t = synth({ includeSecondaryCidr: true });
    t.hasResourceProperties('AWS::EC2::VPCCidrBlock', { CidrBlock: '10.2.0.0/16' });
  });

  it('creates 10 subnets when secondary CIDR enabled (8 + private2 ×2)', () => {
    const t = synth({ includeSecondaryCidr: true });
    t.resourceCountIs('AWS::EC2::Subnet', 10);
  });

  it('private2-a uses 10.2.0.0/22 and private2-b uses 10.2.4.0/22', () => {
    const t = synth({ includeSecondaryCidr: true });
    t.hasResourceProperties('AWS::EC2::Subnet', { CidrBlock: '10.2.0.0/22' });
    t.hasResourceProperties('AWS::EC2::Subnet', { CidrBlock: '10.2.4.0/22' });
  });
});

describe('BgTestNetworkStack VPC endpoints', () => {
  it('creates S3 gateway endpoint', () => {
    const t = synth();
    // ServiceName is an Fn::Join token in CDK >= 2.x, so match on VpcEndpointType + the join suffix
    t.hasResourceProperties('AWS::EC2::VPCEndpoint', {
      VpcEndpointType: 'Gateway',
      ServiceName: Match.objectLike({
        'Fn::Join': Match.arrayWith([Match.arrayWith([Match.stringLikeRegexp('s3')])]),
      }),
    });
  });

  it('creates 7 interface endpoints (ECR×2, CW Logs, Secrets, SSM×3)', () => {
    const t = synth();
    const interfaceCount = t.findResources('AWS::EC2::VPCEndpoint', { Properties: { VpcEndpointType: 'Interface' } });
    expect(Object.keys(interfaceCount).length).toBe(7);
  });
});

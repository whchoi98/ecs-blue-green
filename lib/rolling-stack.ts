import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { BgTestNetworkStack } from './network-stack';
import { BgTestDataStack } from './data-stack';
import { BgTestEcrStack } from './ecr-stack';

export interface BgTestRollingStackProps extends cdk.StackProps {
  networkStack: BgTestNetworkStack;
  dataStack: BgTestDataStack;
  ecrStack: BgTestEcrStack;
  cloudFrontPrefixListId: string;
  launchVersion: 'v1' | 'v2';
  targetSubnet: 'private1' | 'private2';
}

export class BgTestRollingStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly tg: elbv2.ApplicationTargetGroup;
  public readonly secret: string;
  public readonly albSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: BgTestRollingStackProps) {
    super(scope, id, props);
    const vpc = props.networkStack.vpc;

    const albSg = new ec2.SecurityGroup(this, 'RollingAlbSg', {
      vpc, allowAllOutbound: true,
      securityGroupName: 'bg-rolling-alb-sg',
      description: 'Rolling ALB SG',
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, 'RollingAlb', {
      vpc, internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: 'bg-rolling-alb',
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const tg = new elbv2.ApplicationTargetGroup(this, 'RollingTg', {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      targetGroupName: 'bg-rolling-tg',
      healthCheck: {
        path: '/health',
        port: 'traffic-port',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
      },
    });

    const listener = alb.addListener('RollingListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Access Denied',
      }),
    });

    const secret = `bg-rolling-${this.account}-${cdk.Names.uniqueId(this).slice(-6)}`;
    new elbv2.CfnListenerRule(this, 'RollingForwardRule', {
      listenerArn: listener.listenerArn,
      priority: 1,
      conditions: [{
        field: 'http-header',
        httpHeaderConfig: { httpHeaderName: 'X-Custom-Secret', values: [secret] },
      }],
      actions: [{
        type: 'forward',
        forwardConfig: { targetGroups: [{ targetGroupArn: tg.targetGroupArn, weight: 1 }] },
      }],
    });

    this.alb = alb;
    this.tg = tg;
    this.secret = secret;
    this.albSg = albSg;
  }
}

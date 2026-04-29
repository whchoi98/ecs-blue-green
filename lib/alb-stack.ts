import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { LAB_CONFIG, commonTags } from './config';
import { BgTestNetworkStack } from './network-stack';

/**
 * Centralized ALB + TargetGroup + Listener Rule stack.
 *
 * Owns BOTH Blue and Green target groups + the weighted listener rules so that:
 *   - ECS services in BlueStack/GreenStack can attach to TGs that are already
 *     associated with an ALB (no "TG not associated with LB" error).
 *   - Cross-stack dependency is unidirectional: Compute stacks depend on AlbStack
 *     (TG ARN import), not the other way around. No cycles.
 *
 * Listener rule uses `weightedForward` so traffic shift is done via:
 *   aws elbv2 modify-rule --actions ... (1-2 second propagation).
 *
 * Initial weights when includeGreen=true: Blue=100, Green=0 (full Blue, Green warm).
 */
export interface BgTestAlbStackProps extends cdk.StackProps {
  networkStack: BgTestNetworkStack;
  cloudFrontPrefixListId: string;
  /** Whether to pre-create Green TGs and use weighted listener rule */
  includeGreen: boolean;
}

interface WorkloadAlbBundle {
  alb: elbv2.ApplicationLoadBalancer;
  listener: elbv2.ApplicationListener;
  blueTg: elbv2.ApplicationTargetGroup;
  greenTg?: elbv2.ApplicationTargetGroup;
  secret: string;
}

export class BgTestAlbStack extends cdk.Stack {
  public readonly ec2AsgAlb: elbv2.ApplicationLoadBalancer;
  public readonly ecsEc2Alb: elbv2.ApplicationLoadBalancer;
  public readonly ecsFgAlb: elbv2.ApplicationLoadBalancer;

  public readonly ec2AsgSecret: string;
  public readonly ecsEc2Secret: string;
  public readonly ecsFgSecret: string;

  public readonly blueEc2AsgTg: elbv2.ApplicationTargetGroup;
  public readonly blueEcsEc2Tg: elbv2.ApplicationTargetGroup;
  public readonly blueEcsFgTg: elbv2.ApplicationTargetGroup;

  // Optional — only when includeGreen=true
  public readonly greenEc2AsgTg?: elbv2.ApplicationTargetGroup;
  public readonly greenEcsEc2Tg?: elbv2.ApplicationTargetGroup;
  public readonly greenEcsFgTg?: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: BgTestAlbStackProps) {
    super(scope, id, props);
    const vpc = props.networkStack.vpc;
    const tags = commonTags();

    const ec2asgBundle = this.makeWorkloadAlb('ec2asg', { vpc, prefixListId: props.cloudFrontPrefixListId, tgPort: 80, tgType: elbv2.TargetType.INSTANCE, includeGreen: props.includeGreen });
    const ecsec2Bundle = this.makeWorkloadAlb('ecsec2', { vpc, prefixListId: props.cloudFrontPrefixListId, tgPort: 80, tgType: elbv2.TargetType.INSTANCE, includeGreen: props.includeGreen });
    const ecsfgBundle  = this.makeWorkloadAlb('ecsfg',  { vpc, prefixListId: props.cloudFrontPrefixListId, tgPort: LAB_CONFIG.compute.appPort, tgType: elbv2.TargetType.IP, includeGreen: props.includeGreen });

    this.ec2AsgAlb = ec2asgBundle.alb;
    this.ecsEc2Alb = ecsec2Bundle.alb;
    this.ecsFgAlb  = ecsfgBundle.alb;
    this.ec2AsgSecret = ec2asgBundle.secret;
    this.ecsEc2Secret = ecsec2Bundle.secret;
    this.ecsFgSecret  = ecsfgBundle.secret;

    this.blueEc2AsgTg = ec2asgBundle.blueTg;
    this.blueEcsEc2Tg = ecsec2Bundle.blueTg;
    this.blueEcsFgTg  = ecsfgBundle.blueTg;
    this.greenEc2AsgTg = ec2asgBundle.greenTg;
    this.greenEcsEc2Tg = ecsec2Bundle.greenTg;
    this.greenEcsFgTg  = ecsfgBundle.greenTg;

    Object.entries(tags).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    new cdk.CfnOutput(this, 'Ec2AsgAlbDns', { value: this.ec2AsgAlb.loadBalancerDnsName, exportName: 'BgTestAlb-Ec2AsgDns' });
    new cdk.CfnOutput(this, 'EcsEc2AlbDns', { value: this.ecsEc2Alb.loadBalancerDnsName, exportName: 'BgTestAlb-EcsEc2Dns' });
    new cdk.CfnOutput(this, 'EcsFgAlbDns',  { value: this.ecsFgAlb.loadBalancerDnsName,  exportName: 'BgTestAlb-EcsFgDns' });
    new cdk.CfnOutput(this, 'Ec2AsgSecret', { value: this.ec2AsgSecret, exportName: 'BgTestAlb-Ec2AsgSecret' });
    new cdk.CfnOutput(this, 'EcsEc2Secret', { value: this.ecsEc2Secret, exportName: 'BgTestAlb-EcsEc2Secret' });
    new cdk.CfnOutput(this, 'EcsFgSecret',  { value: this.ecsFgSecret,  exportName: 'BgTestAlb-EcsFgSecret' });
  }

  private makeWorkloadAlb(
    workload: string,
    opts: { vpc: ec2.IVpc; prefixListId: string; tgPort: number; tgType: elbv2.TargetType; includeGreen: boolean },
  ): WorkloadAlbBundle {
    const albSg = new ec2.SecurityGroup(this, `${workload}AlbSg`, {
      vpc: opts.vpc,
      allowAllOutbound: true,
      securityGroupName: `bg-alb-${workload}-sg`,
      description: `ALB ${workload} SG (CloudFront origin only)`,
    });
    new ec2.CfnSecurityGroupIngress(this, `${workload}AlbIngress`, {
      groupId: albSg.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 80,
      toPort: 80,
      sourcePrefixListId: opts.prefixListId,
      description: 'HTTP from CloudFront origin-facing only',
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, `${workload}Alb`, {
      vpc: opts.vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: `bg-alb-${workload}`.slice(0, 32),
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });
    cdk.Tags.of(alb).add('Name', `bg-alb-${workload}`);

    const blueTg = this.makeTg(workload, 'blue', opts);
    const greenTg = opts.includeGreen ? this.makeTg(workload, 'green', opts) : undefined;

    const listener = alb.addListener(`${workload}Listener`, {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Access Denied',
      }),
    });

    const secret = `bg-${workload}-${this.account}-${cdk.Names.uniqueId(this).slice(-6)}`;
    // L1 CfnListenerRule with weighted forward — initial Blue 100% / Green 0%.
    // Demo scripts use `aws elbv2 modify-rule` to change weights.
    const ruleTargetGroups: { targetGroupArn: string; weight: number }[] = [
      { targetGroupArn: blueTg.targetGroupArn, weight: 100 },
    ];
    if (greenTg) {
      ruleTargetGroups.push({ targetGroupArn: greenTg.targetGroupArn, weight: 0 });
    }
    new elbv2.CfnListenerRule(this, `${workload}ForwardRule`, {
      listenerArn: listener.listenerArn,
      priority: 1,
      conditions: [{
        field: 'http-header',
        httpHeaderConfig: { httpHeaderName: 'X-Custom-Secret', values: [secret] },
      }],
      actions: [{
        type: 'forward',
        forwardConfig: { targetGroups: ruleTargetGroups },
      }],
    });

    return { alb, listener, blueTg, greenTg, secret };
  }

  private makeTg(workload: string, color: 'blue' | 'green', opts: { vpc: ec2.IVpc; tgPort: number; tgType: elbv2.TargetType }): elbv2.ApplicationTargetGroup {
    const tg = new elbv2.ApplicationTargetGroup(this, `${workload}${color}Tg`, {
      vpc: opts.vpc,
      port: opts.tgPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: opts.tgType,
      targetGroupName: `bg-tg-${workload}-${color}`.slice(0, 32),
      healthCheck: {
        path: '/health',
        port: opts.tgType === elbv2.TargetType.INSTANCE ? 'traffic-port' : String(opts.tgPort),
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
      },
    });
    cdk.Tags.of(tg).add('Name', `bg-tg-${workload}-${color}`);
    cdk.Tags.of(tg).add('Color', color);
    return tg;
  }
}

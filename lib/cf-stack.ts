import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import { LAB_CONFIG, commonTags } from './config';
import { BgTestComputeStack } from './compute-stack';

export interface BgTestCfStackProps extends cdk.StackProps {
  /** Display only — actual traffic split is done by ALB weighted target groups, not CF */
  activeColor: 'blue' | 'green';
  /** CF always points to Blue ALBs. Blue's listener rules use weighted forwarding to Blue+Green TGs. */
  blueStack: BgTestComputeStack;
  /** Reference only (for tagging/metadata); CF origin domain is always Blue's ALB */
  greenStack?: BgTestComputeStack;
}

export class BgTestCfStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: BgTestCfStackProps) {
    super(scope, id, props);

    // CF origin is ALWAYS Blue's ALBs. Blue's listener rules forward weighted to Blue/Green TGs.
    // Traffic shifting: aws elbv2 modify-rule changes weights — propagation in 1-2 seconds.
    if (!props.blueStack.ec2AsgAlb || !props.blueStack.ecsEc2Alb || !props.blueStack.ecsFgAlb) {
      throw new Error('BlueStack must be deployed with manageAlb=true (provides ALBs for CF origins)');
    }
    if (!props.blueStack.ec2AsgSecret || !props.blueStack.ecsEc2Secret || !props.blueStack.ecsFgSecret) {
      throw new Error('BlueStack must expose X-Custom-Secret values for CF custom headers');
    }

    const baseBehavior: Omit<cloudfront.BehaviorOptions, 'origin'> = {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
    };

    const makeAlbOrigin = (dnsName: string, secret: string) =>
      new origins.HttpOrigin(dnsName, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        httpPort: 80,
        customHeaders: { 'X-Custom-Secret': secret },
        readTimeout: cdk.Duration.seconds(30),
      });

    const ec2asgOrigin = makeAlbOrigin(props.blueStack.ec2AsgAlb.loadBalancerDnsName, props.blueStack.ec2AsgSecret);
    const ecsec2Origin = makeAlbOrigin(props.blueStack.ecsEc2Alb.loadBalancerDnsName, props.blueStack.ecsEc2Secret);
    const ecsfgOrigin  = makeAlbOrigin(props.blueStack.ecsFgAlb.loadBalancerDnsName,  props.blueStack.ecsFgSecret);

    this.distribution = new cloudfront.Distribution(this, 'Cf', {
      comment: `${LAB_CONFIG.resourcePrefix}-test-cf (Blue ALB origin; weighted forward routes to Blue/Green TGs)`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: { origin: ec2asgOrigin, ...baseBehavior },
      additionalBehaviors: {
        '/ec2-asg/*': { origin: ec2asgOrigin, ...baseBehavior },
        '/ecs-ec2/*': { origin: ecsec2Origin, ...baseBehavior },
        '/ecs-fg/*':  { origin: ecsfgOrigin,  ...baseBehavior },
      },
    });
    cdk.Tags.of(this.distribution).add('Name', `${LAB_CONFIG.resourcePrefix}-cf`);
    Object.entries(commonTags()).forEach(([k, v]) => cdk.Tags.of(this.distribution).add(k, v));

    new cdk.CfnOutput(this, 'CfDomain', {
      value: `https://${this.distribution.distributionDomainName}`,
      exportName: 'BgTestCfDomain',
    });
    new cdk.CfnOutput(this, 'ActiveColor', {
      value: props.activeColor,
      description: 'Display only — actual weight is on ALB rules. Use scenario3-shift-traffic.sh to change.',
      exportName: 'BgTestActiveColor',
    });
  }
}

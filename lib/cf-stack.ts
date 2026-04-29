import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import { LAB_CONFIG, commonTags } from './config';
import { BgTestAlbStack } from './alb-stack';

export interface BgTestCfStackProps extends cdk.StackProps {
  /** Display only — actual traffic split is done by ALB weighted target groups */
  activeColor?: 'blue' | 'green';
  albStack: BgTestAlbStack;
}

export class BgTestCfStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: BgTestCfStackProps) {
    super(scope, id, props);

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

    const ec2asgOrigin = makeAlbOrigin(props.albStack.ec2AsgAlb.loadBalancerDnsName, props.albStack.ec2AsgSecret);
    const ecsec2Origin = makeAlbOrigin(props.albStack.ecsEc2Alb.loadBalancerDnsName, props.albStack.ecsEc2Secret);
    const ecsfgOrigin  = makeAlbOrigin(props.albStack.ecsFgAlb.loadBalancerDnsName,  props.albStack.ecsFgSecret);

    this.distribution = new cloudfront.Distribution(this, 'Cf', {
      comment: `${LAB_CONFIG.resourcePrefix}-test-cf (origin = AlbStack ALBs; weighted forward to Blue/Green TGs)`,
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
    if (props.activeColor) {
      new cdk.CfnOutput(this, 'ActiveColor', {
        value: props.activeColor,
        description: 'Display only — actual traffic split is on ALB weighted rule. Use scenario3-shift-traffic.sh.',
        exportName: 'BgTestActiveColor',
      });
    }
  }
}

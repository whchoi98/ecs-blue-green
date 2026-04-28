import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import { LAB_CONFIG, commonTags } from './config';
import { BgTestComputeStack } from './compute-stack';

export interface BgTestCfStackProps extends cdk.StackProps {
  activeColor: 'blue' | 'green';
  blueStack: BgTestComputeStack;
  greenStack?: BgTestComputeStack;
}

export class BgTestCfStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: BgTestCfStackProps) {
    super(scope, id, props);

    const active = props.activeColor === 'green' && props.greenStack ? props.greenStack : props.blueStack;

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

    const ec2asgOrigin = makeAlbOrigin(active.ec2AsgAlb.loadBalancerDnsName, active.ec2AsgSecret);
    const ecsec2Origin = makeAlbOrigin(active.ecsEc2Alb.loadBalancerDnsName, active.ecsEc2Secret);
    const ecsfgOrigin  = makeAlbOrigin(active.ecsFgAlb.loadBalancerDnsName,  active.ecsFgSecret);

    this.distribution = new cloudfront.Distribution(this, 'Cf', {
      comment: `${LAB_CONFIG.resourcePrefix}-test-cf (active=${props.activeColor})`,
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
      exportName: 'BgTestActiveColor',
    });
  }
}

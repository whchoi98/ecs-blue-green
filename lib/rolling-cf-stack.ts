import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import { LAB_CONFIG, commonTags } from './config';
import { BgTestRollingStack } from './rolling-stack';

export interface BgTestRollingCfStackProps extends cdk.StackProps {
  rollingStack: BgTestRollingStack;
}

export class BgTestRollingCfStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: BgTestRollingCfStackProps) {
    super(scope, id, props);

    const origin = new origins.HttpOrigin(props.rollingStack.alb.loadBalancerDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      customHeaders: { 'X-Custom-Secret': props.rollingStack.secret },
      readTimeout: cdk.Duration.seconds(30),
    });

    this.distribution = new cloudfront.Distribution(this, 'RollingCf', {
      comment: `${LAB_CONFIG.resourcePrefix}-rolling-cf (origin = RollingStack ALB)`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
    });
    cdk.Tags.of(this.distribution).add('Name', 'bg-rolling-cf');
    Object.entries(commonTags()).forEach(([k, v]) => cdk.Tags.of(this.distribution).add(k, v));

    new cdk.CfnOutput(this, 'RollingCfDomain', {
      value: `https://${this.distribution.distributionDomainName}`,
      exportName: 'BgRollingCfDomain',
    });
  }
}

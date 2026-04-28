import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { LAB_CONFIG, commonTags } from './config';
import { BgTestNetworkStack } from './network-stack';

export interface BgTestClusterStackProps extends cdk.StackProps {
  networkStack: BgTestNetworkStack;
}

export class BgTestClusterStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: BgTestClusterStackProps) {
    super(scope, id, props);

    // Note: capacity providers (FARGATE + per-color EC2 ASG CP) are registered by
    // BgTestComputeStack via a single CfnClusterCapacityProviderAssociations to keep
    // all CP wiring in one place and avoid cross-stack mutation cycles.
    this.cluster = new ecs.Cluster(this, 'EcsCluster', {
      clusterName: LAB_CONFIG.ecsClusterName,
      vpc: props.networkStack.vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });
    cdk.Tags.of(this.cluster).add('Name', `${LAB_CONFIG.resourcePrefix}-ecs-cluster`);
    Object.entries(commonTags()).forEach(([k, v]) => cdk.Tags.of(this.cluster).add(k, v));

    new cdk.CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName, exportName: 'BgTestClusterName' });
    new cdk.CfnOutput(this, 'ClusterArn', { value: this.cluster.clusterArn, exportName: 'BgTestClusterArn' });
  }
}

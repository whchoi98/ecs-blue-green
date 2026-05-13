import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
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
  constructor(scope: Construct, id: string, props: BgTestRollingStackProps) {
    super(scope, id, props);
    // implementation added in subsequent tasks
  }
}

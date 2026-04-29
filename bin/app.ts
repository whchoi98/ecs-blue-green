#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { BgTestNetworkStack } from '../lib/network-stack';
import { BgTestDataStack } from '../lib/data-stack';
import { BgTestEcrStack } from '../lib/ecr-stack';
import { BgTestClusterStack } from '../lib/cluster-stack';
import { BgTestComputeStack } from '../lib/compute-stack';
import { BgTestCfStack } from '../lib/cf-stack';
import { LAB_CONFIG } from '../lib/config';

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? LAB_CONFIG.region,
};

const activeColor = (app.node.tryGetContext('activeColor') ?? 'blue') as 'blue' | 'green';
const includeSecondaryCidr = app.node.tryGetContext('includeSecondaryCidr') === true || app.node.tryGetContext('includeSecondaryCidr') === 'true';
const includeGreen = app.node.tryGetContext('includeGreen') === true || app.node.tryGetContext('includeGreen') === 'true';
const cloudFrontPrefixListId = app.node.tryGetContext('cloudFrontPrefixListId') ?? 'pl-22a6434b';

const network = new BgTestNetworkStack(app, 'BgTestNetworkStack', { env, includeSecondaryCidr });
const data = new BgTestDataStack(app, 'BgTestDataStack', { env, networkStack: network });
const ecr = new BgTestEcrStack(app, 'BgTestEcrStack', { env });
const cluster = new BgTestClusterStack(app, 'BgTestClusterStack', { env, networkStack: network });

data.addDependency(network);
cluster.addDependency(network);

// Green stack defined first (Blue receives Green's TGs/CP via peerStack reference).
// Green: TGs + ASGs + ECS services in private-2 (NO ALBs, NO cluster CP association).
let green: BgTestComputeStack | undefined;
if (includeGreen) {
  green = new BgTestComputeStack(app, 'BgTestGreenStack', {
    env, color: 'green', computeSubnetGroup: 'private2',
    networkStack: network, dataStack: data, ecrStack: ecr, clusterStack: cluster,
    cloudFrontPrefixListId,
    manageAlb: false,
    manageClusterAssociation: false,
  });
  green.addDependency(network);
  green.addDependency(data);
  green.addDependency(ecr);
  green.addDependency(cluster);
}

// Blue stack: ALBs + listener rules with weighted forward to Blue TGs (and Green TGs if peer set).
// Blue: TGs + ALBs + ASGs + ECS services in private-1 + cluster CP association (incl. Green CP if peer).
const blue = new BgTestComputeStack(app, 'BgTestBlueStack', {
  env, color: 'blue', computeSubnetGroup: 'private1',
  networkStack: network, dataStack: data, ecrStack: ecr, clusterStack: cluster,
  cloudFrontPrefixListId,
  manageAlb: true,
  manageClusterAssociation: true,
  peerStack: green,
});
blue.addDependency(network);
blue.addDependency(data);
blue.addDependency(ecr);
blue.addDependency(cluster);
// blue.addDependency(green) is NOT set — the L1 CfnListenerRule references Green TG ARN
// via cross-stack export/import, which CDK handles with the correct dependency direction
// automatically without creating a cycle.

const cf = new BgTestCfStack(app, 'BgTestCfStack', { env, activeColor, blueStack: blue, greenStack: green });
cf.addDependency(blue);

app.synth();

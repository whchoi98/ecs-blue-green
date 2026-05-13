#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { BgTestNetworkStack } from '../lib/network-stack';
import { BgTestDataStack } from '../lib/data-stack';
import { BgTestEcrStack } from '../lib/ecr-stack';
import { BgTestClusterStack } from '../lib/cluster-stack';
import { BgTestAlbStack } from '../lib/alb-stack';
import { BgTestComputeStack } from '../lib/compute-stack';
import { BgTestCfStack } from '../lib/cf-stack';
import { BgTestRollingStack } from '../lib/rolling-stack';
import { BgTestRollingCfStack } from '../lib/rolling-cf-stack';
import { validateRollingContext } from '../lib/rolling-context';
import { LAB_CONFIG } from '../lib/config';

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? LAB_CONFIG.region,
};

const includeSecondaryCidr = app.node.tryGetContext('includeSecondaryCidr') === true || app.node.tryGetContext('includeSecondaryCidr') === 'true';
const includeGreen = app.node.tryGetContext('includeGreen') === true || app.node.tryGetContext('includeGreen') === 'true';
const cloudFrontPrefixListId = app.node.tryGetContext('cloudFrontPrefixListId') ?? 'pl-22a6434b';

const includeRolling = app.node.tryGetContext('includeRolling') === true || app.node.tryGetContext('includeRolling') === 'true';
const rollingLaunchVersion = (app.node.tryGetContext('rollingLaunchVersion') ?? 'v1') as 'v1' | 'v2';
const rollingTargetSubnet = (app.node.tryGetContext('rollingTargetSubnet') ?? 'private1') as 'private1' | 'private2';

validateRollingContext({ includeRolling, includeSecondaryCidr, rollingTargetSubnet });

// Foundation
const network = new BgTestNetworkStack(app, 'BgTestNetworkStack', { env, includeSecondaryCidr });
const data = new BgTestDataStack(app, 'BgTestDataStack', { env, networkStack: network });
const ecr = new BgTestEcrStack(app, 'BgTestEcrStack', { env });
const cluster = new BgTestClusterStack(app, 'BgTestClusterStack', { env, networkStack: network });
data.addDependency(network);
cluster.addDependency(network);

// AlbStack — owns ALBs + Blue TGs + (optional) Green TGs + Listener Rule (weighted)
const alb = new BgTestAlbStack(app, 'BgTestAlbStack', {
  env,
  networkStack: network,
  cloudFrontPrefixListId,
  includeGreen,
});
alb.addDependency(network);

// Blue compute (always)
const blue = new BgTestComputeStack(app, 'BgTestBlueStack', {
  env, color: 'blue', computeSubnetGroup: 'private1',
  networkStack: network, dataStack: data, ecrStack: ecr, clusterStack: cluster, albStack: alb,
});
blue.addDependency(network);
blue.addDependency(data);
blue.addDependency(ecr);
blue.addDependency(cluster);
blue.addDependency(alb);

// Green compute (optional)
let green: BgTestComputeStack | undefined;
if (includeGreen) {
  green = new BgTestComputeStack(app, 'BgTestGreenStack', {
    env, color: 'green', computeSubnetGroup: 'private2',
    networkStack: network, dataStack: data, ecrStack: ecr, clusterStack: cluster, albStack: alb,
  });
  green.addDependency(network);
  green.addDependency(data);
  green.addDependency(ecr);
  green.addDependency(cluster);
  green.addDependency(alb);
}

// CloudFront — origin is AlbStack. Traffic split is owned by ALB weighted rules
// (see demos/scenario3-shift-traffic.sh), so CF has no notion of active color.
const cf = new BgTestCfStack(app, 'BgTestCfStack', { env, albStack: alb });
cf.addDependency(alb);

// Rolling update stacks (opt-in via -c includeRolling=true)
if (includeRolling) {
  const rolling = new BgTestRollingStack(app, 'BgTestRollingStack', {
    env, networkStack: network, dataStack: data, ecrStack: ecr,
    cloudFrontPrefixListId,
    launchVersion: rollingLaunchVersion,
    targetSubnet: rollingTargetSubnet,
  });
  rolling.addDependency(network);
  rolling.addDependency(data);
  rolling.addDependency(ecr);

  const rollingCf = new BgTestRollingCfStack(app, 'BgTestRollingCfStack', { env, rollingStack: rolling });
  rollingCf.addDependency(rolling);
}

app.synth();

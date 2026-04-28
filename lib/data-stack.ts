import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { LAB_CONFIG, commonTags } from './config';
import { BgTestNetworkStack } from './network-stack';

export interface BgTestDataStackProps extends cdk.StackProps {
  networkStack: BgTestNetworkStack;
}

export class BgTestDataStack extends cdk.Stack {
  public readonly auroraCluster: rds.DatabaseCluster;
  public readonly redisReplicationGroup: elasticache.CfnReplicationGroup;
  public readonly dbSecret: secretsmanager.Secret;
  /**
   * Aurora cluster's security group. Created with no ingress rules — consumers
   * (e.g., compute stacks) must call `addIngressRule(...)` to allow traffic.
   */
  public readonly dbSecurityGroup: ec2.SecurityGroup;

  /**
   * Redis replication group's security group. Created with no ingress rules — consumers
   * must call `addIngressRule(...)` to allow traffic.
   */
  public readonly redisSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: BgTestDataStackProps) {
    super(scope, id, props);
    const tags = commonTags();
    const cfg = LAB_CONFIG.data;
    const prefix = LAB_CONFIG.resourcePrefix;
    const vpc = props.networkStack.vpc;

    this.dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
      secretName: 'bg-test/db',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: cfg.dbUser }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 24,
      },
    });

    this.dbSecurityGroup = new ec2.SecurityGroup(this, 'AuroraSg', {
      vpc, allowAllOutbound: true, description: 'Aurora MySQL SG',
      securityGroupName: `${prefix}-aurora-sg`,
    });

    this.auroraCluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraMysql({ version: rds.AuroraMysqlEngineVersion.VER_3_08_0 }),
      credentials: rds.Credentials.fromSecret(this.dbSecret),
      defaultDatabaseName: cfg.dbName,
      writer: rds.ClusterInstance.provisioned('Writer', {
        instanceType: new ec2.InstanceType(cfg.auroraInstanceClass.replace(/^db\./, '')),
      }),
      readers: [
        rds.ClusterInstance.provisioned('Reader', {
          instanceType: new ec2.InstanceType(cfg.auroraInstanceClass.replace(/^db\./, '')),
        }),
      ],
      vpc,
      vpcSubnets: { subnets: props.networkStack.dbSubnets },
      securityGroups: [this.dbSecurityGroup],
      backup: { retention: cdk.Duration.days(1) },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
    });
    cdk.Tags.of(this.auroraCluster).add('Name', `${prefix}-aurora-cluster`);

    this.redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc, allowAllOutbound: true, description: 'Redis SG',
      securityGroupName: `${prefix}-redis-sg`,
    });

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      cacheSubnetGroupName: `${prefix}-redis-subnet-group`,
      description: 'Redis subnets in private-1',
      subnetIds: props.networkStack.private1Subnets.map(s => s.subnetId),
    });

    this.redisReplicationGroup = new elasticache.CfnReplicationGroup(this, 'RedisRG', {
      replicationGroupId: `${prefix}-redis`,
      replicationGroupDescription: `${prefix}-redis primary + replica`,
      engine: 'valkey',
      cacheNodeType: cfg.redisNodeType,
      numCacheClusters: 2,
      automaticFailoverEnabled: true,
      multiAzEnabled: true,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      securityGroupIds: [this.redisSecurityGroup.securityGroupId],
      transitEncryptionEnabled: true,
      atRestEncryptionEnabled: true,
      port: 6379,
    });
    this.redisReplicationGroup.addDependency(redisSubnetGroup);

    Object.entries(tags).forEach(([k, v]) => {
      cdk.Tags.of(this.auroraCluster).add(k, v);
      cdk.Tags.of(this.redisReplicationGroup).add(k, v);
      cdk.Tags.of(this.dbSecret).add(k, v);
      cdk.Tags.of(this.dbSecurityGroup).add(k, v);
      cdk.Tags.of(this.redisSecurityGroup).add(k, v);
      cdk.Tags.of(redisSubnetGroup).add(k, v);
    });
    cdk.Tags.of(this.dbSecret).add('Name', `${prefix}-db-secret`);
    cdk.Tags.of(this.dbSecurityGroup).add('Name', `${prefix}-aurora-sg`);
    cdk.Tags.of(this.redisSecurityGroup).add('Name', `${prefix}-redis-sg`);
    cdk.Tags.of(redisSubnetGroup).add('Name', `${prefix}-redis-subnet-group`);
    cdk.Tags.of(this.redisReplicationGroup).add('Name', `${prefix}-redis`);

    new cdk.CfnOutput(this, 'AuroraEndpoint', { value: this.auroraCluster.clusterEndpoint.hostname, exportName: 'BgTestAuroraEndpoint' });
    new cdk.CfnOutput(this, 'AuroraReaderEndpoint', { value: this.auroraCluster.clusterReadEndpoint.hostname, exportName: 'BgTestAuroraReaderEndpoint' });
    new cdk.CfnOutput(this, 'RedisPrimaryEndpoint', { value: this.redisReplicationGroup.attrPrimaryEndPointAddress, exportName: 'BgTestRedisPrimary' });
    new cdk.CfnOutput(this, 'DbSecretArn', { value: this.dbSecret.secretArn, exportName: 'BgTestDbSecretArn' });
  }
}

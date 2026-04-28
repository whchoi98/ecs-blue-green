import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BgTestNetworkStack } from '../lib/network-stack';
import { BgTestDataStack } from '../lib/data-stack';

function synthData() {
  const app = new cdk.App();
  const network = new BgTestNetworkStack(app, 'Net', {
    env: { account: '123456789012', region: 'ap-northeast-2' },
    includeSecondaryCidr: false,
  });
  const data = new BgTestDataStack(app, 'Data', {
    env: { account: '123456789012', region: 'ap-northeast-2' },
    networkStack: network,
  });
  return Template.fromStack(data);
}

describe('BgTestDataStack', () => {
  it('creates Aurora MySQL cluster with 8.0.mysql_aurora.3.08.0 engine', () => {
    const t = synthData();
    t.hasResourceProperties('AWS::RDS::DBCluster', {
      Engine: 'aurora-mysql',
      EngineVersion: '8.0.mysql_aurora.3.08.0',
      DatabaseName: 'bgtest',
    });
  });

  it('creates 2 DB instances (Writer + Reader) of class db.t4g.xlarge', () => {
    const t = synthData();
    t.resourceCountIs('AWS::RDS::DBInstance', 2);
    t.hasResourceProperties('AWS::RDS::DBInstance', { DBInstanceClass: 'db.t4g.xlarge' });
  });

  it('creates Secrets Manager secret for DB password', () => {
    const t = synthData();
    t.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: Match.stringLikeRegexp('bg-test/db'),
    });
  });

  it('creates ElastiCache Redis 7.1 replication group with 2 nodes', () => {
    const t = synthData();
    t.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
      Engine: 'redis',
      EngineVersion: '7.1',
      CacheNodeType: 'cache.t4g.xlarge',
      NumNodeGroups: 1,
      ReplicasPerNodeGroup: 1,
      AutomaticFailoverEnabled: true,
      TransitEncryptionEnabled: true,
      AtRestEncryptionEnabled: true,
    });
  });

  it('creates DB and Redis subnet groups', () => {
    const t = synthData();
    t.resourceCountIs('AWS::RDS::DBSubnetGroup', 1);
    t.resourceCountIs('AWS::ElastiCache::SubnetGroup', 1);
  });
});

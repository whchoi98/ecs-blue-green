import { LAB_CONFIG, commonTags } from '../lib/config';

describe('LAB_CONFIG', () => {
  it('uses ap-northeast-2 region', () => {
    expect(LAB_CONFIG.region).toBe('ap-northeast-2');
  });

  it('has primary CIDR 10.1.0.0/16 and secondary 10.2.0.0/16', () => {
    expect(LAB_CONFIG.vpc.primaryCidr).toBe('10.1.0.0/16');
    expect(LAB_CONFIG.vpc.secondaryCidr).toBe('10.2.0.0/16');
  });

  it('defines private2 in secondary CIDR with /22 size (only explicit subnet — others auto-allocated)', () => {
    const private2 = LAB_CONFIG.vpc.subnets.private2;
    expect(private2.cidrA).toBe('10.2.0.0/22');
    expect(private2.cidrB).toBe('10.2.4.0/22');
  });

  it('uses Graviton instance types', () => {
    expect(LAB_CONFIG.compute.ec2InstanceType).toBe('t4g.xlarge');
    expect(LAB_CONFIG.compute.ecsHostInstanceType).toBe('t4g.xlarge');
    expect(LAB_CONFIG.data.auroraInstanceClass).toBe('db.t4g.large');
    expect(LAB_CONFIG.data.redisNodeType).toBe('cache.m7g.large');
  });

  it('returns common tags including Project, Environment, ManagedBy', () => {
    const tags = commonTags();
    expect(tags.Project).toBe('bg-test');
    expect(tags.Environment).toBe('lab');
    expect(tags.ManagedBy).toBe('cdk');
  });
});

export interface SubnetCidrPair { cidrA: string; cidrB: string; }

export interface LabConfig {
  region: string;
  vpc: {
    name: string;
    primaryCidr: string;
    secondaryCidr: string;
    subnets: {
      public: SubnetCidrPair;
      private1: SubnetCidrPair;
      private2: SubnetCidrPair;
      private3: SubnetCidrPair;
      db: SubnetCidrPair;
    };
  };
  compute: {
    ec2InstanceType: string;
    ecsHostInstanceType: string;
    fargateCpu: number;
    fargateMemory: number;
    asgDesired: number;
    asgMin: number;
    asgMax: number;
    ecsHostAsgDesired: number;
    ecsHostAsgMin: number;
    ecsHostAsgMax: number;
    appPort: number;
  };
  data: {
    auroraInstanceClass: string;
    auroraEngineVersion: string;
    redisNodeType: string;
    redisEngineVersion: string;
    dbName: string;
    dbUser: string;
  };
  ecsClusterName: string;
  ecrRepoName: string;
  resourcePrefix: string;
}

export const LAB_CONFIG: LabConfig = {
  region: 'ap-northeast-2',
  vpc: {
    name: 'test-vpc',
    primaryCidr: '10.0.0.0/16',
    secondaryCidr: '10.1.0.0/16',
    subnets: {
      public:   { cidrA: '10.0.11.0/24', cidrB: '10.0.12.0/24' },
      private1: { cidrA: '10.0.21.0/24', cidrB: '10.0.22.0/24' },
      private2: { cidrA: '10.1.0.0/22',  cidrB: '10.1.4.0/22'  },
      private3: { cidrA: '10.0.41.0/24', cidrB: '10.0.42.0/24' },
      db:       { cidrA: '10.0.51.0/24', cidrB: '10.0.52.0/24' },
    },
  },
  compute: {
    ec2InstanceType: 't4g.xlarge',
    ecsHostInstanceType: 't4g.xlarge',
    fargateCpu: 1024,
    fargateMemory: 2048,
    asgDesired: 4,
    asgMin: 4,
    asgMax: 8,
    ecsHostAsgDesired: 2,
    ecsHostAsgMin: 2,
    ecsHostAsgMax: 6,
    appPort: 3000,
  },
  data: {
    auroraInstanceClass: 'db.t4g.xlarge',
    auroraEngineVersion: '8.0.mysql_aurora.3.08.0',
    redisNodeType: 'cache.t4g.xlarge',
    redisEngineVersion: '7.1',
    dbName: 'bgtest',
    dbUser: 'admin',
  },
  ecsClusterName: 'test-cluster',
  ecrRepoName: 'bg-app',
  resourcePrefix: 'bg',
};

export function commonTags(): Record<string, string> {
  return {
    Project: 'bg-test',
    Environment: 'lab',
    ManagedBy: 'cdk',
  };
}

/**
 * Pair of CIDR blocks for a subnet group, one per Availability Zone.
 * `cidrA` = AZ-a (first AZ), `cidrB` = AZ-b (second AZ) of the region.
 */
export interface SubnetCidrPair { cidrA: string; cidrB: string; }

export interface LabConfig {
  region: string;
  vpc: {
    name: string;
    primaryCidr: string;
    secondaryCidr: string;
    subnets: {
      /** Public subnet — ALBs and NAT gateways. Internet-facing. */
      public: SubnetCidrPair;
      /** Private subnet 1 (/24) — initial Blue compute (EC2 ASG, ECS hosts, Fargate tasks) and Redis. */
      private1: SubnetCidrPair;
      /** Private subnet 2 (/22, in VPC secondary CIDR 10.1.0.0/16) — migration target for Green compute when private1 IPs are exhausted. */
      private2: SubnetCidrPair;
      /** Private subnet 3 (/24) — reserved for future workloads. */
      private3: SubnetCidrPair;
      /** Aurora MySQL subnet group — isolated (no NAT egress). */
      db: SubnetCidrPair;
    };
  };
  compute: {
    ec2InstanceType: string;
    ecsHostInstanceType: string;
    fargateCpu: number;
    fargateMemory: number;
    /** EC2 ASG (standalone, not ECS-managed) running the Express app directly via docker run. */
    asgDesired: number;
    asgMin: number;
    asgMax: number;
    /** ECS-managed ASG providing capacity for ECS-on-EC2 launch type. */
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

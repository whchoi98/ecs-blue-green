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
    /**
     * Primary CIDR subnets are auto-allocated by CDK's `ec2.Vpc` with `cidrMask: /24`.
     * Tier mapping (defined in `lib/network-stack.ts`):
     *   - `public`   → ALBs + NAT gateways (internet-facing)
     *   - `private1` → initial Blue compute (EC2 ASG, ECS hosts, Fargate tasks) and Redis
     *   - `private3` → reserved for future workloads
     *   - `db`       → Aurora subnet group (isolated, no NAT egress)
     * Identify subnets in the AWS console via the tag `aws-cdk:subnet-group-name`.
     * Only `private2` (in the secondary CIDR) is explicitly declared below because it
     * lives outside the auto-allocation range and uses the larger /22 mask.
     */
    subnets: {
      /** Private subnet 2 (/22, in VPC secondary CIDR 10.2.0.0/16) — migration target for Green compute when private1 IPs are exhausted. */
      private2: SubnetCidrPair;
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
    primaryCidr: '10.1.0.0/16',
    secondaryCidr: '10.2.0.0/16',
    subnets: {
      private2: { cidrA: '10.2.0.0/22', cidrB: '10.2.4.0/22' },
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
    auroraInstanceClass: 'db.r7g.large',
    auroraEngineVersion: '8.0.mysql_aurora.3.08.0',
    redisNodeType: 'cache.r7g.large',
    redisEngineVersion: '8.0',
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

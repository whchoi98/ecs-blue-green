# Blue/Green CDK Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 — CDK 프로젝트로 Network/Data/Ecr/Cluster/Blue Compute/CloudFront 6 stack 배포 + Express 앱 + 데모 스크립트 2개 (시나리오 1: Blue 배포, 시나리오 2: VPC secondary CIDR 추가).

**Architecture:** AWS CDK v2 TypeScript 멀티 스택 — `BgTestNetworkStack`이 VPC 기반, `BgTestDataStack`이 Aurora MySQL + ElastiCache Redis, `BgTestEcrStack`이 컨테이너 이미지 리포, `BgTestClusterStack`이 단일 ECS 클러스터, `BgTestComputeStack`(Blue/Green 재사용 클래스)이 ALB×3 + EC2 ASG + ECS 서비스×2, `BgTestCfStack`이 CloudFront. CDK context (`activeColor`, `includeSecondaryCidr`, `includeGreen`)로 시나리오 분기. CloudFront → 워크로드별 ALB 보안은 prefix list SG + X-Custom-Secret 헤더 이중 방어 (참조: `whchoi98/ec2_vscode/infra-cdk`).

**Tech Stack:** AWS CDK v2.180+ (TypeScript 5.x), Node.js 20, Express 4, ioredis, mysql2/promise, Docker (linux/arm64), Jest + `aws-cdk-lib/assertions`로 스택 단위 검증, supertest로 Express 테스트, bash demo scripts (ANSI 색상 + typewrite + spinner).

**Spec 참조:** `docs/superpowers/specs/2026-04-28-bluegreen-cdk-design.md`

---

## Task 1: Project Bootstrap (git, CDK, Jest)

**Files:**
- Create: `.git/` (via `git init`)
- Create: `package.json` (CDK CLI가 생성, 이후 수정)
- Create: `tsconfig.json` (CDK CLI가 생성, 이후 수정)
- Create: `cdk.json` (CDK CLI가 생성, 이후 수정)
- Create: `jest.config.js`
- Create: `bin/app.ts` (CDK CLI가 placeholder 생성)
- Create: `.gitignore` (CDK CLI 생성)
- Create: `lib/.gitkeep` (이후 stack 파일이 들어갈 디렉토리)

- [ ] **Step 1: Initialize git repository**

```bash
cd /home/ec2-user/my-project/ecs-blue-green
git init
git config user.email "claude@example.com"
git config user.name "Claude"
```

- [ ] **Step 2: Initialize CDK TypeScript project (creates package.json, tsconfig, bin/, lib/, cdk.json)**

```bash
npx --yes aws-cdk@latest init app --language=typescript
```

Expected: bin/, lib/, package.json, tsconfig.json, cdk.json, .gitignore, README.md 생성.

- [ ] **Step 3: Install runtime + test dependencies**

```bash
npm install --save aws-cdk-lib constructs
npm install --save-dev jest @types/jest ts-jest @types/node
```

- [ ] **Step 4: Create jest.config.js**

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  testTimeout: 30000,
};
```

- [ ] **Step 5: Update package.json scripts**

Replace the `scripts` block in `package.json`:

```json
{
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "test": "jest",
    "cdk": "cdk",
    "synth": "cdk synth",
    "diff": "cdk diff",
    "deploy": "cdk deploy --all"
  }
}
```

- [ ] **Step 6: Replace cdk.json with project context**

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/app.ts",
  "watch": {
    "include": ["**"],
    "exclude": ["README.md", "cdk*.json", "**/*.d.ts", "**/*.js", "tsconfig.json", "package*.json", "node_modules", "cdk.out"]
  },
  "context": {
    "activeColor": "blue",
    "includeSecondaryCidr": false,
    "includeGreen": false,
    "@aws-cdk/core:checkSecretUsage": true,
    "@aws-cdk/core:target-partitions": ["aws"],
    "@aws-cdk/aws-ec2:restrictDefaultSecurityGroup": true,
    "@aws-cdk/aws-iam:minimizePolicies": true,
    "@aws-cdk/aws-ecs:disableExplicitDeploymentControllerForCircuitBreaker": true
  }
}
```

- [ ] **Step 7: Verify `npm test` runs (no tests yet, exit 0 expected after creating empty placeholder)**

Create `test/.gitkeep`:

```bash
mkdir -p test && touch test/.gitkeep
```

Run: `npm test -- --passWithNoTests`
Expected: PASS (no tests, but exits 0).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: bootstrap CDK TypeScript project with jest"
```

---

## Task 2: Config Module (lib/config.ts)

**Files:**
- Create: `lib/config.ts`
- Create: `test/config.test.ts`

- [ ] **Step 1: Write the failing test**

`test/config.test.ts`:

```typescript
import { LAB_CONFIG, commonTags } from '../lib/config';

describe('LAB_CONFIG', () => {
  it('uses ap-northeast-2 region', () => {
    expect(LAB_CONFIG.region).toBe('ap-northeast-2');
  });

  it('has primary CIDR 10.0.0.0/16 and secondary 10.1.0.0/16', () => {
    expect(LAB_CONFIG.vpc.primaryCidr).toBe('10.0.0.0/16');
    expect(LAB_CONFIG.vpc.secondaryCidr).toBe('10.1.0.0/16');
  });

  it('defines all 5 subnet types in primary CIDR', () => {
    const subnets = LAB_CONFIG.vpc.subnets;
    expect(subnets.public.cidrA).toBe('10.0.11.0/24');
    expect(subnets.public.cidrB).toBe('10.0.12.0/24');
    expect(subnets.private1.cidrA).toBe('10.0.21.0/24');
    expect(subnets.private1.cidrB).toBe('10.0.22.0/24');
    expect(subnets.private3.cidrA).toBe('10.0.41.0/24');
    expect(subnets.private3.cidrB).toBe('10.0.42.0/24');
    expect(subnets.db.cidrA).toBe('10.0.51.0/24');
    expect(subnets.db.cidrB).toBe('10.0.52.0/24');
  });

  it('defines private2 in secondary CIDR with /22 size', () => {
    const private2 = LAB_CONFIG.vpc.subnets.private2;
    expect(private2.cidrA).toBe('10.1.0.0/22');
    expect(private2.cidrB).toBe('10.1.4.0/22');
  });

  it('uses Graviton instance types', () => {
    expect(LAB_CONFIG.compute.ec2InstanceType).toBe('t4g.xlarge');
    expect(LAB_CONFIG.compute.ecsHostInstanceType).toBe('t4g.xlarge');
    expect(LAB_CONFIG.data.auroraInstanceClass).toBe('db.t4g.xlarge');
    expect(LAB_CONFIG.data.redisNodeType).toBe('cache.t4g.xlarge');
  });

  it('returns common tags including Project, Environment, ManagedBy', () => {
    const tags = commonTags();
    expect(tags.Project).toBe('bg-test');
    expect(tags.Environment).toBe('lab');
    expect(tags.ManagedBy).toBe('cdk');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/config.test.ts`
Expected: FAIL with "Cannot find module '../lib/config'".

- [ ] **Step 3: Implement lib/config.ts**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/config.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add lib/config.ts test/config.test.ts
git commit -m "feat: add LAB_CONFIG with CIDRs, instance types, and common tags"
```

---

## Task 3: Network Stack (VPC + Subnets + NAT + Endpoints)

**Files:**
- Create: `lib/network-stack.ts`
- Create: `test/network-stack.test.ts`

- [ ] **Step 1: Write failing test for VPC primary CIDR + Name tag**

`test/network-stack.test.ts`:

```typescript
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BgTestNetworkStack } from '../lib/network-stack';

function synth(props: { includeSecondaryCidr?: boolean } = {}) {
  const app = new cdk.App();
  const stack = new BgTestNetworkStack(app, 'TestNetwork', {
    env: { account: '123456789012', region: 'ap-northeast-2' },
    includeSecondaryCidr: props.includeSecondaryCidr ?? false,
  });
  return Template.fromStack(stack);
}

describe('BgTestNetworkStack', () => {
  it('creates VPC with 10.0.0.0/16 and Name tag test-vpc', () => {
    const t = synth();
    t.hasResourceProperties('AWS::EC2::VPC', {
      CidrBlock: '10.0.0.0/16',
      Tags: Match.arrayWith([{ Key: 'Name', Value: 'test-vpc' }]),
    });
  });
});
```

- [ ] **Step 2: Run test → fail (module not found)**

Run: `npm test -- test/network-stack.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement minimum VPC with primary CIDR**

`lib/network-stack.ts`:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { LAB_CONFIG, commonTags } from './config';

export interface BgTestNetworkStackProps extends cdk.StackProps {
  includeSecondaryCidr: boolean;
}

export class BgTestNetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly publicSubnets: ec2.ISubnet[];
  public readonly private1Subnets: ec2.ISubnet[];
  public readonly private2Subnets: ec2.ISubnet[];
  public readonly private3Subnets: ec2.ISubnet[];
  public readonly dbSubnets: ec2.ISubnet[];

  constructor(scope: Construct, id: string, props: BgTestNetworkStackProps) {
    super(scope, id, props);

    const tags = commonTags();
    const cfg = LAB_CONFIG.vpc;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(cfg.primaryCidr),
      maxAzs: 2,
      natGateways: 2,
      subnetConfiguration: [
        { name: 'public',   subnetType: ec2.SubnetType.PUBLIC,             cidrMask: 24 },
        { name: 'private1', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'private3', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'db',       subnetType: ec2.SubnetType.PRIVATE_ISOLATED,    cidrMask: 24 },
      ],
    });
    cdk.Tags.of(this.vpc).add('Name', cfg.name);
    Object.entries(tags).forEach(([k, v]) => cdk.Tags.of(this.vpc).add(k, v));

    this.publicSubnets   = this.vpc.selectSubnets({ subnetGroupName: 'public' }).subnets;
    this.private1Subnets = this.vpc.selectSubnets({ subnetGroupName: 'private1' }).subnets;
    this.private3Subnets = this.vpc.selectSubnets({ subnetGroupName: 'private3' }).subnets;
    this.dbSubnets       = this.vpc.selectSubnets({ subnetGroupName: 'db' }).subnets;
    this.private2Subnets = [];

    if (props.includeSecondaryCidr) {
      this.addSecondaryCidrAndPrivate2();
    }
  }

  private addSecondaryCidrAndPrivate2() {
    const cfg = LAB_CONFIG.vpc;
    const cidrAssoc = new ec2.CfnVPCCidrBlock(this, 'SecondaryCidr', {
      vpcId: this.vpc.vpcId,
      cidrBlock: cfg.secondaryCidr,
    });

    const azs = cdk.Stack.of(this).availabilityZones.slice(0, 2);
    const newSubnets: ec2.ISubnet[] = [];
    azs.forEach((az, i) => {
      const subnet = new ec2.Subnet(this, `Private2Subnet${i}`, {
        vpcId: this.vpc.vpcId,
        availabilityZone: az,
        cidrBlock: i === 0 ? cfg.subnets.private2.cidrA : cfg.subnets.private2.cidrB,
        mapPublicIpOnLaunch: false,
      });
      subnet.node.addDependency(cidrAssoc);
      cdk.Tags.of(subnet).add('Name', `bg-private2-${az.slice(-1)}`);

      const natGw = this.vpc.publicSubnets[i].node.tryFindChild('NATGateway') as ec2.CfnNatGateway | undefined;
      if (natGw) {
        new ec2.CfnRoute(this, `Private2Route${i}`, {
          routeTableId: subnet.routeTable.routeTableId,
          destinationCidrBlock: '0.0.0.0/0',
          natGatewayId: natGw.ref,
        });
      }
      newSubnets.push(subnet);
    });
    this.private2Subnets = newSubnets;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/network-stack.test.ts`
Expected: PASS (1/1).

- [ ] **Step 5: Add tests for subnet count + secondary CIDR conditional + NAT count**

Append to `test/network-stack.test.ts`:

```typescript
describe('BgTestNetworkStack subnets', () => {
  it('creates 8 subnets when secondary CIDR disabled (4 types × 2 AZ)', () => {
    const t = synth();
    t.resourceCountIs('AWS::EC2::Subnet', 8);
  });

  it('creates 2 NAT gateways (one per AZ) for HA', () => {
    const t = synth();
    t.resourceCountIs('AWS::EC2::NatGateway', 2);
  });

  it('adds secondary CIDR association when includeSecondaryCidr=true', () => {
    const t = synth({ includeSecondaryCidr: true });
    t.hasResourceProperties('AWS::EC2::VPCCidrBlock', { CidrBlock: '10.1.0.0/16' });
  });

  it('creates 10 subnets when secondary CIDR enabled (8 + private2 ×2)', () => {
    const t = synth({ includeSecondaryCidr: true });
    t.resourceCountIs('AWS::EC2::Subnet', 10);
  });

  it('private2-a uses 10.1.0.0/22 and private2-b uses 10.1.4.0/22', () => {
    const t = synth({ includeSecondaryCidr: true });
    t.hasResourceProperties('AWS::EC2::Subnet', { CidrBlock: '10.1.0.0/22' });
    t.hasResourceProperties('AWS::EC2::Subnet', { CidrBlock: '10.1.4.0/22' });
  });
});
```

- [ ] **Step 6: Run tests → expect 5/6 pass (NAT count likely fails since CDK creates 1 NAT by default with current setup; we set natGateways: 2)**

Run: `npm test -- test/network-stack.test.ts`
Expected: PASS 6/6 (we already set `natGateways: 2`).

If failures, fix the implementation accordingly until all pass.

- [ ] **Step 7: Add VPC endpoints (ECR, S3, CloudWatch Logs, Secrets Manager, SSM)**

Append to `BgTestNetworkStack` constructor (after `if (props.includeSecondaryCidr)` block):

```typescript
    this.addVpcEndpoints();
```

Add private method:

```typescript
  private addVpcEndpoints() {
    const subnetSelection: ec2.SubnetSelection = {
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    };

    new ec2.GatewayVpcEndpoint(this, 'S3Endpoint', {
      vpc: this.vpc,
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    const interfaceServices: { id: string; svc: ec2.InterfaceVpcEndpointAwsService }[] = [
      { id: 'EcrApi',      svc: ec2.InterfaceVpcEndpointAwsService.ECR },
      { id: 'EcrDkr',      svc: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER },
      { id: 'CwLogs',      svc: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS },
      { id: 'Secrets',     svc: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER },
      { id: 'Ssm',         svc: ec2.InterfaceVpcEndpointAwsService.SSM },
      { id: 'SsmMessages', svc: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES },
      { id: 'Ec2Messages', svc: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES },
    ];

    for (const { id, svc } of interfaceServices) {
      new ec2.InterfaceVpcEndpoint(this, `${id}Endpoint`, {
        vpc: this.vpc,
        service: svc,
        subnets: subnetSelection,
        privateDnsEnabled: true,
      });
    }
  }
```

- [ ] **Step 8: Add test for VPC endpoints**

Append to `test/network-stack.test.ts`:

```typescript
describe('BgTestNetworkStack VPC endpoints', () => {
  it('creates S3 gateway endpoint', () => {
    const t = synth();
    t.hasResourceProperties('AWS::EC2::VPCEndpoint', { VpcEndpointType: 'Gateway', ServiceName: Match.stringLikeRegexp('s3') });
  });

  it('creates 7 interface endpoints (ECR×2, CW Logs, Secrets, SSM×3)', () => {
    const t = synth();
    const interfaceCount = t.findResources('AWS::EC2::VPCEndpoint', { Properties: { VpcEndpointType: 'Interface' } });
    expect(Object.keys(interfaceCount).length).toBe(7);
  });
});
```

- [ ] **Step 9: Run all network tests**

Run: `npm test -- test/network-stack.test.ts`
Expected: PASS 8/8.

- [ ] **Step 10: Commit**

```bash
git add lib/network-stack.ts test/network-stack.test.ts
git commit -m "feat: add BgTestNetworkStack with VPC, subnets, NAT, endpoints, secondary CIDR"
```

---

## Task 4: Data Stack (Aurora MySQL + ElastiCache Redis + Secrets)

**Files:**
- Create: `lib/data-stack.ts`
- Create: `test/data-stack.test.ts`

- [ ] **Step 1: Write failing test**

`test/data-stack.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test → fail**

Run: `npm test -- test/data-stack.test.ts`
Expected: FAIL ("Cannot find module '../lib/data-stack'").

- [ ] **Step 3: Implement lib/data-stack.ts**

```typescript
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
  public readonly dbSecurityGroup: ec2.SecurityGroup;
  public readonly redisSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: BgTestDataStackProps) {
    super(scope, id, props);
    const tags = commonTags();
    const cfg = LAB_CONFIG.data;
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
      securityGroupName: 'bg-aurora-sg',
    });

    this.auroraCluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraMysql({ version: rds.AuroraMysqlEngineVersion.VER_3_08_0 }),
      credentials: rds.Credentials.fromSecret(this.dbSecret),
      defaultDatabaseName: cfg.dbName,
      writer: rds.ClusterInstance.provisioned('Writer', {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.XLARGE),
      }),
      readers: [
        rds.ClusterInstance.provisioned('Reader', {
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.XLARGE),
        }),
      ],
      vpc,
      vpcSubnets: { subnets: props.networkStack.dbSubnets },
      securityGroups: [this.dbSecurityGroup],
      backup: { retention: cdk.Duration.days(1) },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
    });
    cdk.Tags.of(this.auroraCluster).add('Name', 'bg-aurora-cluster');

    this.redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc, allowAllOutbound: true, description: 'Redis SG',
      securityGroupName: 'bg-redis-sg',
    });

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      cacheSubnetGroupName: 'bg-redis-subnet-group',
      description: 'Redis subnets in private-1',
      subnetIds: props.networkStack.private1Subnets.map(s => s.subnetId),
    });

    this.redisReplicationGroup = new elasticache.CfnReplicationGroup(this, 'RedisRG', {
      replicationGroupId: 'bg-redis',
      replicationGroupDescription: 'bg-redis primary + replica',
      engine: 'redis',
      engineVersion: cfg.redisEngineVersion,
      cacheNodeType: cfg.redisNodeType,
      numNodeGroups: 1,
      replicasPerNodeGroup: 1,
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
    });

    new cdk.CfnOutput(this, 'AuroraEndpoint', { value: this.auroraCluster.clusterEndpoint.hostname, exportName: 'BgTestAuroraEndpoint' });
    new cdk.CfnOutput(this, 'AuroraReaderEndpoint', { value: this.auroraCluster.clusterReadEndpoint.hostname, exportName: 'BgTestAuroraReaderEndpoint' });
    new cdk.CfnOutput(this, 'RedisPrimaryEndpoint', { value: this.redisReplicationGroup.attrPrimaryEndPointAddress, exportName: 'BgTestRedisPrimary' });
    new cdk.CfnOutput(this, 'DbSecretArn', { value: this.dbSecret.secretArn, exportName: 'BgTestDbSecretArn' });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/data-stack.test.ts`
Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
git add lib/data-stack.ts test/data-stack.test.ts
git commit -m "feat: add BgTestDataStack with Aurora MySQL Writer+Reader and Redis replication group"
```

---

## Task 5: ECR Stack

**Files:**
- Create: `lib/ecr-stack.ts`
- Create: `test/ecr-stack.test.ts`

- [ ] **Step 1: Write failing test**

`test/ecr-stack.test.ts`:

```typescript
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BgTestEcrStack } from '../lib/ecr-stack';

function synthEcr() {
  const app = new cdk.App();
  const stack = new BgTestEcrStack(app, 'Ecr', {
    env: { account: '123456789012', region: 'ap-northeast-2' },
  });
  return Template.fromStack(stack);
}

describe('BgTestEcrStack', () => {
  it('creates ECR repo named bg-app with image scan on push', () => {
    const t = synthEcr();
    t.hasResourceProperties('AWS::ECR::Repository', {
      RepositoryName: 'bg-app',
      ImageScanningConfiguration: { ScanOnPush: true },
    });
  });

  it('configures lifecycle policy to keep last 10 images', () => {
    const t = synthEcr();
    t.hasResourceProperties('AWS::ECR::Repository', {
      LifecyclePolicy: {
        LifecyclePolicyText: Match.stringLikeRegexp('"countNumber":10'),
      },
    });
  });
});
```

- [ ] **Step 2: Run test → fail**

Run: `npm test -- test/ecr-stack.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement lib/ecr-stack.ts**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Construct } from 'constructs';
import { LAB_CONFIG, commonTags } from './config';

export class BgTestEcrStack extends cdk.Stack {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.repository = new ecr.Repository(this, 'Repo', {
      repositoryName: LAB_CONFIG.ecrRepoName,
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules: [{
        description: 'Keep last 10 images',
        maxImageCount: 10,
        rulePriority: 1,
      }],
    });

    Object.entries(commonTags()).forEach(([k, v]) => cdk.Tags.of(this.repository).add(k, v));
    cdk.Tags.of(this.repository).add('Name', 'bg-ecr');

    new cdk.CfnOutput(this, 'RepoUri', {
      value: this.repository.repositoryUri,
      exportName: 'BgTestEcrUri',
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/ecr-stack.test.ts`
Expected: PASS 2/2.

- [ ] **Step 5: Commit**

```bash
git add lib/ecr-stack.ts test/ecr-stack.test.ts
git commit -m "feat: add BgTestEcrStack with bg-app repo and lifecycle policy"
```

---

## Task 6: Cluster Stack (ECS cluster, Blue/Green 공유)

**Files:**
- Create: `lib/cluster-stack.ts`
- Create: `test/cluster-stack.test.ts`

- [ ] **Step 1: Write failing test**

`test/cluster-stack.test.ts`:

```typescript
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BgTestNetworkStack } from '../lib/network-stack';
import { BgTestClusterStack } from '../lib/cluster-stack';

function synthCluster() {
  const app = new cdk.App();
  const network = new BgTestNetworkStack(app, 'Net', {
    env: { account: '123456789012', region: 'ap-northeast-2' },
    includeSecondaryCidr: false,
  });
  const cluster = new BgTestClusterStack(app, 'Cluster', {
    env: { account: '123456789012', region: 'ap-northeast-2' },
    networkStack: network,
  });
  return Template.fromStack(cluster);
}

describe('BgTestClusterStack', () => {
  it('creates ECS cluster named test-cluster with Container Insights', () => {
    const t = synthCluster();
    t.hasResourceProperties('AWS::ECS::Cluster', {
      ClusterName: 'test-cluster',
      ClusterSettings: [{ Name: 'containerInsights', Value: 'enabled' }],
    });
  });
});
```

- [ ] **Step 2: Run test → fail**

Run: `npm test -- test/cluster-stack.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement lib/cluster-stack.ts**

```typescript
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

    this.cluster = new ecs.Cluster(this, 'EcsCluster', {
      clusterName: LAB_CONFIG.ecsClusterName,
      vpc: props.networkStack.vpc,
      containerInsights: true,
      enableFargateCapacityProviders: true,
    });
    cdk.Tags.of(this.cluster).add('Name', 'bg-ecs-cluster');
    Object.entries(commonTags()).forEach(([k, v]) => cdk.Tags.of(this.cluster).add(k, v));

    new cdk.CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName, exportName: 'BgTestClusterName' });
    new cdk.CfnOutput(this, 'ClusterArn', { value: this.cluster.clusterArn, exportName: 'BgTestClusterArn' });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/cluster-stack.test.ts`
Expected: PASS 1/1.

- [ ] **Step 5: Commit**

```bash
git add lib/cluster-stack.ts test/cluster-stack.test.ts
git commit -m "feat: add BgTestClusterStack with shared ECS cluster"
```

---

## Task 7: Compute Stack (Blue 또는 Green — ALB×3 + EC2 ASG + ECS service×2)

**Files:**
- Create: `lib/compute-stack.ts`
- Create: `test/compute-stack.test.ts`

- [ ] **Step 1: Write failing test for stack core resources**

`test/compute-stack.test.ts`:

```typescript
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BgTestNetworkStack } from '../lib/network-stack';
import { BgTestDataStack } from '../lib/data-stack';
import { BgTestEcrStack } from '../lib/ecr-stack';
import { BgTestClusterStack } from '../lib/cluster-stack';
import { BgTestComputeStack } from '../lib/compute-stack';

function synthCompute(opts: { color: 'blue' | 'green'; subnetGroup: 'private1' | 'private2' }) {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'ap-northeast-2' };
  const network = new BgTestNetworkStack(app, 'Net', { env, includeSecondaryCidr: opts.subnetGroup === 'private2' });
  const data = new BgTestDataStack(app, 'Data', { env, networkStack: network });
  const ecr = new BgTestEcrStack(app, 'Ecr', { env });
  const cluster = new BgTestClusterStack(app, 'Cluster', { env, networkStack: network });
  const compute = new BgTestComputeStack(app, `Compute${opts.color}`, {
    env, color: opts.color, computeSubnetGroup: opts.subnetGroup,
    networkStack: network, dataStack: data, ecrStack: ecr, clusterStack: cluster,
    cloudFrontPrefixListId: 'pl-22a6434b',
  });
  return Template.fromStack(compute);
}

describe('BgTestComputeStack (Blue, private-1)', () => {
  it('creates 3 ALBs (ec2asg, ecsec2, ecsfg) all internet-facing', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 3);
    const albs = t.findResources('AWS::ElasticLoadBalancingV2::LoadBalancer');
    Object.values(albs).forEach((alb: any) => {
      expect(alb.Properties.Scheme).toBe('internet-facing');
    });
  });

  it('creates 3 listeners with default 403 fixed-response', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 3);
    const listeners = t.findResources('AWS::ElasticLoadBalancingV2::Listener');
    Object.values(listeners).forEach((l: any) => {
      const def = l.Properties.DefaultActions[0];
      expect(def.Type).toBe('fixed-response');
      expect(def.FixedResponseConfig.StatusCode).toBe('403');
    });
  });

  it('creates 3 listener rules with X-Custom-Secret header condition', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 3);
    const rules = t.findResources('AWS::ElasticLoadBalancingV2::ListenerRule');
    Object.values(rules).forEach((r: any) => {
      const cond = r.Properties.Conditions[0];
      expect(cond.Field).toBe('http-header');
      expect(cond.HttpHeaderConfig.HttpHeaderName).toBe('X-Custom-Secret');
    });
  });

  it('creates 3 target groups (ec2asg=instance:80, ecsec2=instance, ecsfg=ip:3000)', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 3);
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      TargetType: 'ip', Port: 3000,
    });
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      TargetType: 'instance', Port: 80,
    });
  });

  it('creates EC2 ASG with desired=4, min=4, max=8, t4g.xlarge', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
      DesiredCapacity: '4', MinSize: '4', MaxSize: '8',
    });
    t.hasResourceProperties('AWS::EC2::LaunchTemplate', Match.objectLike({
      LaunchTemplateData: Match.objectLike({ InstanceType: 't4g.xlarge' }),
    }));
  });

  it('creates 2 ECS services (ecs-ec2 + fargate)', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.resourceCountIs('AWS::ECS::Service', 2);
  });

  it('creates Fargate task definition with ARM64 runtime', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.hasResourceProperties('AWS::ECS::TaskDefinition', {
      RequiresCompatibilities: ['FARGATE'],
      RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' },
    });
  });

  it('creates EC2-launch-type task definition with bridge network mode', () => {
    const t = synthCompute({ color: 'blue', subnetGroup: 'private1' });
    t.hasResourceProperties('AWS::ECS::TaskDefinition', {
      RequiresCompatibilities: Match.arrayWith(['EC2']),
      NetworkMode: 'bridge',
    });
  });
});
```

- [ ] **Step 2: Run test → fail**

Run: `npm test -- test/compute-stack.test.ts`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Implement compute-stack.ts (skeleton + props + ALBs)**

`lib/compute-stack.ts`:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2_targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { LAB_CONFIG, commonTags } from './config';
import { BgTestNetworkStack } from './network-stack';
import { BgTestDataStack } from './data-stack';
import { BgTestEcrStack } from './ecr-stack';
import { BgTestClusterStack } from './cluster-stack';

export type Color = 'blue' | 'green';
export type ComputeSubnetGroup = 'private1' | 'private2';

export interface BgTestComputeStackProps extends cdk.StackProps {
  color: Color;
  computeSubnetGroup: ComputeSubnetGroup;
  networkStack: BgTestNetworkStack;
  dataStack: BgTestDataStack;
  ecrStack: BgTestEcrStack;
  clusterStack: BgTestClusterStack;
  cloudFrontPrefixListId: string;
}

interface AlbBundle {
  alb: elbv2.ApplicationLoadBalancer;
  listener: elbv2.ApplicationListener;
  tg: elbv2.ApplicationTargetGroup;
  secret: string;
}

export class BgTestComputeStack extends cdk.Stack {
  public readonly ec2AsgAlb: elbv2.ApplicationLoadBalancer;
  public readonly ecsEc2Alb: elbv2.ApplicationLoadBalancer;
  public readonly ecsFgAlb: elbv2.ApplicationLoadBalancer;
  public readonly ec2AsgSecret: string;
  public readonly ecsEc2Secret: string;
  public readonly ecsFgSecret: string;

  private readonly color: Color;
  private readonly computeSubnets: ec2.ISubnet[];
  private readonly imageTag: string;
  private readonly imageUri: string;
  private readonly tags: Record<string, string>;

  constructor(scope: Construct, id: string, props: BgTestComputeStackProps) {
    super(scope, id, props);
    this.color = props.color;
    this.tags = { ...commonTags(), Color: props.color };
    this.imageTag = props.color;
    this.imageUri = `${props.ecrStack.repository.repositoryUri}:${this.imageTag}`;

    const subnets = props.computeSubnetGroup === 'private1'
      ? props.networkStack.private1Subnets
      : props.networkStack.private2Subnets;
    if (subnets.length === 0) {
      throw new Error(`No subnets available for group ${props.computeSubnetGroup}. Did you set includeSecondaryCidr=true?`);
    }
    this.computeSubnets = subnets;

    const vpc = props.networkStack.vpc;
    const ec2asgBundle = this.createAlbBundle('ec2asg', { tgPort: 80, tgType: elbv2.TargetType.INSTANCE, prefixListId: props.cloudFrontPrefixListId, vpc });
    const ecsec2Bundle = this.createAlbBundle('ecsec2', { tgPort: 80, tgType: elbv2.TargetType.INSTANCE, prefixListId: props.cloudFrontPrefixListId, vpc });
    const ecsfgBundle  = this.createAlbBundle('ecsfg',  { tgPort: LAB_CONFIG.compute.appPort, tgType: elbv2.TargetType.IP, prefixListId: props.cloudFrontPrefixListId, vpc });

    this.ec2AsgAlb = ec2asgBundle.alb;
    this.ecsEc2Alb = ecsec2Bundle.alb;
    this.ecsFgAlb  = ecsfgBundle.alb;
    this.ec2AsgSecret = ec2asgBundle.secret;
    this.ecsEc2Secret = ecsec2Bundle.secret;
    this.ecsFgSecret  = ecsfgBundle.secret;

    this.attachEc2Asg(ec2asgBundle, props);
    this.attachEcsEc2(ecsec2Bundle, props);
    this.attachEcsFargate(ecsfgBundle, props);

    new cdk.CfnOutput(this, 'Ec2AsgAlbDns', { value: this.ec2AsgAlb.loadBalancerDnsName, exportName: `BgTest-${props.color}-Ec2AsgAlb` });
    new cdk.CfnOutput(this, 'EcsEc2AlbDns', { value: this.ecsEc2Alb.loadBalancerDnsName, exportName: `BgTest-${props.color}-EcsEc2Alb` });
    new cdk.CfnOutput(this, 'EcsFgAlbDns',  { value: this.ecsFgAlb.loadBalancerDnsName,  exportName: `BgTest-${props.color}-EcsFgAlb` });
    new cdk.CfnOutput(this, 'Ec2AsgSecret', { value: this.ec2AsgSecret, exportName: `BgTest-${props.color}-Ec2AsgSecret` });
    new cdk.CfnOutput(this, 'EcsEc2Secret', { value: this.ecsEc2Secret, exportName: `BgTest-${props.color}-EcsEc2Secret` });
    new cdk.CfnOutput(this, 'EcsFgSecret',  { value: this.ecsFgSecret,  exportName: `BgTest-${props.color}-EcsFgSecret` });
  }

  private createAlbBundle(
    workload: string,
    opts: { tgPort: number; tgType: elbv2.TargetType; prefixListId: string; vpc: ec2.IVpc },
  ): AlbBundle {
    const albSg = new ec2.SecurityGroup(this, `${workload}AlbSg`, {
      vpc: opts.vpc,
      allowAllOutbound: true,
      securityGroupName: `bg-alb-${workload}-${this.color}-sg`,
      description: `ALB ${workload} ${this.color} SG`,
    });

    new ec2.CfnSecurityGroupIngress(this, `${workload}AlbIngress`, {
      groupId: albSg.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 80,
      toPort: 80,
      sourcePrefixListId: opts.prefixListId,
      description: 'HTTP from CloudFront origin-facing only',
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, `${workload}Alb`, {
      vpc: opts.vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: `bg-alb-${workload}-${this.color}`.slice(0, 32),
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });
    cdk.Tags.of(alb).add('Name', `bg-alb-${workload}-${this.color}`);

    const tg = new elbv2.ApplicationTargetGroup(this, `${workload}Tg`, {
      vpc: opts.vpc,
      port: opts.tgPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: opts.tgType,
      healthCheck: {
        path: '/health',
        port: opts.tgType === elbv2.TargetType.INSTANCE ? 'traffic-port' : String(opts.tgPort),
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
      },
    });

    const listener = alb.addListener(`${workload}Listener`, {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Access Denied',
      }),
    });

    const secret = `bg-${this.color}-${workload}-${this.account}-${cdk.Names.uniqueId(this).slice(-6)}`;
    listener.addAction(`${workload}Forward`, {
      priority: 1,
      conditions: [elbv2.ListenerCondition.httpHeader('X-Custom-Secret', [secret])],
      action: elbv2.ListenerAction.forward([tg]),
    });

    return { alb, listener, tg, secret };
  }

  private attachEc2Asg(bundle: AlbBundle, props: BgTestComputeStackProps) {
    const vpc = props.networkStack.vpc;

    const role = new iam.Role(this, 'Ec2AsgRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });
    props.dataStack.dbSecret.grantRead(role);

    const sg = new ec2.SecurityGroup(this, 'Ec2AsgSg', {
      vpc, allowAllOutbound: true,
      securityGroupName: `bg-ec2asg-${this.color}-sg`,
    });
    sg.addIngressRule(bundle.alb.connections.securityGroups[0], ec2.Port.tcp(80), 'ALB to instance');
    props.dataStack.dbSecurityGroup.addIngressRule(sg, ec2.Port.tcp(3306), 'EC2 ASG to Aurora');
    props.dataStack.redisSecurityGroup.addIngressRule(sg, ec2.Port.tcp(6379), 'EC2 ASG to Redis');

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euxo pipefail',
      'dnf install -y docker',
      'systemctl enable --now docker',
      `aws ecr get-login-password --region ${this.region} | docker login --username AWS --password-stdin ${this.account}.dkr.ecr.${this.region}.amazonaws.com`,
      `DB_PASS=$(aws secretsmanager get-secret-value --region ${this.region} --secret-id ${props.dataStack.dbSecret.secretArn} --query SecretString --output text | python3 -c 'import sys,json;print(json.load(sys.stdin)["password"])')`,
      `docker run -d --restart=always --name app -p 80:${LAB_CONFIG.compute.appPort} \\`,
      `  -e COLOR=${this.color} \\`,
      '  -e COMPUTE_TYPE=ec2-asg \\',
      `  -e REDIS_URL=rediss://${props.dataStack.redisReplicationGroup.attrPrimaryEndPointAddress}:6379 \\`,
      `  -e DB_HOST=${props.dataStack.auroraCluster.clusterEndpoint.hostname} \\`,
      `  -e DB_USER=${LAB_CONFIG.data.dbUser} \\`,
      `  -e DB_NAME=${LAB_CONFIG.data.dbName} \\`,
      `  -e AWS_REGION=${this.region} \\`,
      '  -e DB_PASSWORD="$DB_PASS" \\',
      `  ${this.imageUri}`,
    );

    const lt = new ec2.LaunchTemplate(this, 'Ec2AsgLt', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.XLARGE),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      role,
      securityGroup: sg,
      userData,
    });

    const asg = new autoscaling.AutoScalingGroup(this, 'Ec2Asg', {
      vpc, vpcSubnets: { subnets: this.computeSubnets },
      launchTemplate: lt,
      desiredCapacity: LAB_CONFIG.compute.asgDesired,
      minCapacity: LAB_CONFIG.compute.asgMin,
      maxCapacity: LAB_CONFIG.compute.asgMax,
      healthCheck: autoscaling.HealthCheck.elb({ grace: cdk.Duration.minutes(5) }),
      autoScalingGroupName: `bg-ec2asg-${this.color}`,
    });
    bundle.tg.addTarget(asg);
  }

  private attachEcsEc2(bundle: AlbBundle, props: BgTestComputeStackProps) {
    const vpc = props.networkStack.vpc;
    const cluster = props.clusterStack.cluster;

    const hostRole = new iam.Role(this, 'EcsHostRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    const hostSg = new ec2.SecurityGroup(this, 'EcsHostSg', {
      vpc, allowAllOutbound: true, securityGroupName: `bg-ecsec2-host-${this.color}-sg`,
    });
    hostSg.addIngressRule(bundle.alb.connections.securityGroups[0], ec2.Port.tcpRange(32768, 65535), 'ALB to ECS host dynamic ports');
    props.dataStack.dbSecurityGroup.addIngressRule(hostSg, ec2.Port.tcp(3306), 'ECS-EC2 to Aurora');
    props.dataStack.redisSecurityGroup.addIngressRule(hostSg, ec2.Port.tcp(6379), 'ECS-EC2 to Redis');

    const hostUserData = ec2.UserData.forLinux();
    hostUserData.addCommands(`echo "ECS_CLUSTER=${cluster.clusterName}" >> /etc/ecs/ecs.config`);

    const hostLt = new ec2.LaunchTemplate(this, 'EcsHostLt', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.XLARGE),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2023(ecs.AmiHardwareType.ARM),
      role: hostRole,
      securityGroup: hostSg,
      userData: hostUserData,
    });

    const hostAsg = new autoscaling.AutoScalingGroup(this, 'EcsHostAsg', {
      vpc, vpcSubnets: { subnets: this.computeSubnets },
      launchTemplate: hostLt,
      desiredCapacity: LAB_CONFIG.compute.ecsHostAsgDesired,
      minCapacity: LAB_CONFIG.compute.ecsHostAsgMin,
      maxCapacity: LAB_CONFIG.compute.ecsHostAsgMax,
      autoScalingGroupName: `bg-ecsec2-host-${this.color}`,
    });

    const cp = new ecs.AsgCapacityProvider(this, 'EcsCp', {
      autoScalingGroup: hostAsg,
      capacityProviderName: `ec2-cp-${this.color}`,
      enableManagedTerminationProtection: false,
      enableManagedScaling: true,
      targetCapacityPercent: 100,
    });
    cluster.addAsgCapacityProvider(cp);

    const taskRole = new iam.Role(this, 'EcsEc2TaskRole', { assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com') });
    const execRole = new iam.Role(this, 'EcsEc2ExecRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')],
    });
    props.dataStack.dbSecret.grantRead(execRole);
    props.ecrStack.repository.grantPull(execRole);

    const td = new ecs.Ec2TaskDefinition(this, 'EcsEc2Td', {
      networkMode: ecs.NetworkMode.BRIDGE,
      taskRole, executionRole: execRole,
      family: `bg-ecsec2-${this.color}`,
    });
    const logs1 = new logs.LogGroup(this, 'EcsEc2Logs', { logGroupName: `/ecs/bg-ecsec2-${this.color}`, retention: logs.RetentionDays.ONE_WEEK, removalPolicy: cdk.RemovalPolicy.DESTROY });
    const container = td.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(props.ecrStack.repository, this.imageTag),
      memoryLimitMiB: 1024,
      essential: true,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app', logGroup: logs1 }),
      environment: this.appEnvironment(props, 'ecs-ec2'),
      secrets: { DB_PASSWORD: ecs.Secret.fromSecretsManager(props.dataStack.dbSecret, 'password') },
    });
    container.addPortMappings({ containerPort: LAB_CONFIG.compute.appPort, hostPort: 0, protocol: ecs.Protocol.TCP });

    const svc = new ecs.Ec2Service(this, 'EcsEc2Svc', {
      cluster, taskDefinition: td, desiredCount: 2,
      capacityProviderStrategies: [{ capacityProvider: cp.capacityProviderName, weight: 1 }],
      serviceName: `bg-ecsec2-${this.color}`,
    });
    bundle.tg.addTarget(svc.loadBalancerTarget({ containerName: 'app', containerPort: LAB_CONFIG.compute.appPort }));
  }

  private attachEcsFargate(bundle: AlbBundle, props: BgTestComputeStackProps) {
    const vpc = props.networkStack.vpc;
    const cluster = props.clusterStack.cluster;

    const sg = new ec2.SecurityGroup(this, 'EcsFgSg', {
      vpc, allowAllOutbound: true, securityGroupName: `bg-ecsfg-task-${this.color}-sg`,
    });
    sg.addIngressRule(bundle.alb.connections.securityGroups[0], ec2.Port.tcp(LAB_CONFIG.compute.appPort), 'ALB to Fargate task');
    props.dataStack.dbSecurityGroup.addIngressRule(sg, ec2.Port.tcp(3306), 'Fargate to Aurora');
    props.dataStack.redisSecurityGroup.addIngressRule(sg, ec2.Port.tcp(6379), 'Fargate to Redis');

    const taskRole = new iam.Role(this, 'EcsFgTaskRole', { assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com') });
    const execRole = new iam.Role(this, 'EcsFgExecRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')],
    });
    props.dataStack.dbSecret.grantRead(execRole);
    props.ecrStack.repository.grantPull(execRole);

    const td = new ecs.FargateTaskDefinition(this, 'EcsFgTd', {
      cpu: LAB_CONFIG.compute.fargateCpu,
      memoryLimitMiB: LAB_CONFIG.compute.fargateMemory,
      taskRole, executionRole: execRole,
      family: `bg-ecsfg-${this.color}`,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    const logsFg = new logs.LogGroup(this, 'EcsFgLogs', { logGroupName: `/ecs/bg-ecsfg-${this.color}`, retention: logs.RetentionDays.ONE_WEEK, removalPolicy: cdk.RemovalPolicy.DESTROY });
    const container = td.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(props.ecrStack.repository, this.imageTag),
      essential: true,
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app', logGroup: logsFg }),
      environment: this.appEnvironment(props, 'ecs-fargate'),
      secrets: { DB_PASSWORD: ecs.Secret.fromSecretsManager(props.dataStack.dbSecret, 'password') },
    });
    container.addPortMappings({ containerPort: LAB_CONFIG.compute.appPort });

    const svc = new ecs.FargateService(this, 'EcsFgSvc', {
      cluster, taskDefinition: td, desiredCount: 2,
      capacityProviderStrategies: [{ capacityProvider: 'FARGATE', weight: 1 }],
      vpcSubnets: { subnets: this.computeSubnets },
      securityGroups: [sg],
      assignPublicIp: false,
      serviceName: `bg-ecsfg-${this.color}`,
    });
    svc.attachToApplicationTargetGroup(bundle.tg);
  }

  private appEnvironment(props: BgTestComputeStackProps, computeType: string): Record<string, string> {
    return {
      COLOR: this.color,
      COMPUTE_TYPE: computeType,
      REDIS_URL: `rediss://${props.dataStack.redisReplicationGroup.attrPrimaryEndPointAddress}:6379`,
      DB_HOST: props.dataStack.auroraCluster.clusterEndpoint.hostname,
      DB_USER: LAB_CONFIG.data.dbUser,
      DB_NAME: LAB_CONFIG.data.dbName,
      AWS_REGION: this.region,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/compute-stack.test.ts`
Expected: PASS 8/8.

If failures: read error messages carefully and adjust. Common issues: target group port (test expects port 80 for instance, port 3000 for ip), listener default action shape, ASG sizing strings.

- [ ] **Step 5: Commit**

```bash
git add lib/compute-stack.ts test/compute-stack.test.ts
git commit -m "feat: add BgTestComputeStack with 3 ALBs, EC2 ASG, ECS EC2/Fargate services"
```

---

## Task 8: CloudFront Stack (1 distribution + 3 origins + 4 behaviors)

**Files:**
- Create: `lib/cf-stack.ts`
- Create: `test/cf-stack.test.ts`

- [ ] **Step 1: Write failing test**

`test/cf-stack.test.ts`:

```typescript
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BgTestNetworkStack } from '../lib/network-stack';
import { BgTestDataStack } from '../lib/data-stack';
import { BgTestEcrStack } from '../lib/ecr-stack';
import { BgTestClusterStack } from '../lib/cluster-stack';
import { BgTestComputeStack } from '../lib/compute-stack';
import { BgTestCfStack } from '../lib/cf-stack';

function synthCf(activeColor: 'blue' | 'green' = 'blue') {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'ap-northeast-2' };
  const network = new BgTestNetworkStack(app, 'Net', { env, includeSecondaryCidr: false });
  const data = new BgTestDataStack(app, 'Data', { env, networkStack: network });
  const ecr = new BgTestEcrStack(app, 'Ecr', { env });
  const cluster = new BgTestClusterStack(app, 'Cluster', { env, networkStack: network });
  const blue = new BgTestComputeStack(app, 'Blue', {
    env, color: 'blue', computeSubnetGroup: 'private1',
    networkStack: network, dataStack: data, ecrStack: ecr, clusterStack: cluster,
    cloudFrontPrefixListId: 'pl-22a6434b',
  });
  const cf = new BgTestCfStack(app, 'Cf', {
    env, activeColor, blueStack: blue,
  });
  return Template.fromStack(cf);
}

describe('BgTestCfStack', () => {
  it('creates exactly 1 CloudFront distribution', () => {
    const t = synthCf();
    t.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  it('configures 3 origins with custom X-Custom-Secret headers', () => {
    const t = synthCf();
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: Match.arrayWith([
          Match.objectLike({ CustomHeaders: Match.arrayWith([Match.objectLike({ HeaderName: 'X-Custom-Secret' })]) }),
        ]),
      }),
    });
  });

  it('configures 3 cache behaviors plus default behavior', () => {
    const t = synthCf();
    const dists = t.findResources('AWS::CloudFront::Distribution');
    const dist: any = Object.values(dists)[0];
    expect(dist.Properties.DistributionConfig.CacheBehaviors).toHaveLength(3);
    const paths = dist.Properties.DistributionConfig.CacheBehaviors.map((b: any) => b.PathPattern).sort();
    expect(paths).toEqual(['/ec2-asg/*', '/ecs-ec2/*', '/ecs-fg/*']);
  });

  it('sets viewer protocol policy to redirect-to-https on default behavior', () => {
    const t = synthCf();
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
      }),
    });
  });
});
```

- [ ] **Step 2: Run test → fail**

Run: `npm test -- test/cf-stack.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement lib/cf-stack.ts**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import { commonTags } from './config';
import { BgTestComputeStack } from './compute-stack';

export interface BgTestCfStackProps extends cdk.StackProps {
  activeColor: 'blue' | 'green';
  blueStack: BgTestComputeStack;
  greenStack?: BgTestComputeStack;
}

export class BgTestCfStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: BgTestCfStackProps) {
    super(scope, id, props);

    const active = props.activeColor === 'green' && props.greenStack ? props.greenStack : props.blueStack;

    const baseBehavior: Omit<cloudfront.BehaviorOptions, 'origin'> = {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
    };

    const ec2asgOrigin = new origins.HttpOrigin(active.ec2AsgAlb.loadBalancerDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      customHeaders: { 'X-Custom-Secret': active.ec2AsgSecret },
      readTimeout: cdk.Duration.seconds(30),
    });
    const ecsec2Origin = new origins.HttpOrigin(active.ecsEc2Alb.loadBalancerDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      customHeaders: { 'X-Custom-Secret': active.ecsEc2Secret },
      readTimeout: cdk.Duration.seconds(30),
    });
    const ecsfgOrigin = new origins.HttpOrigin(active.ecsFgAlb.loadBalancerDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      customHeaders: { 'X-Custom-Secret': active.ecsFgSecret },
      readTimeout: cdk.Duration.seconds(30),
    });

    this.distribution = new cloudfront.Distribution(this, 'Cf', {
      comment: `bg-test-cf (active=${props.activeColor})`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: { origin: ec2asgOrigin, ...baseBehavior },
      additionalBehaviors: {
        '/ec2-asg/*': { origin: ec2asgOrigin, ...baseBehavior },
        '/ecs-ec2/*': { origin: ecsec2Origin, ...baseBehavior },
        '/ecs-fg/*':  { origin: ecsfgOrigin,  ...baseBehavior },
      },
    });
    cdk.Tags.of(this.distribution).add('Name', 'bg-cf');
    Object.entries(commonTags()).forEach(([k, v]) => cdk.Tags.of(this.distribution).add(k, v));

    new cdk.CfnOutput(this, 'CfDomain', {
      value: `https://${this.distribution.distributionDomainName}`,
      exportName: 'BgTestCfDomain',
    });
    new cdk.CfnOutput(this, 'ActiveColor', {
      value: props.activeColor,
      exportName: 'BgTestActiveColor',
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/cf-stack.test.ts`
Expected: PASS 4/4.

- [ ] **Step 5: Commit**

```bash
git add lib/cf-stack.ts test/cf-stack.test.ts
git commit -m "feat: add BgTestCfStack with 3 origins, 4 behaviors, X-Custom-Secret headers"
```

---

## Task 9: Entry Point (bin/app.ts)

**Files:**
- Modify: `bin/app.ts` (replace placeholder)
- Create: `test/app-synth.test.ts`

- [ ] **Step 1: Write integration test that synthesizes the whole app via cdk synth**

`test/app-synth.test.ts`:

```typescript
import { execSync } from 'child_process';

describe('cdk synth (full app)', () => {
  it('synthesizes default context (Blue only) without error', () => {
    const out = execSync('npx cdk synth --quiet 2>&1', { encoding: 'utf-8' });
    expect(out).not.toMatch(/error/i);
  });

  it('synthesizes with includeSecondaryCidr=true without error', () => {
    const out = execSync('npx cdk synth --quiet --context includeSecondaryCidr=true 2>&1', { encoding: 'utf-8' });
    expect(out).not.toMatch(/error/i);
  });

  it('synthesizes with includeGreen=true and activeColor=green without error', () => {
    const out = execSync('npx cdk synth --quiet --context includeSecondaryCidr=true --context includeGreen=true --context activeColor=green 2>&1', { encoding: 'utf-8' });
    expect(out).not.toMatch(/error/i);
  });
});
```

- [ ] **Step 2: Replace bin/app.ts**

```typescript
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

const blue = new BgTestComputeStack(app, 'BgTestBlueStack', {
  env, color: 'blue', computeSubnetGroup: 'private1',
  networkStack: network, dataStack: data, ecrStack: ecr, clusterStack: cluster,
  cloudFrontPrefixListId,
});
blue.addDependency(network); blue.addDependency(data); blue.addDependency(ecr); blue.addDependency(cluster);

let green: BgTestComputeStack | undefined;
if (includeGreen) {
  green = new BgTestComputeStack(app, 'BgTestGreenStack', {
    env, color: 'green', computeSubnetGroup: 'private2',
    networkStack: network, dataStack: data, ecrStack: ecr, clusterStack: cluster,
    cloudFrontPrefixListId,
  });
  green.addDependency(network); green.addDependency(data); green.addDependency(ecr); green.addDependency(cluster);
}

const cf = new BgTestCfStack(app, 'BgTestCfStack', { env, activeColor, blueStack: blue, greenStack: green });
cf.addDependency(blue);
if (green) cf.addDependency(green);

app.synth();
```

- [ ] **Step 3: Run synth integration test**

Run: `npm test -- test/app-synth.test.ts`
Expected: PASS 3/3 (each takes ~10-20s due to full CFN synth).

- [ ] **Step 4: Run all tests as a final check**

Run: `npm test`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add bin/app.ts test/app-synth.test.ts
git commit -m "feat: add bin/app.ts orchestrating all stacks with context-based scenario branching"
```

---

## Task 10: Express Application (app/server.js)

**Files:**
- Create: `app/package.json`
- Create: `app/server.js`
- Create: `app/test/server.test.js`
- Create: `app/.dockerignore`

- [ ] **Step 1: Create app/package.json**

```json
{
  "name": "bg-app",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node --test test/server.test.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "ioredis": "^5.4.1",
    "mysql2": "^3.11.0"
  }
}
```

- [ ] **Step 2: Install app deps**

```bash
cd /home/ec2-user/my-project/ecs-blue-green/app && npm install
```

- [ ] **Step 3: Write failing test (covers /health and /info endpoints)**

`app/test/server.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.COLOR = 'blue';
process.env.COMPUTE_TYPE = 'ec2-asg';
process.env.PORT = '0';
process.env.SKIP_DEPS = '1';

const { createApp } = require('../server.js');

function request(app, path) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = server.address().port;
      http.get(`http://127.0.0.1:${port}${path}`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body }); });
      }).on('error', (e) => { server.close(); reject(e); });
    });
  });
}

test('GET /health returns 200 with color and compute', async () => {
  const r = await request(createApp(), '/health');
  assert.strictEqual(r.status, 200);
  const j = JSON.parse(r.body);
  assert.strictEqual(j.status, 'healthy');
  assert.strictEqual(j.color, 'blue');
  assert.strictEqual(j.compute, 'ec2-asg');
});

test('GET /info returns json with color, compute, hostname', async () => {
  const r = await request(createApp(), '/info');
  assert.strictEqual(r.status, 200);
  const j = JSON.parse(r.body);
  assert.strictEqual(j.color, 'blue');
  assert.strictEqual(j.compute, 'ec2-asg');
  assert.ok(typeof j.hostname === 'string');
});

test('GET / returns HTML page styled by color', async () => {
  const r = await request(createApp(), '/');
  assert.strictEqual(r.status, 200);
  assert.match(r.body, /<html/);
  assert.match(r.body, /BLUE/);
});
```

- [ ] **Step 4: Run test → fail (server.js missing)**

```bash
cd app && node --test test/server.test.js
```

Expected: FAIL.

- [ ] **Step 5: Implement app/server.js**

```javascript
const express = require('express');
const os = require('node:os');
const Redis = require('ioredis');
const mysql = require('mysql2/promise');

const COLOR = process.env.COLOR ?? 'blue';
const COMPUTE_TYPE = process.env.COMPUTE_TYPE ?? 'unknown';
const REDIS_URL = process.env.REDIS_URL ?? '';
const DB_HOST = process.env.DB_HOST ?? '';
const DB_USER = process.env.DB_USER ?? 'admin';
const DB_PASSWORD = process.env.DB_PASSWORD ?? '';
const DB_NAME = process.env.DB_NAME ?? 'bgtest';
const SKIP_DEPS = process.env.SKIP_DEPS === '1';

let redis = null;
let dbPool = null;

if (!SKIP_DEPS) {
  if (REDIS_URL) {
    redis = new Redis(REDIS_URL, { tls: REDIS_URL.startsWith('rediss://') ? {} : undefined, lazyConnect: true });
    redis.connect().catch((e) => console.error('redis connect:', e.message));
  }
  if (DB_HOST) {
    dbPool = mysql.createPool({ host: DB_HOST, user: DB_USER, password: DB_PASSWORD, database: DB_NAME, connectionLimit: 5 });
  }
}

function createApp() {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', color: COLOR, compute: COMPUTE_TYPE });
  });

  app.get('/info', async (_req, res) => {
    let redisHits = null;
    let dbPingMs = null;
    try { if (redis) redisHits = Number(await redis.get(`visits:${COLOR}`)) || 0; } catch (_) {}
    try {
      if (dbPool) {
        const t0 = Date.now();
        await dbPool.query('SELECT 1');
        dbPingMs = Date.now() - t0;
      }
    } catch (_) {}
    res.json({
      color: COLOR, compute: COMPUTE_TYPE,
      hostname: os.hostname(), redisHits, dbPingMs,
    });
  });

  app.get('/redis/hit', async (_req, res) => {
    try {
      if (!redis) return res.status(503).json({ error: 'redis unavailable' });
      const v = await redis.incr(`visits:${COLOR}`);
      res.json({ visits: v, color: COLOR });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/db/ping', async (_req, res) => {
    try {
      if (!dbPool) return res.status(503).json({ error: 'db unavailable' });
      const [rows] = await dbPool.query('SELECT NOW() AS t, @@hostname AS h');
      res.json({ rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/', (_req, res) => {
    const bg = COLOR === 'green' ? '#43a047' : '#1e88e5';
    const label = COLOR.toUpperCase();
    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>${label} - ${COMPUTE_TYPE}</title>
<style>
body { margin:0; font-family:system-ui,sans-serif; background:${bg}; color:#fff; min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; }
h1 { font-size:8rem; margin:0; letter-spacing:.1em; }
.meta { margin-top:2rem; font-size:1.2rem; opacity:.9; }
.meta div { margin:.3rem 0; }
</style></head>
<body>
<h1>${label}</h1>
<div class="meta">
  <div>compute: <strong>${COMPUTE_TYPE}</strong></div>
  <div>host: <span id="host">…</span></div>
  <div>redis hits: <span id="hits">…</span></div>
  <div>db ping: <span id="db">…</span> ms</div>
</div>
<script>
fetch('/info').then(r=>r.json()).then(j=>{
  document.getElementById('host').textContent = j.hostname;
  document.getElementById('hits').textContent = j.redisHits ?? 'n/a';
  document.getElementById('db').textContent = j.dbPingMs ?? 'n/a';
});
</script>
</body></html>`);
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`[${COLOR}/${COMPUTE_TYPE}] listening on :${port}`));
}

module.exports = { createApp };
```

- [ ] **Step 6: Run test → pass**

```bash
cd app && node --test test/server.test.js
```

Expected: PASS 3/3.

- [ ] **Step 7: Create app/.dockerignore**

```
node_modules
test
*.log
.env
.dockerignore
Dockerfile
```

- [ ] **Step 8: Commit**

```bash
git add app/
git commit -m "feat: add Express app with /health, /info, /redis/hit, /db/ping, / HTML"
```

---

## Task 11: Dockerfile + Build/Push Script

**Files:**
- Create: `app/Dockerfile`
- Create: `scripts/build-and-push.sh`

- [ ] **Step 1: Create app/Dockerfile (multi-stage, ARM64)**

```dockerfile
FROM --platform=linux/arm64 node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM --platform=linux/arm64 node:20-alpine AS runtime
RUN addgroup -g 1001 nodejs && adduser -D -G nodejs -u 1001 nodejs
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY server.js package.json ./
USER nodejs
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 2: Create scripts/build-and-push.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail
COLOR="${1:-blue}"
REGION="${AWS_REGION:-ap-northeast-2}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ECR_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/bg-app"

echo "[build-and-push] color=${COLOR} region=${REGION} ecr=${ECR_URI}"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

docker buildx build --platform linux/arm64 --load \
  -t "bg-app:${COLOR}" \
  -f app/Dockerfile app/

docker tag "bg-app:${COLOR}" "${ECR_URI}:${COLOR}"
docker push "${ECR_URI}:${COLOR}"

echo "[build-and-push] pushed ${ECR_URI}:${COLOR}"
```

- [ ] **Step 3: Make script executable + smoke test syntax**

```bash
chmod +x scripts/build-and-push.sh
bash -n scripts/build-and-push.sh
```

Expected: no output (syntax OK).

- [ ] **Step 4: Commit**

```bash
git add app/Dockerfile scripts/build-and-push.sh
git commit -m "feat: add ARM64 Dockerfile and ECR build/push script"
```

---

## Task 12: Demo shared.sh + launcher.sh

**Files:**
- Create: `demos/shared.sh`
- Create: `demos/launcher.sh`

- [ ] **Step 1: Create demos/shared.sh (color + utility functions)**

```bash
#!/usr/bin/env bash
# Shared functions for bg-test demo scripts. source this file.

R='\033[0;31m'; G='\033[0;32m'; Y='\033[0;33m'; B='\033[0;34m'
M='\033[0;35m'; C='\033[0;36m'; W='\033[1;37m'; D='\033[0;90m'
BG_B='\033[44m'; BG_G='\033[42m'; BG_R='\033[41m'; BG_Y='\033[43m'
BG_M='\033[45m'; BG_C='\033[46m'; BG_D='\033[100m'
RESET='\033[0m'; BOLD='\033[1m'

COLS=$(tput cols 2>/dev/null || echo 80)

hr() {
  local ch="${1:--}" color="${2:-$D}"
  printf '%b' "$color"
  for ((i=0; i<COLS; i++)); do printf '%s' "$ch"; done
  printf '%b\n' "$RESET"
}

center() {
  local text="$1" pad
  pad=$(( (COLS - ${#text}) / 2 ))
  [ "$pad" -lt 0 ] && pad=0
  printf '%*s%s\n' "$pad" '' "$text"
}

typewrite() {
  local text="$1" delay="${2:-0.02}"
  for ((i=0; i<${#text}; i++)); do
    printf '%s' "${text:$i:1}"
    sleep "$delay"
  done
}

spinner() {
  local pid=$1 msg="${2:-Working}"
  local frames=('|' '/' '-' '\')
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${C}${frames[$i]}${RESET} ${msg}..."
    i=$(( (i+1) % 4 ))
    sleep 0.1
  done
  printf "\r  ${G}[OK]${RESET} ${msg}   \n"
}

anim_bar() {
  local pct=$1 width=40 color="${2:-$G}" label="${3:-}"
  local filled=$(( pct * width / 100 ))
  local empty=$(( width - filled ))
  printf "  ${D}%3d%%${RESET} ${color}" "$pct"
  for ((j=0; j<filled; j++)); do printf '#'; done
  printf "${D}"
  for ((j=0; j<empty; j++)); do printf '.'; done
  printf "${RESET}"
  [ -n "$label" ] && printf " ${D}%s${RESET}" "$label"
  printf '\n'
}

pause_key() {
  echo
  echo -ne "  ${D}Press Enter to continue...${RESET}"
  read -r
}

print_step() {
  local n="$1" total="$2" title="$3"
  clear
  echo
  printf '  %b STEP %s/%s %b  %b%s%b\n' "$BG_M$W$BOLD" "$n" "$total" "$RESET" "$W$BOLD" "$title" "$RESET"
  hr '-' "$D"
  echo
}

cdk_deploy() {
  local stacks="$1" extra_ctx="${2:-}"
  echo "  ${C}\$ npx cdk deploy ${stacks} ${extra_ctx} --require-approval never${RESET}"
  npx cdk deploy ${stacks} ${extra_ctx} --require-approval never
}

fetch_active_color() {
  aws cloudformation describe-stacks --stack-name BgTestCfStack \
    --query "Stacks[0].Outputs[?OutputKey=='ActiveColor'].OutputValue" --output text 2>/dev/null \
    || echo "(not deployed)"
}

fetch_cf_url() {
  aws cloudformation describe-stacks --stack-name BgTestCfStack \
    --query "Stacks[0].Outputs[?OutputKey=='CfDomain'].OutputValue" --output text 2>/dev/null \
    || echo "(not deployed)"
}
```

- [ ] **Step 2: Create demos/launcher.sh**

```bash
#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared.sh"

draw_menu() {
  clear
  echo
  printf '%b' "$B$BOLD"
  cat <<'LOGO'
   ██████╗  ██████╗     ████████╗███████╗███████╗████████╗
   ██╔══██╗██╔════╝     ╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝
   ██████╔╝██║  ███╗       ██║   █████╗  ███████╗   ██║
   ██╔══██╗██║   ██║       ██║   ██╔══╝  ╚════██║   ██║
   ██████╔╝╚██████╔╝       ██║   ███████╗███████║   ██║
   ╚═════╝  ╚═════╝        ╚═╝   ╚══════╝╚══════╝   ╚═╝
LOGO
  printf '%b' "$RESET"
  echo
  center "B L U E   /   G R E E N   T E S T"
  echo

  local active cf
  active=$(fetch_active_color)
  cf=$(fetch_cf_url)

  hr '=' "$W$BOLD"
  printf "  %bCF URL%b : %s\n" "$BOLD" "$RESET" "$cf"
  printf "  %bActive%b : %s\n" "$BOLD" "$RESET" "$active"
  hr '=' "$W$BOLD"
  echo

  printf '  %b%b [1] %b  %bDeploy Blue Infrastructure%b      %bPhase 1%b\n' "$BOLD" "$BG_B$W" "$RESET" "$W$BOLD" "$RESET" "$D" "$RESET"
  printf '  %b%b [2] %b  %bAdd VPC Secondary CIDR%b          %bPhase 1%b\n' "$BOLD" "$BG_C$W" "$RESET" "$W$BOLD" "$RESET" "$D" "$RESET"
  printf '  %b%b [3] %b  %bDeploy Green & Switch%b           %b(Phase 2 - 추후)%b\n' "$BOLD" "$BG_G$W" "$RESET" "$D" "$RESET" "$D" "$RESET"
  printf '  %b%b [4] %b  %bRollback to Blue%b                %b(Phase 2 - 추후)%b\n' "$BOLD" "$BG_Y$W" "$RESET" "$D" "$RESET" "$D" "$RESET"
  echo
  printf '  %b [q] %b  Quit\n' "$BG_R$W$BOLD" "$RESET"
  echo
  hr '=' "$W$BOLD"
  echo
}

run_scenario() {
  local script="$1"
  echo
  bash "$SCRIPT_DIR/$script"
  echo
  echo -ne "  ${D}Press Enter to return to menu...${RESET}"
  read -r
}

trap 'echo; exit 0' INT
while true; do
  draw_menu
  printf '  %bSelect [1-4, q]: %b ' "$W$BOLD" "$RESET"
  read -r choice
  case "$choice" in
    1) run_scenario "scenario1-deploy-blue.sh" ;;
    2) run_scenario "scenario2-add-secondary-cidr.sh" ;;
    3) echo "Phase 2 — 추후 구현"; sleep 2 ;;
    4) echo "Phase 2 — 추후 구현"; sleep 2 ;;
    q|Q) echo; exit 0 ;;
    *) echo "Invalid"; sleep 1 ;;
  esac
done
```

- [ ] **Step 3: Make scripts executable + syntax check**

```bash
chmod +x demos/shared.sh demos/launcher.sh
bash -n demos/shared.sh
bash -n demos/launcher.sh
```

Expected: no output (both syntactically valid).

- [ ] **Step 4: Commit**

```bash
git add demos/shared.sh demos/launcher.sh
git commit -m "feat: add demo shared.sh utilities and launcher.sh menu"
```

---

## Task 13: Demo Scenario 1 (Deploy Blue)

**Files:**
- Create: `demos/scenario1-deploy-blue.sh`

- [ ] **Step 1: Create scenario1-deploy-blue.sh**

```bash
#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/shared.sh"

cd "$ROOT_DIR"

# ── Banner ──
clear
echo
printf '%b' "$B$BOLD"
center "SCENARIO 1: Deploy Blue Infrastructure"
printf '%b' "$RESET"
echo
hr '=' "$W$BOLD"
echo
printf "  %bAccount%b : %s\n" "$BOLD" "$RESET" "$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo unknown)"
printf "  %bRegion%b  : %s\n" "$BOLD" "$RESET" "${AWS_REGION:-ap-northeast-2}"
echo
pause_key

# ── STEP 1/5: Pre-flight ──
print_step 1 5 "Pre-flight Check"
typewrite "AWS account / region / CDK / Docker 사전 확인" 0.01
echo; echo
aws sts get-caller-identity > /dev/null && echo "  ${G}[OK]${RESET} AWS credentials"
command -v docker > /dev/null && echo "  ${G}[OK]${RESET} docker"
npx --yes cdk --version > /dev/null && echo "  ${G}[OK]${RESET} cdk"

CF_PL=$(aws ec2 describe-managed-prefix-lists \
  --filters "Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing" \
  --query "PrefixLists[0].PrefixListId" --output text 2>/dev/null)
echo "  ${G}[OK]${RESET} CloudFront prefix list: $CF_PL"
pause_key

# ── STEP 2/5: CDK Bootstrap ──
print_step 2 5 "CDK Bootstrap (idempotent)"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION="${AWS_REGION:-ap-northeast-2}"
typewrite "npx cdk bootstrap aws://${ACCOUNT}/${REGION}" 0.01
echo
npx cdk bootstrap "aws://${ACCOUNT}/${REGION}"
pause_key

# ── STEP 3/5: Deploy Foundation (Network + Ecr) ──
print_step 3 5 "Deploy Foundation (Network + Ecr)"
cdk_deploy "BgTestNetworkStack BgTestEcrStack" "--context cloudFrontPrefixListId=${CF_PL}"
pause_key

# ── STEP 4/5: Build & Push App Image (Blue) ──
print_step 4 5 "Build & Push App Image (Blue)"
anim_bar 10 "$C" "Docker build starting"
"$ROOT_DIR/scripts/build-and-push.sh" blue
anim_bar 100 "$G" "Image pushed"
pause_key

# ── STEP 5/5: Deploy Data + Cluster + Blue + Cf ──
print_step 5 5 "Deploy Data + Cluster + Blue + CloudFront"
cdk_deploy "BgTestDataStack BgTestClusterStack BgTestBlueStack BgTestCfStack" "--context cloudFrontPrefixListId=${CF_PL}"

CF_URL=$(fetch_cf_url)
echo
hr '=' "$G$BOLD"
echo
printf "  %b✓ DEPLOYMENT COMPLETE%b\n" "$G$BOLD" "$RESET"
printf "  %bCF URL%b: %s\n" "$BOLD" "$RESET" "$CF_URL"
echo

echo "  ${C}— Smoke tests —${RESET}"
for path in "/ec2-asg/info" "/ecs-ec2/info" "/ecs-fg/info"; do
  echo "  curl ${CF_URL}${path}"
  curl -s --max-time 10 "${CF_URL}${path}" || echo "  (CloudFront still propagating, retry in ~3 min)"
  echo
done
echo
hr '=' "$G$BOLD"
```

- [ ] **Step 2: Make executable + syntax check**

```bash
chmod +x demos/scenario1-deploy-blue.sh
bash -n demos/scenario1-deploy-blue.sh
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add demos/scenario1-deploy-blue.sh
git commit -m "feat: add scenario1 - deploy Blue infrastructure with 5-step demo flow"
```

---

## Task 14: Demo Scenario 2 (VPC Secondary CIDR)

**Files:**
- Create: `demos/scenario2-add-secondary-cidr.sh`

- [ ] **Step 1: Create scenario2 script**

```bash
#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/shared.sh"

cd "$ROOT_DIR"

# ── Banner ──
clear
echo
printf '%b' "$C$BOLD"
center "SCENARIO 2: Add VPC Secondary CIDR + private-2 subnets"
printf '%b' "$RESET"
echo
hr '=' "$W$BOLD"
echo
typewrite "초기 /24 서브넷의 IP 부족을 secondary CIDR (10.1.0.0/16) 추가로 해결" 0.01
echo; echo
pause_key

# ── STEP 1/4: 현재 VPC 상태 ──
print_step 1 4 "현재 VPC 상태 출력"
VPC_ID=$(aws cloudformation describe-stacks --stack-name BgTestNetworkStack \
  --query "Stacks[0].Outputs[?OutputKey=='VpcId'].OutputValue" --output text 2>/dev/null \
  || aws ec2 describe-vpcs --filters "Name=tag:Name,Values=test-vpc" --query "Vpcs[0].VpcId" --output text)

echo "  VPC ID: ${VPC_ID}"
echo
echo "  ${C}현재 CIDR blocks:${RESET}"
aws ec2 describe-vpcs --vpc-ids "$VPC_ID" \
  --query "Vpcs[0].CidrBlockAssociationSet[].[CidrBlock,CidrBlockState.State]" \
  --output table
echo
echo "  ${C}private-1 서브넷의 사용 가능 IP:${RESET}"
aws ec2 describe-subnets --filters "Name=vpc-id,Values=${VPC_ID}" "Name=tag:aws-cdk:subnet-name,Values=private1" \
  --query "Subnets[].[SubnetId,CidrBlock,AvailableIpAddressCount,AvailabilityZone]" --output table
pause_key

# ── STEP 2/4: Secondary CIDR 추가 ──
print_step 2 4 "Secondary CIDR 추가 + private-2 서브넷 생성"
typewrite "cdk deploy BgTestNetworkStack --context includeSecondaryCidr=true" 0.01
echo; echo
cdk_deploy "BgTestNetworkStack" "--context includeSecondaryCidr=true"
pause_key

# ── STEP 3/4: 새 서브넷 정상성 검증 ──
print_step 3 4 "새 서브넷 정상성 검증"
echo "  ${C}변경 후 CIDR blocks:${RESET}"
aws ec2 describe-vpcs --vpc-ids "$VPC_ID" \
  --query "Vpcs[0].CidrBlockAssociationSet[].[CidrBlock,CidrBlockState.State]" --output table
echo
echo "  ${C}private-2 서브넷:${RESET}"
aws ec2 describe-subnets --filters "Name=vpc-id,Values=${VPC_ID}" "Name=cidr-block,Values=10.1.0.0/22,10.1.4.0/22" \
  --query "Subnets[].[SubnetId,CidrBlock,AvailableIpAddressCount,AvailabilityZone]" --output table
echo
echo "  ${C}라우팅 테이블 NAT 연결 확인:${RESET}"
aws ec2 describe-route-tables --filters "Name=vpc-id,Values=${VPC_ID}" \
  --query "RouteTables[?Routes[?contains(@.DestinationCidrBlock || \`\`, '10.1')]].[RouteTableId,Tags[?Key=='Name']|[0].Value]" \
  --output table
pause_key

# ── STEP 4/4: 요약 ──
print_step 4 4 "변경 요약"
hr '=' "$G$BOLD"
echo
printf "  %b✓ Secondary CIDR 10.1.0.0/16 added%b\n" "$G$BOLD" "$RESET"
printf "  %b✓ private-2-a (10.1.0.0/22) created%b\n" "$G$BOLD" "$RESET"
printf "  %b✓ private-2-b (10.1.4.0/22) created%b\n" "$G$BOLD" "$RESET"
echo
printf "  %b다음 단계 (Phase 2): Green stack을 private-2 서브넷에 배포 → CF origin 전환%b\n" "$D" "$RESET"
echo
hr '=' "$G$BOLD"
```

- [ ] **Step 2: Make executable + syntax check**

```bash
chmod +x demos/scenario2-add-secondary-cidr.sh
bash -n demos/scenario2-add-secondary-cidr.sh
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add demos/scenario2-add-secondary-cidr.sh
git commit -m "feat: add scenario2 - VPC secondary CIDR demo with 4-step verification"
```

---

## Task 15: README + Final Synth Verification

**Files:**
- Create: `README.md` (project root)

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: ALL tests pass (config, network, data, ecr, cluster, compute, cf, app-synth).

- [ ] **Step 2: Run cdk synth for all 3 scenarios as final integration check**

```bash
npx cdk synth --quiet
npx cdk synth --quiet --context includeSecondaryCidr=true
npx cdk synth --quiet --context includeSecondaryCidr=true --context includeGreen=true --context activeColor=green
```

Expected: each completes without error, generates CloudFormation in `cdk.out/`.

- [ ] **Step 3: Create README.md**

```markdown
# Blue/Green CDK Test

Phase 1 — Blue 인프라 + VPC secondary CIDR 시나리오 시연용 CDK 프로젝트.

## Quick Start

\`\`\`bash
npm install
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/ap-northeast-2
./demos/launcher.sh
\`\`\`

## Stacks

| Stack | 책임 |
|---|---|
| BgTestNetworkStack | VPC test-vpc, 서브넷, NAT, VPC endpoints |
| BgTestDataStack | Aurora MySQL 8.0/3.08, ElastiCache Redis 7.1 |
| BgTestEcrStack | ECR repo bg-app |
| BgTestClusterStack | ECS cluster test-cluster (단일, Blue/Green 공유) |
| BgTestBlueStack | ALB×3 + EC2 ASG + ECS service×2 (private-1) |
| BgTestCfStack | CloudFront 1 distribution + 3 origins + 4 behaviors |

## Scenarios (demos/launcher.sh)

1. **Deploy Blue Infrastructure** — `scenario1-deploy-blue.sh`
2. **Add VPC Secondary CIDR** — `scenario2-add-secondary-cidr.sh`
3. (Phase 2 추후) Deploy Green + Switch
4. (Phase 2 추후) Rollback to Blue

## CDK Context

| Key | Default | 의미 |
|---|---|---|
| activeColor | blue | CF origin 색상 |
| includeSecondaryCidr | false | 10.1.0.0/16 secondary CIDR 추가 |
| includeGreen | false | GreenStack 배포 |

## Tests

\`\`\`bash
npm test                              # 모든 stack 단위 테스트
npm test -- test/network-stack.test.ts # 특정 stack 테스트
cd app && node --test test/server.test.js  # Express app 테스트
\`\`\`

## Spec / Plan

- 설계: \`docs/superpowers/specs/2026-04-28-bluegreen-cdk-design.md\`
- 구현 계획: \`docs/superpowers/plans/2026-04-28-bluegreen-cdk.md\`

## Cleanup

\`\`\`bash
npx cdk destroy --all
\`\`\`
```

- [ ] **Step 4: Final commit**

```bash
git add README.md
git commit -m "docs: add README with quick start, stack overview, and scenario index"
```

- [ ] **Step 5: Verify final tree**

```bash
git ls-files | sort
```

Expected output includes:
- `README.md`
- `bin/app.ts`
- `cdk.json`, `package.json`, `tsconfig.json`, `jest.config.js`
- `lib/{config,network-stack,data-stack,ecr-stack,cluster-stack,compute-stack,cf-stack}.ts`
- `test/{config,network-stack,data-stack,ecr-stack,cluster-stack,compute-stack,cf-stack,app-synth}.test.ts`
- `app/{server.js,Dockerfile,package.json,.dockerignore}`
- `app/test/server.test.js`
- `scripts/build-and-push.sh`
- `demos/{shared,launcher,scenario1-deploy-blue,scenario2-add-secondary-cidr}.sh`
- `docs/superpowers/specs/2026-04-28-bluegreen-cdk-design.md`
- `docs/superpowers/plans/2026-04-28-bluegreen-cdk.md`

---

## Phase 2 (추후 별도 plan으로 작성)

다음 시나리오는 Blue가 안정적으로 운영된 후 별도 plan으로 추가:

- 시나리오 3: GreenStack 배포 + CF origin Blue→Green 전환
- 시나리오 4: CF origin Green→Blue 롤백
- (옵션) Green 이미지를 Blue와 시각적으로 구분 (현재는 COLOR env로만 구분)
- (옵션) `watch-bluegreen-status.sh` 실시간 모니터

CDK 코드는 이미 GreenStack 분기 (`includeGreen=true`)와 CF origin 색상 전환 (`activeColor=green`)을 지원하므로, Phase 2는 데모 스크립트 작성과 시연 절차 정의 위주.

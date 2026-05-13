# EC2 Rolling ASG Additive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 Blue/Green 시연 자산을 0 라인 수정으로 보존한 채 EC2 단일 ASG + Warm Pool + Instance Refresh 기반의 Rolling Migration 시연을 additive로 추가.

**Architecture:** 신규 `BgTestRollingStack` (ALB + ASG + Warm Pool + LT)과 `BgTestRollingCfStack` (별도 CloudFront)을 만들고, `bin/app.ts`에 `-c includeRolling=true` 조건부 인스턴스화 분기 추가. 시연 스크립트 4개와 launcher 메뉴 섹션 추가. 기존 자원과는 `bg-rolling-*` prefix로 namespace 격리.

**Tech Stack:** AWS CDK v2 (TypeScript), jest + `aws-cdk-lib/assertions` for unit tests, bash + AWS CLI for demo scripts, Express + Redis + Aurora MySQL (앱 변경 최소).

**Spec:** [`docs/superpowers/specs/2026-05-13-rolling-asg-additive-design.md`](../specs/2026-05-13-rolling-asg-additive-design.md)

---

## File Structure

### Files to CREATE

| Path | Responsibility |
|------|----------------|
| `lib/rolling-stack.ts` | ALB + Listener + TG + LaunchTemplate + ASG + Warm Pool + 모든 SG (단일 스택) |
| `lib/rolling-cf-stack.ts` | RollingStack ALB를 origin으로 하는 CloudFront distribution |
| `lib/rolling-context.ts` | `validateRollingContext()` pure 함수 (test하기 쉽도록 분리) |
| `test/rolling-stack.test.ts` | RollingStack synth assertions |
| `test/rolling-cf-stack.test.ts` | RollingCfStack synth assertions |
| `test/rolling-context.test.ts` | validation 함수 unit test |
| `demos/scenario-rolling-1-deploy.sh` | Phase 1 — initial deploy (v1 @ private1) |
| `demos/scenario-rolling-2-refresh.sh` | Phase 2 — LT v2 + subnet 교체 + Instance Refresh |
| `demos/scenario-rolling-3-rollback.sh` | Phase 3 — 역방향 Refresh |
| `demos/watch-rolling.sh` | 6-section live TUI |

### Files to MODIFY

| Path | Change |
|------|--------|
| `bin/app.ts` | `includeRolling`/`rollingLaunchVersion`/`rollingTargetSubnet` context + `validateRollingContext()` 호출 + 조건부 stack 인스턴스화 |
| `app/server.js` | `VERSION` env 추가, `/info` 응답에 `version` 필드 |
| `scripts/build-and-push.sh` | `COLOR` 변수명을 `TAG`로 명료화 (기능 동일) |
| `demos/shared.sh` | Rolling 전용 helper 함수 추가 (기존 함수 0 라인 수정) |
| `demos/launcher.sh` | 신규 메뉴 섹션 (R1~R3, W) 추가, 상단 상태 라인 확장 |

### Files NOT touched

`lib/network-stack.ts`, `lib/data-stack.ts`, `lib/ecr-stack.ts`, `lib/cluster-stack.ts`, `lib/alb-stack.ts`, `lib/compute-stack.ts`, `lib/cf-stack.ts`, `lib/config.ts`, `demos/scenario1-4.sh`, `demos/scenario-progressive-shift.sh`, `demos/scenario-slider.sh`, `demos/watch-bluegreen-traffic.sh`. **이 목록의 git diff는 plan 완료 후 0이어야 함** (Gate A10의 검증 대상).

---

## Phase A — Infrastructure Code (CDK)

### Task A1: Test scaffold for RollingStack

**Files:**
- Create: `test/rolling-stack.test.ts`
- Create: `lib/rolling-stack.ts` (skeleton)

- [ ] **Step 1: Create test file with synthRolling helper and empty describe**

```typescript
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BgTestNetworkStack } from '../lib/network-stack';
import { BgTestDataStack } from '../lib/data-stack';
import { BgTestEcrStack } from '../lib/ecr-stack';
import { BgTestRollingStack } from '../lib/rolling-stack';

function synthRolling(opts: {
  launchVersion?: 'v1' | 'v2';
  targetSubnet?: 'private1' | 'private2';
} = {}) {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'ap-northeast-2' };
  const network = new BgTestNetworkStack(app, 'Net', { env, includeSecondaryCidr: true });
  const data = new BgTestDataStack(app, 'Data', { env, networkStack: network });
  const ecr = new BgTestEcrStack(app, 'Ecr', { env });
  const rolling = new BgTestRollingStack(app, 'Rolling', {
    env,
    networkStack: network,
    dataStack: data,
    ecrStack: ecr,
    cloudFrontPrefixListId: 'pl-22a6434b',
    launchVersion: opts.launchVersion ?? 'v1',
    targetSubnet: opts.targetSubnet ?? 'private1',
  });
  return Template.fromStack(rolling);
}

describe('BgTestRollingStack', () => {
  // tests added in subsequent tasks
});
```

- [ ] **Step 2: Run jest to verify it fails on missing module**

Run: `npx jest test/rolling-stack.test.ts --no-coverage 2>&1 | head -20`

Expected: FAIL — `Cannot find module '../lib/rolling-stack'`

- [ ] **Step 3: Create minimal `lib/rolling-stack.ts` to satisfy import**

```typescript
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
```

- [ ] **Step 4: Run jest to verify empty stack synth succeeds**

Run: `npx jest test/rolling-stack.test.ts --no-coverage`

Expected: PASS (0 assertions yet, just synthesis succeeds)

- [ ] **Step 5: Commit**

```bash
git add lib/rolling-stack.ts test/rolling-stack.test.ts
git commit -m "feat(rolling): scaffold BgTestRollingStack + test helper"
```

---

### Task A2: ALB + Listener + TG with priority-1 rule

**Files:**
- Modify: `lib/rolling-stack.ts`
- Modify: `test/rolling-stack.test.ts`

- [ ] **Step 1: Add ALB/TG/listener assertions to test**

Insert inside `describe('BgTestRollingStack', () => { ... })`:

```typescript
  it('creates exactly 1 ALB (internet-facing)', () => {
    const t = synthRolling();
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internet-facing',
      Name: 'bg-rolling-alb',
    });
  });

  it('creates exactly 1 TG (instance type, port 80, /health check)', () => {
    const t = synthRolling();
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::TargetGroup', 1);
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      Name: 'bg-rolling-tg',
      TargetType: 'instance',
      Port: 80,
      HealthCheckPath: '/health',
    });
  });

  it('creates listener with default 403 fixed-response', () => {
    const t = synthRolling();
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 1);
    const listeners = t.findResources('AWS::ElasticLoadBalancingV2::Listener');
    const def = Object.values(listeners)[0] as any;
    expect(def.Properties.DefaultActions[0].Type).toBe('fixed-response');
    expect(def.Properties.DefaultActions[0].FixedResponseConfig.StatusCode).toBe('403');
  });

  it('creates priority-1 ListenerRule with X-Custom-Secret header and single forward', () => {
    const t = synthRolling();
    t.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 1);
    const rules = t.findResources('AWS::ElasticLoadBalancingV2::ListenerRule');
    const r = Object.values(rules)[0] as any;
    expect(r.Properties.Priority).toBe(1);
    expect(r.Properties.Conditions[0].Field).toBe('http-header');
    expect(r.Properties.Conditions[0].HttpHeaderConfig.HttpHeaderName).toBe('X-Custom-Secret');
    expect(r.Properties.Actions[0].Type).toBe('forward');
    const tgs = r.Properties.Actions[0].ForwardConfig.TargetGroups;
    expect(tgs).toHaveLength(1);
  });
```

- [ ] **Step 2: Run jest to verify failures**

Run: `npx jest test/rolling-stack.test.ts --no-coverage 2>&1 | tail -30`

Expected: 4 FAIL — resource count 0, properties missing.

- [ ] **Step 3: Implement ALB + TG + listener + rule**

Add imports at the top of `lib/rolling-stack.ts`:

```typescript
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
```

Add field declarations inside the class:

```typescript
public readonly alb: elbv2.ApplicationLoadBalancer;
public readonly tg: elbv2.ApplicationTargetGroup;
public readonly secret: string;
public readonly albSg: ec2.SecurityGroup;
```

Replace the constructor body with:

```typescript
super(scope, id, props);
const vpc = props.networkStack.vpc;

const albSg = new ec2.SecurityGroup(this, 'RollingAlbSg', {
  vpc, allowAllOutbound: true,
  securityGroupName: 'bg-rolling-alb-sg',
  description: 'Rolling ALB SG',
});

const alb = new elbv2.ApplicationLoadBalancer(this, 'RollingAlb', {
  vpc, internetFacing: true,
  securityGroup: albSg,
  loadBalancerName: 'bg-rolling-alb',
  vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
});

const tg = new elbv2.ApplicationTargetGroup(this, 'RollingTg', {
  vpc,
  port: 80,
  protocol: elbv2.ApplicationProtocol.HTTP,
  targetType: elbv2.TargetType.INSTANCE,
  targetGroupName: 'bg-rolling-tg',
  healthCheck: {
    path: '/health',
    port: 'traffic-port',
    healthyHttpCodes: '200',
    interval: cdk.Duration.seconds(30),
  },
});

const listener = alb.addListener('RollingListener', {
  port: 80,
  protocol: elbv2.ApplicationProtocol.HTTP,
  defaultAction: elbv2.ListenerAction.fixedResponse(403, {
    contentType: 'text/plain',
    messageBody: 'Access Denied',
  }),
});

const secret = `bg-rolling-${this.account}-${cdk.Names.uniqueId(this).slice(-6)}`;
new elbv2.CfnListenerRule(this, 'RollingForwardRule', {
  listenerArn: listener.listenerArn,
  priority: 1,
  conditions: [{
    field: 'http-header',
    httpHeaderConfig: { httpHeaderName: 'X-Custom-Secret', values: [secret] },
  }],
  actions: [{
    type: 'forward',
    forwardConfig: { targetGroups: [{ targetGroupArn: tg.targetGroupArn, weight: 1 }] },
  }],
});

this.alb = alb;
this.tg = tg;
this.secret = secret;
this.albSg = albSg;
```

- [ ] **Step 4: Run jest to verify all 4 tests pass**

Run: `npx jest test/rolling-stack.test.ts --no-coverage`

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rolling-stack.ts test/rolling-stack.test.ts
git commit -m "feat(rolling): add ALB + TG + listener with priority-1 forward"
```

---

### Task A3: ALB SG ingress — CloudFront prefix list only

**Files:**
- Modify: `lib/rolling-stack.ts`
- Modify: `test/rolling-stack.test.ts`

- [ ] **Step 1: Add SG ingress assertion to test**

```typescript
  it('ALB SG has CfnSecurityGroupIngress from CloudFront prefix list only', () => {
    const t = synthRolling();
    const ingresses = t.findResources('AWS::EC2::SecurityGroupIngress', {
      Properties: { SourcePrefixListId: 'pl-22a6434b', FromPort: 80, ToPort: 80 },
    });
    expect(Object.keys(ingresses).length).toBe(1);
  });
```

- [ ] **Step 2: Run jest to verify it fails**

Run: `npx jest test/rolling-stack.test.ts -t "prefix list" --no-coverage`

Expected: FAIL — 0 ingress resources matching.

- [ ] **Step 3: Add CfnSecurityGroupIngress in rolling-stack.ts**

Insert after the `albSg` creation:

```typescript
new ec2.CfnSecurityGroupIngress(this, 'RollingAlbIngress', {
  groupId: albSg.securityGroupId,
  ipProtocol: 'tcp',
  fromPort: 80,
  toPort: 80,
  sourcePrefixListId: props.cloudFrontPrefixListId,
  description: 'HTTP from CloudFront origin-facing only',
});
```

- [ ] **Step 4: Run jest to verify it passes**

Run: `npx jest test/rolling-stack.test.ts --no-coverage`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rolling-stack.ts test/rolling-stack.test.ts
git commit -m "feat(rolling): restrict ALB SG ingress to CloudFront prefix list"
```

---

### Task A4: LaunchTemplate + ASG with target subnet

**Files:**
- Modify: `lib/rolling-stack.ts`
- Modify: `test/rolling-stack.test.ts`

- [ ] **Step 1: Add LT/ASG assertions**

```typescript
  it('creates 1 LaunchTemplate with bg-rolling-lt name', () => {
    const t = synthRolling({ launchVersion: 'v1' });
    t.resourceCountIs('AWS::EC2::LaunchTemplate', 1);
    t.hasResourceProperties('AWS::EC2::LaunchTemplate', {
      LaunchTemplateName: 'bg-rolling-lt',
    });
  });

  it('LaunchTemplate v1 user-data references COLOR=blue and VERSION=v1', () => {
    const t = synthRolling({ launchVersion: 'v1' });
    const lts = t.findResources('AWS::EC2::LaunchTemplate');
    const lt = Object.values(lts)[0] as any;
    const ud = JSON.stringify(lt.Properties.LaunchTemplateData.UserData);
    expect(ud).toMatch(/COLOR=blue/);
    expect(ud).toMatch(/VERSION=v1/);
  });

  it('LaunchTemplate v2 user-data references COLOR=green and VERSION=v2', () => {
    const t = synthRolling({ launchVersion: 'v2' });
    const lts = t.findResources('AWS::EC2::LaunchTemplate');
    const lt = Object.values(lts)[0] as any;
    const ud = JSON.stringify(lt.Properties.LaunchTemplateData.UserData);
    expect(ud).toMatch(/COLOR=green/);
    expect(ud).toMatch(/VERSION=v2/);
  });

  it('creates 1 ASG named bg-rolling-ec2asg with desired=4', () => {
    const t = synthRolling();
    t.resourceCountIs('AWS::AutoScaling::AutoScalingGroup', 1);
    t.hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
      AutoScalingGroupName: 'bg-rolling-ec2asg',
      DesiredCapacity: '4',
      MinSize: '4',
      MaxSize: '8',
    });
  });

  it('throws when targetSubnet=private2 but no private2 subnets exist', () => {
    expect(() => {
      const app = new cdk.App();
      const env = { account: '123456789012', region: 'ap-northeast-2' };
      const network = new BgTestNetworkStack(app, 'Net', { env, includeSecondaryCidr: false });
      const data = new BgTestDataStack(app, 'Data', { env, networkStack: network });
      const ecr = new BgTestEcrStack(app, 'Ecr', { env });
      new BgTestRollingStack(app, 'Rolling', {
        env, networkStack: network, dataStack: data, ecrStack: ecr,
        cloudFrontPrefixListId: 'pl-22a6434b',
        launchVersion: 'v2', targetSubnet: 'private2',
      });
    }).toThrow(/No subnets/i);
  });
```

- [ ] **Step 2: Run jest to verify failures**

Run: `npx jest test/rolling-stack.test.ts --no-coverage 2>&1 | tail -20`

Expected: 5 FAIL.

- [ ] **Step 3: Implement LT + ASG**

Add imports at the top of `lib/rolling-stack.ts`:

```typescript
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as iam from 'aws-cdk-lib/aws-iam';
import { LAB_CONFIG } from './config';
```

Add field declarations:

```typescript
public readonly asg: autoscaling.AutoScalingGroup;
public readonly lt: ec2.LaunchTemplate;
public readonly instanceSg: ec2.SecurityGroup;
```

Inside the constructor, after the listener rule creation:

```typescript
const subnets = props.targetSubnet === 'private1'
  ? props.networkStack.private1Subnets
  : props.networkStack.private2Subnets;
if (subnets.length === 0) {
  throw new Error(`No subnets for targetSubnet=${props.targetSubnet}. Set includeSecondaryCidr=true.`);
}

const instanceSg = new ec2.SecurityGroup(this, 'RollingInstanceSg', {
  vpc, allowAllOutbound: true,
  securityGroupName: 'bg-rolling-instance-sg',
});

const role = new iam.Role(this, 'RollingAsgRole', {
  assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
  managedPolicies: [
    iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
    iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
    iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
  ],
});
props.dataStack.dbSecret.grantRead(role);

const imageTag = props.launchVersion;
const colorEnv = props.launchVersion === 'v1' ? 'blue' : 'green';
const imageUri = `${props.ecrStack.repository.repositoryUri}:${imageTag}`;

const userData = ec2.UserData.forLinux();
userData.addCommands(
  'set -euxo pipefail',
  'dnf install -y docker',
  'systemctl enable --now docker',
  `aws ecr get-login-password --region ${this.region} | docker login --username AWS --password-stdin ${this.account}.dkr.ecr.${this.region}.amazonaws.com`,
  `DB_PASS=$(aws secretsmanager get-secret-value --region ${this.region} --secret-id ${props.dataStack.dbSecret.secretArn} --query SecretString --output text | python3 -c 'import sys,json;print(json.load(sys.stdin)["password"])')`,
  `docker run -d --restart=always --name app -p 80:${LAB_CONFIG.compute.appPort} \\`,
  `  -e COLOR=${colorEnv} \\`,
  `  -e VERSION=${imageTag} \\`,
  '  -e COMPUTE_TYPE=ec2-rolling \\',
  `  -e REDIS_URL=rediss://${props.dataStack.redisReplicationGroup.attrPrimaryEndPointAddress}:6379 \\`,
  `  -e DB_HOST=${props.dataStack.auroraCluster.clusterEndpoint.hostname} \\`,
  `  -e DB_USER=${LAB_CONFIG.data.dbUser} \\`,
  `  -e DB_NAME=${LAB_CONFIG.data.dbName} \\`,
  `  -e AWS_REGION=${this.region} \\`,
  '  -e DB_PASSWORD="$DB_PASS" \\',
  `  ${imageUri}`,
);

const lt = new ec2.LaunchTemplate(this, 'RollingLt', {
  launchTemplateName: 'bg-rolling-lt',
  instanceType: new ec2.InstanceType(LAB_CONFIG.compute.ec2InstanceType),
  machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
  role, securityGroup: instanceSg, userData,
});

const asg = new autoscaling.AutoScalingGroup(this, 'RollingAsg', {
  vpc, vpcSubnets: { subnets },
  launchTemplate: lt,
  desiredCapacity: 4,
  minCapacity: 4,
  maxCapacity: 8,
  healthCheck: autoscaling.HealthCheck.elb({ grace: cdk.Duration.minutes(5) }),
  autoScalingGroupName: 'bg-rolling-ec2asg',
});

const cfnAsg = asg.node.defaultChild as autoscaling.CfnAutoScalingGroup;
cfnAsg.targetGroupArns = [tg.targetGroupArn];

this.asg = asg;
this.lt = lt;
this.instanceSg = instanceSg;
```

- [ ] **Step 4: Run jest to verify all tests pass**

Run: `npx jest test/rolling-stack.test.ts --no-coverage`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rolling-stack.ts test/rolling-stack.test.ts
git commit -m "feat(rolling): add LaunchTemplate + ASG with subnet selection"
```

---

### Task A5: Instance SG ingress — SG-to-SG + Data tier wiring

**Files:**
- Modify: `lib/rolling-stack.ts`
- Modify: `test/rolling-stack.test.ts`

- [ ] **Step 1: Add SG-to-SG assertion**

```typescript
  it('instance SG ingress references ALB SG (SG-to-SG, not CIDR)', () => {
    const t = synthRolling();
    const ingresses = t.findResources('AWS::EC2::SecurityGroupIngress', {
      Properties: { FromPort: 80, ToPort: 80, IpProtocol: 'tcp' },
    });
    const sgToSg = Object.values(ingresses).filter((i: any) =>
      i.Properties.SourceSecurityGroupId !== undefined
    );
    expect(sgToSg.length).toBeGreaterThanOrEqual(1);
  });
```

- [ ] **Step 2: Run jest to verify failure**

Run: `npx jest test/rolling-stack.test.ts -t "SG-to-SG" --no-coverage`

Expected: FAIL.

- [ ] **Step 3: Add SG-to-SG ingress and Data tier wiring**

In `lib/rolling-stack.ts`, after `instanceSg` creation (before `role` declaration):

```typescript
instanceSg.addIngressRule(
  ec2.Peer.securityGroupId(albSg.securityGroupId),
  ec2.Port.tcp(80),
  'ALB SG to instance:80 (SG-to-SG)',
);

props.dataStack.dbSecurityGroup.addIngressRule(instanceSg, ec2.Port.tcp(3306), 'Rolling instance to Aurora', true);
props.dataStack.redisSecurityGroup.addIngressRule(instanceSg, ec2.Port.tcp(6379), 'Rolling instance to Redis', true);
```

- [ ] **Step 4: Run jest to verify PASS**

Run: `npx jest test/rolling-stack.test.ts --no-coverage`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rolling-stack.ts test/rolling-stack.test.ts
git commit -m "feat(rolling): SG-to-SG ingress + Aurora/Redis wiring"
```

---

### Task A6: Warm Pool (Stopped, MaxPrepared=4)

**Files:**
- Modify: `lib/rolling-stack.ts`
- Modify: `test/rolling-stack.test.ts`

- [ ] **Step 1: Add Warm Pool assertion**

```typescript
  it('attaches a Warm Pool with PoolState=Stopped, MaxPrepared=4, MinSize=4', () => {
    const t = synthRolling();
    t.resourceCountIs('AWS::AutoScaling::WarmPool', 1);
    t.hasResourceProperties('AWS::AutoScaling::WarmPool', {
      PoolState: 'Stopped',
      MaxGroupPreparedCapacity: 4,
      MinSize: 4,
    });
  });
```

- [ ] **Step 2: Run jest to verify failure**

Run: `npx jest test/rolling-stack.test.ts -t "Warm Pool" --no-coverage`

Expected: FAIL.

- [ ] **Step 3: Add CfnWarmPool**

In `lib/rolling-stack.ts`, after the line `cfnAsg.targetGroupArns = [tg.targetGroupArn];`:

```typescript
new autoscaling.CfnWarmPool(this, 'RollingWarmPool', {
  autoScalingGroupName: asg.autoScalingGroupName,
  poolState: 'Stopped',
  maxGroupPreparedCapacity: 4,
  minSize: 4,
});
```

- [ ] **Step 4: Run jest to verify PASS**

Run: `npx jest test/rolling-stack.test.ts --no-coverage`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rolling-stack.ts test/rolling-stack.test.ts
git commit -m "feat(rolling): attach Warm Pool (Stopped, MaxPrepared=4)"
```

---

### Task A7: CloudFront outputs + tags

**Files:**
- Modify: `lib/rolling-stack.ts`
- Modify: `test/rolling-stack.test.ts`

- [ ] **Step 1: Add output assertions**

```typescript
  it('exports CfnOutput RollingAlbDns and RollingSecret', () => {
    const t = synthRolling();
    t.hasOutput('RollingAlbDns', { Export: { Name: 'BgRollingAlb-Dns' } });
    t.hasOutput('RollingSecret', { Export: { Name: 'BgRollingAlb-Secret' } });
  });
```

- [ ] **Step 2: Run jest to verify failure**

Run: `npx jest test/rolling-stack.test.ts -t "CfnOutput" --no-coverage`

Expected: FAIL.

- [ ] **Step 3: Add outputs in rolling-stack.ts (end of constructor)**

Add import at the top:

```typescript
import { commonTags } from './config';
```

At the end of the constructor:

```typescript
Object.entries(commonTags()).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

new cdk.CfnOutput(this, 'RollingAlbDns', {
  value: alb.loadBalancerDnsName,
  exportName: 'BgRollingAlb-Dns',
});
new cdk.CfnOutput(this, 'RollingSecret', {
  value: secret,
  exportName: 'BgRollingAlb-Secret',
});
```

- [ ] **Step 4: Run jest to verify PASS**

Run: `npx jest test/rolling-stack.test.ts --no-coverage`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rolling-stack.ts test/rolling-stack.test.ts
git commit -m "feat(rolling): add CfnOutput for ALB DNS and secret"
```

---

### Task A8: RollingCfStack

**Files:**
- Create: `lib/rolling-cf-stack.ts`
- Create: `test/rolling-cf-stack.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BgTestNetworkStack } from '../lib/network-stack';
import { BgTestDataStack } from '../lib/data-stack';
import { BgTestEcrStack } from '../lib/ecr-stack';
import { BgTestRollingStack } from '../lib/rolling-stack';
import { BgTestRollingCfStack } from '../lib/rolling-cf-stack';

function synthRollingCf() {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'ap-northeast-2' };
  const network = new BgTestNetworkStack(app, 'Net', { env, includeSecondaryCidr: true });
  const data = new BgTestDataStack(app, 'Data', { env, networkStack: network });
  const ecr = new BgTestEcrStack(app, 'Ecr', { env });
  const rolling = new BgTestRollingStack(app, 'Rolling', {
    env, networkStack: network, dataStack: data, ecrStack: ecr,
    cloudFrontPrefixListId: 'pl-22a6434b',
    launchVersion: 'v1', targetSubnet: 'private1',
  });
  const cf = new BgTestRollingCfStack(app, 'RollingCf', { env, rollingStack: rolling });
  return Template.fromStack(cf);
}

describe('BgTestRollingCfStack', () => {
  it('creates 1 CloudFront distribution', () => {
    const t = synthRollingCf();
    t.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  it('viewer protocol redirect-to-https, origin http-only', () => {
    const t = synthRollingCf();
    const dists = t.findResources('AWS::CloudFront::Distribution');
    const dist = Object.values(dists)[0] as any;
    const cfg = dist.Properties.DistributionConfig;
    expect(cfg.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https');
    expect(cfg.Origins[0].CustomOriginConfig.OriginProtocolPolicy).toBe('http-only');
  });

  it('origin custom header X-Custom-Secret is set', () => {
    const t = synthRollingCf();
    const dists = t.findResources('AWS::CloudFront::Distribution');
    const dist = Object.values(dists)[0] as any;
    const headers = dist.Properties.DistributionConfig.Origins[0].OriginCustomHeaders;
    expect(headers).toHaveLength(1);
    expect(headers[0].HeaderName).toBe('X-Custom-Secret');
  });
});
```

- [ ] **Step 2: Run jest — expect failure on missing module**

Run: `npx jest test/rolling-cf-stack.test.ts --no-coverage 2>&1 | head -10`

Expected: FAIL — `Cannot find module '../lib/rolling-cf-stack'`.

- [ ] **Step 3: Create `lib/rolling-cf-stack.ts`**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import { LAB_CONFIG, commonTags } from './config';
import { BgTestRollingStack } from './rolling-stack';

export interface BgTestRollingCfStackProps extends cdk.StackProps {
  rollingStack: BgTestRollingStack;
}

export class BgTestRollingCfStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: BgTestRollingCfStackProps) {
    super(scope, id, props);

    const origin = new origins.HttpOrigin(props.rollingStack.alb.loadBalancerDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      customHeaders: { 'X-Custom-Secret': props.rollingStack.secret },
      readTimeout: cdk.Duration.seconds(30),
    });

    this.distribution = new cloudfront.Distribution(this, 'RollingCf', {
      comment: `${LAB_CONFIG.resourcePrefix}-rolling-cf (origin = RollingStack ALB)`,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
    });
    cdk.Tags.of(this.distribution).add('Name', 'bg-rolling-cf');
    Object.entries(commonTags()).forEach(([k, v]) => cdk.Tags.of(this.distribution).add(k, v));

    new cdk.CfnOutput(this, 'RollingCfDomain', {
      value: `https://${this.distribution.distributionDomainName}`,
      exportName: 'BgRollingCfDomain',
    });
  }
}
```

- [ ] **Step 4: Run jest to verify PASS**

Run: `npx jest test/rolling-cf-stack.test.ts --no-coverage`

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rolling-cf-stack.ts test/rolling-cf-stack.test.ts
git commit -m "feat(rolling): add BgTestRollingCfStack (separate CloudFront)"
```

---

### Task A9: Validation function (pure, testable)

**Files:**
- Create: `lib/rolling-context.ts`
- Create: `test/rolling-context.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { validateRollingContext } from '../lib/rolling-context';

describe('validateRollingContext', () => {
  it('passes when includeRolling=false (no other constraints checked)', () => {
    expect(() => validateRollingContext({
      includeRolling: false, includeSecondaryCidr: false, rollingTargetSubnet: 'private1',
    })).not.toThrow();
  });

  it('throws when includeRolling=true and includeSecondaryCidr=false', () => {
    expect(() => validateRollingContext({
      includeRolling: true, includeSecondaryCidr: false, rollingTargetSubnet: 'private1',
    })).toThrow(/includeRolling.*requires.*includeSecondaryCidr/i);
  });

  it('passes when includeRolling=true and includeSecondaryCidr=true', () => {
    expect(() => validateRollingContext({
      includeRolling: true, includeSecondaryCidr: true, rollingTargetSubnet: 'private2',
    })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run jest to verify failure**

Run: `npx jest test/rolling-context.test.ts --no-coverage 2>&1 | head -10`

Expected: FAIL — `Cannot find module '../lib/rolling-context'`.

- [ ] **Step 3: Implement validation**

Create `lib/rolling-context.ts`:

```typescript
export interface RollingContext {
  includeRolling: boolean;
  includeSecondaryCidr: boolean;
  rollingTargetSubnet: 'private1' | 'private2';
}

export function validateRollingContext(ctx: RollingContext): void {
  if (!ctx.includeRolling) return;
  if (!ctx.includeSecondaryCidr) {
    throw new Error('includeRolling=true requires includeSecondaryCidr=true (Rolling stack needs private2 subnets carved)');
  }
}
```

- [ ] **Step 4: Run jest to verify PASS**

Run: `npx jest test/rolling-context.test.ts --no-coverage`

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rolling-context.ts test/rolling-context.test.ts
git commit -m "feat(rolling): add validateRollingContext pure function"
```

---

### Task A10: `bin/app.ts` — conditional instantiation

**Files:**
- Modify: `bin/app.ts`

- [ ] **Step 1: Add imports**

At the top of `bin/app.ts`, add:

```typescript
import { BgTestRollingStack } from '../lib/rolling-stack';
import { BgTestRollingCfStack } from '../lib/rolling-cf-stack';
import { validateRollingContext } from '../lib/rolling-context';
```

- [ ] **Step 2: Read context flags**

After the existing context-flag block:

```typescript
const includeRolling = app.node.tryGetContext('includeRolling') === true || app.node.tryGetContext('includeRolling') === 'true';
const rollingLaunchVersion = (app.node.tryGetContext('rollingLaunchVersion') ?? 'v1') as 'v1' | 'v2';
const rollingTargetSubnet = (app.node.tryGetContext('rollingTargetSubnet') ?? 'private1') as 'private1' | 'private2';

validateRollingContext({ includeRolling, includeSecondaryCidr, rollingTargetSubnet });
```

- [ ] **Step 3: Conditionally instantiate stacks**

After the existing `cf` stack creation (and before `app.synth()`):

```typescript
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
```

- [ ] **Step 4: Run full jest suite to confirm no regression**

Run: `npm test`

Expected: all existing tests still PASS. New rolling-* tests PASS.

- [ ] **Step 5: Verify cdk synth succeeds**

Run: `npx cdk synth --quiet -c includeSecondaryCidr=true -c includeRolling=true 2>&1 | tail -3`

Expected: no errors.

- [ ] **Step 6: Verify default deploy diff is empty for existing stacks (regression gate)**

Run: `npx cdk diff 2>&1 | tail -20`

Expected: no `~` or `-` lines for `BgTestNetworkStack`, `BgTestAlbStack`, `BgTestBlueStack`, `BgTestGreenStack`, `BgTestCfStack`, `BgTestClusterStack`, `BgTestDataStack`, `BgTestEcrStack`. If any change appears, STOP and investigate.

- [ ] **Step 7: Commit**

```bash
git add bin/app.ts
git commit -m "feat(rolling): wire RollingStack in bin/app.ts behind context flag"
```

---

## Phase B — App / Image

### Task B1: `app/server.js` — VERSION env

**Files:**
- Modify: `app/server.js`

- [ ] **Step 1: Add VERSION env declaration**

In `app/server.js`, after line 7 (`const COMPUTE_TYPE = ...`):

```javascript
const VERSION = process.env.VERSION ?? COLOR;
```

- [ ] **Step 2: Update `/info` response to include `version`**

Modify the `app.get('/info', ...)` handler — change the `res.json(...)` call to:

```javascript
res.json({
  color: COLOR, version: VERSION, compute: COMPUTE_TYPE,
  hostname: os.hostname(), redisHits, dbPingMs,
});
```

- [ ] **Step 3: Local smoke test (no Redis/DB)**

Create a temp script `tmp-smoke.js`:

```javascript
process.env.SKIP_DEPS = '1';
process.env.COLOR = 'blue';
process.env.VERSION = 'v1';
process.env.COMPUTE_TYPE = 'ec2-rolling';
const http = require('http');
const { createApp } = require('./app/server.js');
const server = createApp().listen(0, () => {
  const port = server.address().port;
  http.get(`http://localhost:${port}/info`, (res) => {
    let buf = '';
    res.on('data', (c) => buf += c);
    res.on('end', () => {
      const j = JSON.parse(buf);
      console.log(JSON.stringify(j));
      server.close();
      if (j.version !== 'v1') process.exit(1);
    });
  });
});
```

Run: `node tmp-smoke.js`

Expected output: JSON with `"version":"v1"`.

Then: `rm tmp-smoke.js`

- [ ] **Step 4: Commit**

```bash
git add app/server.js
git commit -m "feat(app): add VERSION env exposed in /info response"
```

---

### Task B2: `scripts/build-and-push.sh` — clarify tag semantics

**Files:**
- Modify: `scripts/build-and-push.sh`

- [ ] **Step 1: Rename `COLOR` variable to `TAG`**

Replace contents:

```bash
#!/usr/bin/env bash
set -euo pipefail
TAG="${1:-blue}"
REGION="${AWS_REGION:-ap-northeast-2}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ECR_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/bg-app"

echo "[build-and-push] tag=${TAG} region=${REGION} ecr=${ECR_URI}"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

docker buildx build --platform linux/arm64 --load \
  -t "bg-app:${TAG}" \
  -f app/Dockerfile app/

docker tag "bg-app:${TAG}" "${ECR_URI}:${TAG}"
docker push "${ECR_URI}:${TAG}"

echo "[build-and-push] pushed ${ECR_URI}:${TAG}"
```

- [ ] **Step 2: Lint**

Run: `shellcheck scripts/build-and-push.sh`

Expected: no warnings.

- [ ] **Step 3: Commit**

```bash
git add scripts/build-and-push.sh
git commit -m "refactor(scripts): rename COLOR to TAG for clarity"
```

---

### Task B3: ECR push v1, v2 (runtime action)

**Files:** (no code — runtime action)

- [ ] **Step 1: Push v1 image**

Run: `./scripts/build-and-push.sh v1`

Expected: `[build-and-push] pushed <ecr>/bg-app:v1`.

- [ ] **Step 2: Push v2 image**

Run: `./scripts/build-and-push.sh v2`

Expected: `[build-and-push] pushed <ecr>/bg-app:v2`.

- [ ] **Step 3: Verify ECR tags**

Run: `aws ecr list-images --repository-name bg-app --query 'imageIds[].imageTag' --output table`

Expected: includes `blue`, `green`, `v1`, `v2`.

- [ ] **Step 4: No commit (runtime action)**

---

## Phase C — Demo Assets

### Task C1: `demos/shared.sh` — Rolling helpers (additive)

**Files:**
- Modify: `demos/shared.sh`

- [ ] **Step 1: Append helpers at end of file**

```bash
# ─── Rolling demo helpers (additive; existing functions untouched) ────────────

# Returns: "Status|PercentageComplete|StartTime|MinHealthy=N"
# Empty if no refresh history.
fetch_rolling_refresh_status() {
  aws autoscaling describe-instance-refreshes \
    --auto-scaling-group-name bg-rolling-ec2asg \
    --max-records 1 \
    --query 'InstanceRefreshes[0].[Status,PercentageComplete,StartTime,Preferences.MinHealthyPercentage]' \
    --output text 2>/dev/null \
    | awk 'NF { printf "%s|%s|%s|MinHealthy=%s\n", $1, $2, $3, $4 }'
}

# Target health counts for bg-rolling-tg.
# Returns: "healthy|draining|unhealthy"
fetch_rolling_tg_health() {
  local tg_arn
  tg_arn=$(aws elbv2 describe-target-groups --names bg-rolling-tg \
    --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null)
  [ -z "$tg_arn" ] || [ "$tg_arn" = "None" ] && return 1
  aws elbv2 describe-target-health --target-group-arn "$tg_arn" \
    --query 'TargetHealthDescriptions[].TargetHealth.State' --output text 2>/dev/null \
    | tr '\t' '\n' \
    | awk 'BEGIN {h=0; d=0; u=0}
           /^healthy$/  { h++ }
           /^draining$/ { d++ }
           /^unhealthy$/{ u++ }
           END { printf "%d|%d|%d\n", h, d, u }'
}

# 5xx accumulated since given epoch (default: 10 min ago).
# Returns integer.
fetch_rolling_5xx() {
  local since="${1:-$(($(date +%s) - 600))}"
  local now_iso since_iso alb_arn alb_dim
  now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  since_iso=$(date -u -d "@${since}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "${since}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)
  alb_arn=$(aws elbv2 describe-load-balancers --names bg-rolling-alb \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null)
  [ -z "$alb_arn" ] || [ "$alb_arn" = "None" ] && { echo 0; return; }
  alb_dim=$(echo "$alb_arn" | sed -E 's|^.*loadbalancer/||')
  aws cloudwatch get-metric-statistics \
    --namespace AWS/ApplicationELB \
    --metric-name HTTPCode_Target_5XX_Count \
    --dimensions Name=LoadBalancer,Value="$alb_dim" \
    --statistics Sum --period 60 \
    --start-time "$since_iso" --end-time "$now_iso" \
    --query 'sum(Datapoints[].Sum)' --output text 2>/dev/null \
    | awk '{ printf "%d\n", $1 + 0 }'
}

# Subnet ID → "Name" tag (cached). Falls back to subnet ID if no tag.
declare -A _SUBNET_LABEL_CACHE
map_subnet_to_label() {
  local sid="$1"
  if [ -z "${_SUBNET_LABEL_CACHE[$sid]:-}" ]; then
    local label
    label=$(aws ec2 describe-subnets --subnet-ids "$sid" \
      --query 'Subnets[0].Tags[?Key==`Name`].Value | [0]' --output text 2>/dev/null)
    [ -z "$label" ] || [ "$label" = "None" ] && label="$sid"
    _SUBNET_LABEL_CACHE[$sid]="$label"
  fi
  printf '%s' "${_SUBNET_LABEL_CACHE[$sid]}"
}

# v1 → blue, v2 → green.
map_lt_version_to_color() {
  case "$1" in
    v1|1) echo "blue" ;;
    v2|2) echo "green" ;;
    *)    echo "unknown" ;;
  esac
}

# Returns "https://...cloudfront.net" or "(not deployed)".
fetch_rolling_cf_url() {
  local out
  out=$(aws cloudformation describe-stacks --stack-name BgTestRollingCfStack \
    --query 'Stacks[0].Outputs[?ExportName==`BgRollingCfDomain`].OutputValue | [0]' \
    --output text 2>/dev/null)
  if [ -z "$out" ] || [ "$out" = "None" ]; then
    echo "(not deployed)"
  else
    echo "$out"
  fi
}
```

- [ ] **Step 2: Shellcheck**

Run: `shellcheck demos/shared.sh`

Expected: no new warnings.

- [ ] **Step 3: Verify existing functions unchanged**

Run: `git diff demos/shared.sh | grep -E "^-[^-]" | head -5`

Expected: empty output (only additions).

- [ ] **Step 4: Quick sanity load**

Run: `bash -c 'source demos/shared.sh && type fetch_rolling_refresh_status && type fetch_active_weights'`

Expected: both reported as `function`.

- [ ] **Step 5: Commit**

```bash
git add demos/shared.sh
git commit -m "feat(demos): add Rolling helpers to shared.sh (existing untouched)"
```

---

### Task C2: `scenario-rolling-1-deploy.sh`

**Files:**
- Create: `demos/scenario-rolling-1-deploy.sh`

- [ ] **Step 1: Write script**

```bash
#!/usr/bin/env bash
# Phase 1 — Initial Rolling deploy (v1 image @ private1 subnets)
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared.sh"

print_step 1 5 "Phase 1 — Initial Rolling Deploy (v1 @ private1)"
echo "  ${D}Creates ALB, ASG (4 in-service), Warm Pool (4 stopped), CloudFront.${RESET}"
echo "  ${D}Existing Blue/Green stacks are unchanged.${RESET}"
pause_key

print_step 2 5 "CDK Deploy"
echo "  ${C}\$ npx cdk deploy --all \\${RESET}"
echo "  ${C}    -c includeSecondaryCidr=true \\${RESET}"
echo "  ${C}    -c includeGreen=true \\${RESET}"
echo "  ${C}    -c includeRolling=true \\${RESET}"
echo "  ${C}    -c rollingLaunchVersion=v1 \\${RESET}"
echo "  ${C}    -c rollingTargetSubnet=private1${RESET}"
echo
npx cdk deploy --all \
  -c includeSecondaryCidr=true \
  -c includeGreen=true \
  -c includeRolling=true \
  -c rollingLaunchVersion=v1 \
  -c rollingTargetSubnet=private1 \
  --require-approval never

print_step 3 5 "Verify ASG state"
asg_state=$(aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names bg-rolling-ec2asg \
  --query 'AutoScalingGroups[0].[DesiredCapacity,length(Instances[?LifecycleState==`InService`])]' \
  --output text)
desired=$(echo "$asg_state" | awk '{print $1}')
in_service=$(echo "$asg_state" | awk '{print $2}')
echo "  ${BOLD}ASG bg-rolling-ec2asg${RESET}  desired=${desired}  in-service=${in_service}"
[ "$in_service" = "4" ] && echo "  ${G}✓${RESET} 4 in-service instances" || echo "  ${Y}⚠${RESET} expected 4 in-service, got ${in_service}"

print_step 4 5 "Verify Warm Pool"
warm_count=$(aws autoscaling describe-warm-pool \
  --auto-scaling-group-name bg-rolling-ec2asg \
  --query 'length(Instances[?LifecycleState==`Stopped`])' --output text 2>/dev/null)
echo "  Warm Pool stopped: ${warm_count}"
[ "$warm_count" = "4" ] && echo "  ${G}✓${RESET} 4 warm-pool instances stopped" || echo "  ${Y}⚠${RESET} expected 4, got ${warm_count}"

print_step 5 5 "Verify response via CloudFront"
cf_url=$(fetch_rolling_cf_url)
echo "  Rolling CF URL: ${cf_url}"
if [ "$cf_url" != "(not deployed)" ]; then
  body=$(curl -s --max-time 10 "${cf_url}/info" || echo "(timeout)")
  echo "  Response: ${body}"
  echo "$body" | grep -q '"version":"v1"' && echo "  ${G}✓${RESET} version=v1 confirmed" || echo "  ${Y}⚠${RESET} version not v1"
fi

echo
echo "  ${BOLD}Next:${RESET} Phase 2 (Instance Refresh to v2 @ private2)"
echo "  ${D}Tip: open a separate terminal: ./demos/watch-rolling.sh${RESET}"
pause_key
```

- [ ] **Step 2: Make executable + shellcheck**

```bash
chmod +x demos/scenario-rolling-1-deploy.sh
shellcheck demos/scenario-rolling-1-deploy.sh
```

Expected: no warnings.

- [ ] **Step 3: Commit**

```bash
git add demos/scenario-rolling-1-deploy.sh
git commit -m "feat(demos): add scenario-rolling-1-deploy.sh"
```

---

### Task C3: `scenario-rolling-2-refresh.sh`

**Files:**
- Create: `demos/scenario-rolling-2-refresh.sh`

- [ ] **Step 1: Write script**

```bash
#!/usr/bin/env bash
# Phase 2 — Rolling Migration via Instance Refresh
# Usage: ./scenario-rolling-2-refresh.sh [min_healthy_pct]   # default 50
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared.sh"

MIN_HEALTHY="${1:-50}"

print_step 1 6 "Phase 2 — Rolling Migration (MinHealthy=${MIN_HEALTHY}%)"
echo "  ${D}Change LT to v2 + ASG subnets to private2, then Instance Refresh.${RESET}"
pause_key

print_step 2 6 "Pre-flight: ECR :v2"
v2_exists=$(aws ecr describe-images --repository-name bg-app --image-ids imageTag=v2 \
  --query 'imageDetails[0].imageTags' --output text 2>/dev/null)
if [ -z "$v2_exists" ]; then
  echo "  ${R}✗${RESET} ECR :v2 missing — run ./scripts/build-and-push.sh v2"
  exit 1
fi
echo "  ${G}✓${RESET} ECR :v2 present"

print_step 3 6 "Register intent via CDK"
npx cdk deploy --all \
  -c includeSecondaryCidr=true \
  -c includeGreen=true \
  -c includeRolling=true \
  -c rollingLaunchVersion=v2 \
  -c rollingTargetSubnet=private2 \
  --require-approval never

print_step 4 6 "Pre-execution verification"
echo "  ${BOLD}Intent registered. Running instances are *still* v1 @ private1.${RESET}"
lt_id=$(aws ec2 describe-launch-templates --launch-template-names bg-rolling-lt \
  --query 'LaunchTemplates[0].LaunchTemplateId' --output text)
latest_v=$(aws ec2 describe-launch-templates --launch-template-names bg-rolling-lt \
  --query 'LaunchTemplates[0].LatestVersionNumber' --output text)
echo "  LT latest version: ${latest_v}  (id=${lt_id})"
zones=$(aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names bg-rolling-ec2asg \
  --query 'AutoScalingGroups[0].VPCZoneIdentifier' --output text)
echo "  ASG VPCZoneIdentifier: ${zones}"

print_step 5 6 "Trigger Instance Refresh"
refresh_id=$(aws autoscaling start-instance-refresh \
  --auto-scaling-group-name bg-rolling-ec2asg \
  --strategy Rolling \
  --preferences "MinHealthyPercentage=${MIN_HEALTHY},InstanceWarmup=120,ScaleInProtectedInstances=Refresh,StandbyInstances=Terminate" \
  --desired-configuration "LaunchTemplate={LaunchTemplateId=${lt_id},Version=\$Latest}" \
  --query 'InstanceRefreshId' --output text)
echo "  ${G}✓${RESET} Refresh started: ${refresh_id}"
echo "  ${D}💡 Open ./demos/watch-rolling.sh in another terminal for live view${RESET}"

print_step 6 6 "Polling progress (60s interval)"
start_epoch=$(date +%s)
while true; do
  state=$(fetch_rolling_refresh_status)
  status=$(echo "$state" | cut -d'|' -f1)
  pct=$(echo "$state" | cut -d'|' -f2)
  printf "  %s  status=%s  pct=%s%%\n" "$(date +%H:%M:%S)" "$status" "$pct"
  case "$status" in
    Successful) echo "  ${G}✓${RESET} Refresh completed"; break ;;
    Failed|Cancelled) echo "  ${R}✗${RESET} Ended status=${status}"; break ;;
  esac
  sleep 60
done

fivexx=$(fetch_rolling_5xx "$start_epoch")
echo "  HTTP 5xx since refresh start: ${fivexx}"
[ "$fivexx" = "0" ] && echo "  ${G}✓${RESET} Zero downtime achieved" || echo "  ${R}✗${RESET} 5xx detected"
pause_key
```

- [ ] **Step 2: Make executable + shellcheck**

```bash
chmod +x demos/scenario-rolling-2-refresh.sh
shellcheck demos/scenario-rolling-2-refresh.sh
```

Expected: no warnings.

- [ ] **Step 3: Commit**

```bash
git add demos/scenario-rolling-2-refresh.sh
git commit -m "feat(demos): add scenario-rolling-2-refresh.sh"
```

---

### Task C4: `scenario-rolling-3-rollback.sh`

**Files:**
- Create: `demos/scenario-rolling-3-rollback.sh`

- [ ] **Step 1: Write script**

```bash
#!/usr/bin/env bash
# Phase 3 — Rollback (v1 @ private1) via reverse Instance Refresh
# Usage: ./scenario-rolling-3-rollback.sh [min_healthy_pct]   # default 50
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared.sh"

MIN_HEALTHY="${1:-50}"

print_step 1 5 "Phase 3 — Rollback (MinHealthy=${MIN_HEALTHY}%)"
echo "  ${D}Same mechanism, reverse direction: v2 → v1, private2 → private1.${RESET}"
pause_key

print_step 2 5 "Register reverse intent via CDK"
npx cdk deploy --all \
  -c includeSecondaryCidr=true \
  -c includeGreen=true \
  -c includeRolling=true \
  -c rollingLaunchVersion=v1 \
  -c rollingTargetSubnet=private1 \
  --require-approval never

print_step 3 5 "Trigger Instance Refresh (reverse)"
lt_id=$(aws ec2 describe-launch-templates --launch-template-names bg-rolling-lt \
  --query 'LaunchTemplates[0].LaunchTemplateId' --output text)
refresh_id=$(aws autoscaling start-instance-refresh \
  --auto-scaling-group-name bg-rolling-ec2asg \
  --strategy Rolling \
  --preferences "MinHealthyPercentage=${MIN_HEALTHY},InstanceWarmup=120,ScaleInProtectedInstances=Refresh,StandbyInstances=Terminate" \
  --desired-configuration "LaunchTemplate={LaunchTemplateId=${lt_id},Version=\$Latest}" \
  --query 'InstanceRefreshId' --output text)
echo "  ${G}✓${RESET} Reverse refresh started: ${refresh_id}"

print_step 4 5 "Polling"
start_epoch=$(date +%s)
while true; do
  state=$(fetch_rolling_refresh_status)
  status=$(echo "$state" | cut -d'|' -f1)
  pct=$(echo "$state" | cut -d'|' -f2)
  printf "  %s  status=%s  pct=%s%%\n" "$(date +%H:%M:%S)" "$status" "$pct"
  case "$status" in
    Successful) echo "  ${G}✓${RESET} Rollback completed"; break ;;
    Failed|Cancelled) echo "  ${R}✗${RESET} Ended status=${status}"; break ;;
  esac
  sleep 60
done

print_step 5 5 "Final verification"
fivexx=$(fetch_rolling_5xx "$start_epoch")
echo "  HTTP 5xx during rollback: ${fivexx}"
[ "$fivexx" = "0" ] && echo "  ${G}✓${RESET} Zero downtime in rollback as well"
pause_key
```

- [ ] **Step 2: Make executable + shellcheck**

```bash
chmod +x demos/scenario-rolling-3-rollback.sh
shellcheck demos/scenario-rolling-3-rollback.sh
```

Expected: no warnings.

- [ ] **Step 3: Commit**

```bash
git add demos/scenario-rolling-3-rollback.sh
git commit -m "feat(demos): add scenario-rolling-3-rollback.sh"
```

---

### Task C5: `watch-rolling.sh` — 6-section live TUI

**Files:**
- Create: `demos/watch-rolling.sh`

- [ ] **Step 1: Write script**

```bash
#!/usr/bin/env bash
# Live monitor for Rolling demo — 6 sections, 2s interval.
# Usage: ./demos/watch-rolling.sh [interval_seconds]
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared.sh"

INTERVAL="${1:-2}"
CF_URL="$(fetch_rolling_cf_url)"
[ "$CF_URL" = "(not deployed)" ] && { echo "RollingCfStack not deployed"; exit 1; }

START_EPOCH=$(date +%s)
TOTAL=0
declare -a HISTORY=()
SPARK_WIDTH=60

draw_header() {
  clear
  echo
  printf "%b" "$BOLD$W"
  center "BG ROLLING — Live Migration Monitor"
  printf "%b\n" "$RESET"
  hr '=' "$D"
  printf "  %bCF URL%b : %s\n" "$BOLD" "$RESET" "$CF_URL"
  local elapsed=$(( $(date +%s) - START_EPOCH ))
  printf "  %bRuntime%b: %ds   %bTotal%b: %d   %bInterval%b: %ss\n" \
    "$BOLD" "$RESET" "$elapsed" "$BOLD" "$RESET" "$TOTAL" "$BOLD" "$RESET" "$INTERVAL"
  hr '=' "$D"
  echo
}

draw_refresh_progress() {
  printf "  %b%s%b\n" "$BOLD$W" "INSTANCE REFRESH PROGRESS" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"
  local state status pct start_time minhealthy
  state=$(fetch_rolling_refresh_status)
  if [ -z "$state" ]; then
    printf "  %bNo refresh history yet.%b\n\n" "$D" "$RESET"
    return
  fi
  status=$(echo "$state" | cut -d'|' -f1)
  pct=$(echo "$state" | cut -d'|' -f2)
  start_time=$(echo "$state" | cut -d'|' -f3)
  minhealthy=$(echo "$state" | cut -d'|' -f4)
  printf "  Status   : %s\n" "$status"
  printf "  Started  : %s   %s\n" "$start_time" "$minhealthy"
  local bar_w=40
  local filled=$(( ${pct:-0} * bar_w / 100 ))
  printf "  Progress : ["
  printf "%b" "$G"
  for ((i=0; i<filled; i++)); do printf "█"; done
  printf "%b" "$D"
  for ((i=filled; i<bar_w; i++)); do printf "░"; done
  printf "%b] %s%%\n\n" "$RESET" "${pct:-0}"
}

draw_inventory() {
  printf "  %b%s%b\n" "$BOLD$W" "INSTANCE INVENTORY" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"
  local in_count warm_count
  in_count=$(aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names bg-rolling-ec2asg \
    --query 'length(AutoScalingGroups[0].Instances)' --output text 2>/dev/null)
  warm_count=$(aws autoscaling describe-warm-pool \
    --auto-scaling-group-name bg-rolling-ec2asg \
    --query 'length(Instances)' --output text 2>/dev/null)
  printf "  In-Service: %s    Warm Pool: %s\n\n" "${in_count:-0}" "${warm_count:-0}"
}

draw_tg_health() {
  printf "  %b%s%b\n" "$BOLD$W" "ALB TG HEALTH (bg-rolling-tg)" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"
  local h
  h=$(fetch_rolling_tg_health)
  if [ -z "$h" ]; then
    printf "  %bTG not found%b\n\n" "$D" "$RESET"
    return
  fi
  local healthy draining unhealthy
  healthy=$(echo "$h" | cut -d'|' -f1)
  draining=$(echo "$h" | cut -d'|' -f2)
  unhealthy=$(echo "$h" | cut -d'|' -f3)
  printf "  healthy:   %s\n  draining:  %s\n  unhealthy: %s\n\n" "$healthy" "$draining" "$unhealthy"
}

call_one() {
  local resp ver
  resp=$(curl -s --max-time 6 "${CF_URL}/info" 2>/dev/null)
  if echo "$resp" | grep -q '"version"'; then
    ver=$(echo "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("version","?"))' 2>/dev/null)
  else
    ver="err"
  fi
  HISTORY+=("$ver")
  [ "${#HISTORY[@]}" -gt "$SPARK_WIDTH" ] && HISTORY=("${HISTORY[@]: -$SPARK_WIDTH}")
  TOTAL=$((TOTAL + 1))
}

draw_recent() {
  printf "  %b%s%b\n" "$BOLD$W" "RECENT CALLS" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"
  printf "  "
  for v in "${HISTORY[@]}"; do
    case "$v" in
      v1) printf "%bv1%b " "$BG_B$W" "$RESET" ;;
      v2) printf "%bv2%b " "$BG_G$W" "$RESET" ;;
      *)  printf "%b?%b " "$BG_R$W" "$RESET" ;;
    esac
  done
  printf "\n\n"
}

draw_invariant() {
  printf "  %b%s%b\n" "$BOLD$W" "INVARIANT — ZERO DOWNTIME EVIDENCE" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"
  local fivexx
  fivexx=$(fetch_rolling_5xx "$START_EPOCH")
  if [ "${fivexx:-0}" = "0" ]; then
    printf "  %b✓ HTTP 5xx since watch start: %s%b\n\n" "$G" "$fivexx" "$RESET"
  else
    printf "  %b✗ HTTP 5xx since watch start: %s%b\n\n" "$R" "$fivexx" "$RESET"
  fi
}

trap 'echo; exit 0' INT
while true; do
  call_one
  draw_header
  draw_refresh_progress
  draw_inventory
  draw_tg_health
  draw_recent
  draw_invariant
  sleep "$INTERVAL"
done
```

- [ ] **Step 2: Make executable + shellcheck**

```bash
chmod +x demos/watch-rolling.sh
shellcheck demos/watch-rolling.sh
```

Expected: no warnings.

- [ ] **Step 3: Commit**

```bash
git add demos/watch-rolling.sh
git commit -m "feat(demos): add watch-rolling.sh 6-section live monitor"
```

---

### Task C6: `launcher.sh` — additive menu section

**Files:**
- Modify: `demos/launcher.sh`

- [ ] **Step 1: Add rolling CF URL to header**

In `demos/launcher.sh`, find the `weights=$(fetch_active_weights)` line and the following `printf` that prints weights. After that printf, add:

```bash
  local rolling_cf
  rolling_cf=$(fetch_rolling_cf_url)
  printf "  %bRollingCF%b: %s\n" "$BOLD" "$RESET" "$rolling_cf"
```

- [ ] **Step 2: Add menu section above `[q] Quit`**

Find the line `printf '  %b [q] %b  Quit\n' "$BG_R$W$BOLD" "$RESET"` and, immediately **above** it, insert:

```bash
  echo
  printf '  %bEC2 ASG Rolling Demo (Warm Pool)%b\n' "$D$BOLD" "$RESET"
  printf '  %b%b [R1] %b  %bDeploy Rolling%b                  %b(v1 @ private1)%b\n' "$BOLD" "$BG_C$W" "$RESET" "$W$BOLD" "$RESET" "$D" "$RESET"
  printf '  %b%b [R2] %b  %bInstance Refresh%b                %b./scenario-rolling-2-refresh.sh [pct]%b\n' "$BOLD" "$BG_G$W" "$RESET" "$W$BOLD" "$RESET" "$D" "$RESET"
  printf '  %b%b [R3] %b  %bRollback%b                        %b./scenario-rolling-3-rollback.sh [pct]%b\n' "$BOLD" "$BG_Y$W" "$RESET" "$W$BOLD" "$RESET" "$D" "$RESET"
  printf '  %b%b [W] %b   %bWatch Rolling Progress%b          %b(separate terminal)%b\n' "$BOLD" "$BG_M$W" "$RESET" "$W$BOLD" "$RESET" "$D" "$RESET"
```

- [ ] **Step 3: Add case entries before `q|Q)`**

In the case statement at the bottom, before `q|Q)`:

```bash
    R1|r1) run_scenario "scenario-rolling-1-deploy.sh" ;;
    R2|r2) run_scenario "scenario-rolling-2-refresh.sh" ;;
    R3|r3) run_scenario "scenario-rolling-3-rollback.sh" ;;
    W|w)   run_scenario "watch-rolling.sh" ;;
```

- [ ] **Step 4: Update prompt label**

Find `printf '  %bSelect [1-7, q]: %b ' ...` and change `1-7, q` to `1-7, R1-R3, W, q`.

- [ ] **Step 5: Shellcheck**

Run: `shellcheck demos/launcher.sh`

Expected: no new warnings.

- [ ] **Step 6: Verify menu renders**

Run: `timeout 1 bash demos/launcher.sh < /dev/null 2>&1 | grep -E "\[1\]|\[R1\]|\[W\]"`

Expected: lines for `[1]`, `[R1]`, `[W]` all visible.

- [ ] **Step 7: Commit**

```bash
git add demos/launcher.sh
git commit -m "feat(demos): add Rolling menu section to launcher (additive)"
```

---

## Phase D — Live Rehearsal (Verification Gates)

### Task D1 (Gate): Regression — existing Blue/Green demo still works

**Files:** (no code — verification)

- [ ] **Step 1: Existing scenario1 deploy**

Run: `./demos/scenario1-deploy-blue.sh`

Expected: prior behavior unchanged. CDK deploy succeeds.

- [ ] **Step 2: Existing scenario3 shift**

Run: `./demos/scenario3-shift-traffic.sh 50`

Expected: ALB weights show `Blue 50 / Green 50`.

- [ ] **Step 3: Existing watch script**

Run: `timeout 10 ./demos/watch-bluegreen-traffic.sh 2 || true`

Expected: 4-section TUI renders without errors.

- [ ] **Step 4: Existing rollback**

Run: `./demos/scenario4-rollback-to-blue.sh`

Expected: ALB weights `Blue 100 / Green 0`.

STOP if any step fails — additive principle violated.

### Task D2 (Gate): Rolling demo end-to-end

**Files:** (no code — verification)

- [ ] **Step 1: Deploy rolling stack**

Run: `./demos/scenario-rolling-1-deploy.sh`

Expected: `BgTestRollingStack` and `BgTestRollingCfStack` created. ASG healthy=4, Warm Pool stopped=4.

- [ ] **Step 2: Open second terminal with watch**

Run: `./demos/watch-rolling.sh`

Expected: 6 sections render every 2s. Refresh section shows "No refresh history yet".

- [ ] **Step 3: Trigger refresh**

In terminal 1: `./demos/scenario-rolling-2-refresh.sh 50`

Expected:
- CDK deploys (LT v2, ASG VPCZoneIdentifier=[private2])
- Instance refresh starts
- Polling shows 0% → 25% → 50% → 75% → 100% over ~3-5 min (Warm Pool helps)
- Watch terminal shows inventory shifting and 5xx remaining 0

- [ ] **Step 4: Trigger rollback**

Run: `./demos/scenario-rolling-3-rollback.sh 50`

Expected: reverse refresh succeeds. Final: 4× v1 @ private1.

- [ ] **Step 5: Verify INVARIANT held**

Run:

```bash
ALB_ARN=$(aws elbv2 describe-load-balancers --names bg-rolling-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text)
ALB_DIM=$(echo "$ALB_ARN" | sed -E 's|^.*loadbalancer/||')
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
START=$(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
aws cloudwatch get-metric-statistics --namespace AWS/ApplicationELB \
  --metric-name HTTPCode_Target_5XX_Count \
  --dimensions Name=LoadBalancer,Value="$ALB_DIM" \
  --statistics Sum --period 60 --start-time "$START" --end-time "$NOW" \
  --query 'sum(Datapoints[].Sum)'
```

Expected: `0`.

### Task D3 (Optional): Concurrent isolation check

**Files:** (no code — verification)

- [ ] **Step 1: Run existing weight shift and rolling refresh concurrently**

Terminal A: `./demos/scenario-rolling-2-refresh.sh 100`
Terminal B (during refresh): `./demos/scenario3-shift-traffic.sh 25`

Expected: both succeed, no resource conflicts. `bg-*` and `bg-rolling-*` resources operate independently.

---

## Self-Review Notes

This plan was self-reviewed against the spec on 2026-05-13. Coverage map:

| Spec Section | Covered by |
|--------------|-----------|
| §4.1 Architecture | Task A1-A10 |
| §4.2 BgTestRollingStack | A1-A7 |
| §4.2 RollingCfStack | A8 |
| §4.3 bin/app.ts + validation | A9 (pure fn), A10 (wiring) |
| §4.4 app/server.js | B1 |
| §4.5 image build | B2-B3 |
| §4.6 scenario scripts | C2-C4 |
| §4.7 watch-rolling | C5 |
| §4.8 shared.sh helpers | C1 |
| §4.9 launcher menu | C6 |
| §4.10 Security (SG-to-SG) | A3, A5 |
| §4.11 naming | embedded in A2-A8 |
| §5 Confirmed Decisions | All applied |
| §6 Phase A-D | Mirrored 1:1 |
| §7 Testing | A10 Step 5-6 (synth/diff), D1-D3 (live) |

No placeholder text. All file paths exact. All code blocks complete and runnable.

---

## Execution Notes

- **Commit cadence**: ~19 commits across A1-A10, B1-B2, C1-C6. Verification gates (D1-D3) and runtime actions (B3) don't commit.
- **Skip B3 first time** if `:v1` and `:v2` already exist in ECR.
- **Phase D requires live AWS deploy** (~15-20 min for first rolling deploy due to CloudFront propagation).
- **If A10 Step 6 fails** (existing stack diff is non-zero) — investigate before continuing. Common cause: accidental shared resource modification.

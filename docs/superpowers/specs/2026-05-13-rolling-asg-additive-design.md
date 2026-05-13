# EC2 단일 ASG Rolling Migration (Additive) — Design Spec

| Field | Value |
|-------|-------|
| Date | 2026-05-13 |
| Status | Approved — ready for implementation plan |
| Author | bg-test 시연 프로젝트 |
| Related | [2026-04-28 Blue/Green CDK design](./2026-04-28-bluegreen-cdk-design.md) (baseline) |

---

## 1. Summary

기존 ALB-weighted Blue/Green 시연을 **0 라인 수정**으로 보존한 채, **EC2 단일 ASG + Warm Pool + Instance Refresh** 기반의 Rolling Migration 시연을 *추가* 시연 자산으로 더한다. 두 시연은 동일 VPC / Aurora / Redis / ECR을 공유하지만 ALB, ASG, LaunchTemplate, CloudFront, 시나리오 스크립트는 완전 분리된다. 청중에게 "weighted traffic split" 패턴과 "in-place rolling with subnet migration" 패턴의 차이를 한 데모 자료 안에서 비교 학습시키는 것이 목적.

핵심 메커니즘은 ASG의 `LaunchTemplateVersion` + `VPCZoneIdentifier`를 동시에 변경한 뒤 Instance Refresh로 *전개*하여, private1(v1) 자원이 점진 제거되고 private2(v2) 자원으로 무중단 대체되는 것을 시각화한다. Warm Pool(Stopped 상태)이 ASG에 부착되어 새 인스턴스의 cold start 시간을 제거한다.

## 2. Goals / Non-Goals

### Goals

- 기존 Blue/Green 시연 자산(CDK stack 7개, scenario 6개, watch TUI 1개)을 **코드 수준에서 0 라인 수정**으로 보존.
- EC2 ASG 단 한 종류의 워크로드로 *Warm Pool + Instance Refresh + Subnet 마이그레이션* 메커니즘 시연.
- 시연자가 `cdk deploy -c includeRolling=true ...` 한 번으로 신규 환경 배포, 시연 후 `-c includeRolling=false`로 제거.
- 청중이 보는 측정 가능 invariant: Refresh 시작 이후 HTTP 5xx **누적 0건**.
- 두 시연이 동일 VPC에서 *동시에* 동작 가능 (자원 이름 prefix로 격리).

### Non-Goals

- ECS-EC2, Fargate 워크로드의 Rolling 시연 — 이번 범위 밖. EC2 ASG가 메커니즘 설명에 충분.
- Canary deploy 시연 (priority-2 listener rule + 부분 weight) — 추후 별도 spec.
- 기존 Blue/Green 시연의 개선/리팩토링 — 이번 spec은 *additive only*.
- 자동화된 rollback (CloudWatch Alarm 트리거) — 시연자 수동 트리거로 충분.

## 3. Background — 현재 상태

기존 main 브랜치는 [2026-04-28 Blue/Green design](./2026-04-28-bluegreen-cdk-design.md)을 구현한 상태. 요약:

- **CDK Stack 7개**: Network, Data, Ecr, Cluster, Alb, BlueCompute, GreenCompute, Cf
- **워크로드 3종 × 색 2종 = 6 fleet**: EC2 ASG, ECS-EC2, Fargate 각각 Blue/Green
- **트래픽 분산**: ALB priority-1 listener rule의 `weightedForward` action으로 1-2초 내 weight 조정
- **시나리오 6개**: scenario1~4 + slider + progressive-shift
- **현재 가중치**: Blue 50 / Green 50 (라이브 확인됨)
- **`private2-a/b` 서브넷**: 10.1.8.0/22, 10.1.12.0/22 (primary CIDR free space에 carve, secondary CIDR 10.2.0.0/16 association은 시연용)

이 자산은 모두 보존된다. Rolling 시연은 이 위에 *추가*로 얹힌다.

## 4. Design

### 4.1 Architecture

```
                       VPC 10.1.0.0/16 (+ secondary 10.2.0.0/16)
   ┌──────────────────────────────────────────────────────────────────────┐
   │                                                                      │
   │  ┌─ 기존 (보존) ─────────────────────────┐                           │
   │  │  3× ALB (ec2asg, ecsec2, ecsfg)       │  ← BgTestAlbStack         │
   │  │   ├─ weighted forward (Blue/Green)     │                           │
   │  │  6× Compute fleets                     │  ← BgTestBlueStack,       │
   │  │   ├─ EC2 ASG × 2색 @ private1/2         │     BgTestGreenStack     │
   │  │   ├─ ECS-EC2 × 2색                      │                           │
   │  │   └─ Fargate × 2색                      │                           │
   │  └────────────────────────────────────────┘                           │
   │                                                                      │
   │  ┌─ 신규 (additive, includeRolling=true)──┐                           │
   │  │  1× ALB (rolling)                      │  ← BgTestRollingStack     │
   │  │   └─ 단일 forward → 단일 TG             │                           │
   │  │  1× ASG (bg-rolling-ec2asg)             │                           │
   │  │   ├─ In-Service: 4× @ private1/2        │                           │
   │  │   └─ Warm Pool: 4× stopped              │                           │
   │  └────────────────────────────────────────┘                           │
   │                                                                      │
   │  공유: VPC, Subnets, Aurora, Redis, ECR                              │
   └──────────────────────────────────────────────────────────────────────┘

       기존 CF (d1234)            신규 CF (d5678)
            ↓                          ↓
       Blue/Green 데모             Rolling 데모
```

### 4.2 신규 CDK Stack

#### `BgTestRollingStack` (`lib/rolling-stack.ts`)

자체 ALB + 단일 TG + 단일 ASG + Warm Pool + LaunchTemplate를 한 스택에 통합.

```ts
export interface BgTestRollingStackProps extends cdk.StackProps {
  networkStack: BgTestNetworkStack;
  dataStack: BgTestDataStack;
  ecrStack: BgTestEcrStack;
  cloudFrontPrefixListId: string;
  launchVersion: 'v1' | 'v2';
  targetSubnet: 'private1' | 'private2';
}
```

주요 자원:

- `bg-rolling-alb` (internet-facing, ALB SG는 CloudFront prefix list만 ingress)
- `bg-rolling-tg` (단일 TG, healthCheck `/health`)
- `bg-rolling-secret` (`X-Custom-Secret` header — CF→ALB)
- `bg-rolling-lt` LaunchTemplate
- `bg-rolling-ec2asg` ASG (desired=4, min=4, max=8)
- WarmPool (L1 `CfnWarmPool`, PoolState=Stopped, MaxGroupPreparedCapacity=4, MinSize=4)

LaunchTemplate user-data는 환경변수로 `COLOR`(시각화), `VERSION`(인프라 추상), `COMPUTE_TYPE=ec2-rolling`을 박는다. `launchVersion`에 따라:

- `v1`: image tag `:v1`, `COLOR=blue`, `VERSION=v1`
- `v2`: image tag `:v2`, `COLOR=green`, `VERSION=v2`

ASG의 `vpcSubnets`는 `targetSubnet`에 따라 `private1Subnets` 또는 `private2Subnets` 선택.

#### `BgTestRollingCfStack` (`lib/rolling-cf-stack.ts`)

기존 `BgTestCfStack`과 별도. `BgTestRollingStack.alb`를 origin으로 하는 단일 CloudFront distribution.

### 4.3 `bin/app.ts` 변경

```ts
const includeSecondaryCidr = ctx('includeSecondaryCidr') === true;
const includeGreen = ctx('includeGreen') === true;
const includeRolling = ctx('includeRolling') === true;        // 신규
const rollingLaunchVersion = ctx('rollingLaunchVersion') ?? 'v1';  // 신규
const rollingTargetSubnet = ctx('rollingTargetSubnet') ?? 'private1';  // 신규

// 기존 stack 인스턴스화 (변경 없음)
// ...

// 신규: 조건부 인스턴스화
if (includeRolling) {
  if (!includeSecondaryCidr) {
    throw new Error('includeRolling=true requires includeSecondaryCidr=true');
  }
  if (rollingTargetSubnet === 'private2' && !includeSecondaryCidr) {
    throw new Error('rollingTargetSubnet=private2 requires includeSecondaryCidr=true');
  }
  const rolling = new BgTestRollingStack(app, 'BgTestRollingStack', {
    env, networkStack: network, dataStack: data, ecrStack: ecr,
    cloudFrontPrefixListId,
    launchVersion: rollingLaunchVersion,
    targetSubnet: rollingTargetSubnet,
  });
  rolling.addDependency(network);
  rolling.addDependency(data);
  rolling.addDependency(ecr);
  
  const rollingCf = new BgTestRollingCfStack(app, 'BgTestRollingCfStack', {
    env, rollingStack: rolling,
  });
  rollingCf.addDependency(rolling);
}
```

기존 stack 코드는 일절 안 건드림. validation 한 줄로 `includeRolling`이 `includeSecondaryCidr`를 전제하도록 강제.

### 4.4 앱 변경 — `app/server.js`

```js
const COLOR = process.env.COLOR ?? 'blue';
const VERSION = process.env.VERSION ?? COLOR;  // 신규: VERSION env (fallback)

// /info 응답에 version 필드 추가
res.json({
  color: COLOR, version: VERSION, compute: COMPUTE_TYPE,
  hostname: os.hostname(), redisHits, dbPingMs,
});
```

기존 Blue/Green 시연은 `version` 필드 사용 안 함 — 호환 유지. Rolling watch만 `version`을 읽는다.

### 4.5 이미지 빌드 — `scripts/push-image.sh`

이미지는 *dumb*: 환경변수로 다양화. 한 번 build 후 4개 태그로 push.

```bash
# Usage: ./scripts/push-image.sh <tag>
TAG="${1:?usage: push-image.sh <tag>}"
docker buildx build --platform linux/arm64 -t bg-app:${TAG} ./app
docker tag bg-app:${TAG} ${ECR_URI}:${TAG}
docker push ${ECR_URI}:${TAG}
```

시연자가 `./push-image.sh v1`, `./push-image.sh v2`로 명시 호출.

### 4.6 신규 시나리오

#### `demos/scenario-rolling-1-deploy.sh` — Initial Deploy

1. 사전 점검: `includeSecondaryCidr=true`로 private2 carve 완료 여부 (없으면 기존 scenario2 실행 안내)
2. `cdk deploy --all -c includeSecondaryCidr=true -c includeRolling=true -c rollingLaunchVersion=v1 -c rollingTargetSubnet=private1`
3. 검증:
   - ASG `bg-rolling-ec2asg`: desired=4, healthy=4
   - 모든 인스턴스 @ private1
   - Warm Pool: 4× stopped @ private1
   - ALB `bg-rolling-alb`: healthy targets=4
   - 응답: `{"color":"blue","version":"v1",...}`

#### `demos/scenario-rolling-2-refresh.sh [min_healthy_pct]` — Migration

```
Usage: ./demos/scenario-rolling-2-refresh.sh [min_healthy_pct]
기본 min_healthy_pct = 50
```

1. 사전 점검: ECR에 `:v2` 태그 존재 여부
2. *의도 등록*: `cdk deploy --all -c includeSecondaryCidr=true -c includeRolling=true -c rollingLaunchVersion=v2 -c rollingTargetSubnet=private2`
3. *실행 전 검증*: ASG.LT.LatestVersionNumber, VPCZoneIdentifier 확인 — 실 인스턴스는 *아직* v1@private1
4. `aws autoscaling start-instance-refresh --auto-scaling-group-name bg-rolling-ec2asg --strategy Rolling --preferences '{"MinHealthyPercentage":<arg>,"InstanceWarmup":120,"ScaleInProtectedInstances":"Refresh","StandbyInstances":"Terminate"}' --desired-configuration '{"LaunchTemplate":{"LaunchTemplateId":"...","Version":"$Latest"}}'`
5. Polling (60s 간격): refresh status + percentage 출력. 별도 터미널 `watch-rolling.sh` 권장 안내
6. 완료 후 검증: 모든 인스턴스 v2 @ private2, 5xx 누적=0

#### `demos/scenario-rolling-3-rollback.sh [min_healthy_pct]` — Rollback

scenario-rolling-2와 동일 패턴, 매개변수만 반대 (`rollingLaunchVersion=v1`, `rollingTargetSubnet=private1`).

### 4.7 신규 Watch — `demos/watch-rolling.sh`

별도 터미널에서 실행. INTERVAL 기본 2초. 6개 섹션:

1. **INSTANCE REFRESH PROGRESS** — `describe-instance-refreshes` 최신 1건의 status + percentage bar + 시작 시각 + 대상 LT/subnet
2. **INSTANCE INVENTORY** — `describe-auto-scaling-groups` + `describe-instances`로 in-service 4 + warm-pool 4 모두 표시. 인스턴스별 subnet, LT version, lifecycle state. 분포 bar (subnet별, version별)
3. **ALB TG HEALTH** — `describe-target-health`로 healthy/draining/unhealthy 카운트
4. **DATA TIER HEALTH** — CF URL `/redis/hit`, `/db/ping` 폴링. OK/DEGRADED/DOWN 배지 + 응답한 v1/v2 색 배지
5. **RECENT CALLS** — CF URL `/info` 매 iteration 폴링. 마지막 60개 응답의 `version` 값 sparkline + 비율 bar
6. **INVARIANT** — 5xx 누적 (refresh 시작 이후), 평균 응답시간, p95

### 4.8 `demos/shared.sh` 변경

기존 함수 모두 보존. 신규 함수만 추가:

- `fetch_rolling_refresh_status` — `describe-instance-refreshes` 최신 1건
- `fetch_rolling_asg_inventory` — ASG instances (in-service + warm-pool 모두), instance details join
- `fetch_rolling_tg_health` — `describe-target-health`
- `fetch_rolling_5xx` — CloudWatch ALB metric `HTTPCode_Target_5XX_Count` since refresh start
- `map_subnet_to_label` — subnet ID → name 캐시 (첫 호출 시 `describe-subnets`)
- `map_lt_version_to_color` — v1→blue, v2→green

### 4.9 `demos/launcher.sh` 메뉴 변경

기존 7개 메뉴 + 신규 4개 메뉴 (두 섹션으로 시각 분리):

```
  ALB Weighted Blue/Green Demo                    ← 기존
  [1] Deploy Blue            [2] Add Secondary CIDR
  [3] Shift Traffic          [4] Progressive Auto-Shift
  [5] Slider TUI             [6] Rollback to Blue
  [7] Watch Blue/Green

  EC2 ASG Rolling Demo (Warm Pool)                ← 신규
  [R1] Deploy Rolling        [R2] Instance Refresh
  [R3] Rollback              [W]  Watch Rolling

  [q] Quit
```

상단에 두 CF URL 모두 표시. ASG 상태 표시는 기존(Blue/Green weight) + Rolling(LT version + subnet) 둘 다.

### 4.10 Security — 보안 계층

기존 `BgTestAlbStack`의 보안 모델을 그대로 재사용하되, **Instance SG ingress는 SG-to-SG 참조로 한 단계 강화**한다.

| Layer | 자원 | Rule | 의도 |
|-------|------|------|------|
| **L1: ALB ingress** | `bg-rolling-alb-sg` | `CfnSecurityGroupIngress` with `sourcePrefixListId=pl-22a6434b` (CloudFront origin prefix list, ap-northeast-2) | ALB 직접 IP 접근 차단 — CloudFront origin-facing IP만 |
| **L2: Listener priority-1** | `bg-rolling-alb` listener | priority-1 rule: `X-Custom-Secret: <secret>` header 매칭 시 forward, 기본 action `403 Access Denied` | CF origin이 inject한 secret 없이는 403 |
| **L3: Instance ingress** | `bg-rolling-instance-sg` | `ec2.Peer.securityGroupId(albSg.securityGroupId)` from port 80 *(기존 패턴 `Peer.ipv4(primaryCidr)`에서 강화)* | `bg-rolling-alb-sg`에 속한 자원에서만 instance:80 접근 — VPC 내부 다른 자원 우회 차단 |
| **L4: Outbound** | 인스턴스 | `allowAllOutbound: true` | Data tier(Aurora/Redis), ECR, NAT GW egress |
| **L5: Data tier ingress** | Aurora SG, Redis SG | `instanceSg`에서 각각 3306, 6379 추가 | 기존 패턴과 동일 — Instance SG → Data SG 명시 ingress |
| **L6: CloudFront** | `BgTestRollingCfStack` | viewer protocol policy `redirect-to-https`, origin protocol `http-only`, custom header `X-Custom-Secret` inject | HTTPS 강제 + ALB까지의 secret 전달 |

기존 Blue/Green 시연(`BgTestAlbStack` + `BgTestBlueStack`/`GreenStack`)의 instance SG는 `ec2.Peer.ipv4(primaryCidr)`로 primary CIDR 전체 허용. Rolling 시연은 **SG-to-SG 참조**로 좁혀, 같은 VPC 내 다른 자원의 우회 접근까지 차단.

선택적 추가 강화 (이번 spec 범위 밖, future work로 분류):

- AWS WAF Web ACL을 CloudFront에 attach (Managed Rules: SQLi, XSS, Known Bad Inputs)
- ALB access log를 S3 bucket에 활성화 (감사 추적)
- VPC Flow Logs 활성화
- CloudFront origin custom header 값 rotation (현재는 stack 배포 시 고정)

### 4.11 리소스 이름 규칙

| 카테고리 | 기존 prefix | 신규 prefix |
|---------|-----------|-----------|
| ALB | `bg-alb-{ec2asg,ecsec2,ecsfg}` | `bg-rolling-alb` |
| TG | `bg-tg-{workload}-{color}` | `bg-rolling-tg` |
| ASG | `bg-ec2asg-{color}`, `bg-ecsec2-host-{color}` | `bg-rolling-ec2asg` |
| LT | (ASG 내장) | `bg-rolling-lt` |
| SG | `bg-{workload}-{color}-sg` | `bg-rolling-alb-sg`, `bg-rolling-instance-sg` |
| CloudFront | (기존 tag) | `bg-rolling-cf` tag |

모든 `bg-rolling-*` 자원은 격리된 namespace.

## 5. Confirmed Decisions

| 항목 | 결정 |
|------|------|
| 워크로드 범위 | EC2 ASG 단일 (ECS-EC2, Fargate 제외) |
| 기존 자산 처리 | 보존, 신규 additive |
| Narrative 단계 수 | 3단계 (Deploy → Refresh → Rollback). VPC IP 확장(Phase 2)은 기존 scenario2 재활용 |
| Warm Pool | 기본 활성화, PoolState=Stopped, MaxGroupPreparedCapacity=4 |
| Instance Refresh 시 Warm Pool | `IncludeWarmPool=true` (CDK 기본) — Warm Pool도 함께 cycling |
| CloudFront | 별도 distribution (`BgTestRollingCfStack`) |
| 이미지 모델 | dumb image + env 주입 (build-arg 분기 없음) |
| 환경변수 | `COLOR` + `VERSION` 둘 다 주입 |
| MinHealthyPercentage 입력 | scenario 인자 (기본 50) |
| scenario3 안 polling | 포함 (별도 watch 권장 안내 병행) |
| Watch 5xx counter window | refresh 시작 이후 *누적* |
| Watch INTERVAL 기본값 | 2초 |
| validation | `includeRolling=true` ⇒ `includeSecondaryCidr=true` 강제 |
| ALB SG ingress | CloudFront prefix list만 (기존 패턴 그대로) |
| Instance SG ingress | **SG-to-SG 참조로 강화** (기존 `Peer.ipv4(primaryCidr)`에서 한 단계 좁힘) |

## 6. Implementation Plan

### Phase A — Infrastructure Code

1. `lib/rolling-stack.ts` — ALB + ASG + WarmPool + LaunchTemplate 통합 스택
2. `lib/rolling-cf-stack.ts` — CloudFront
3. `bin/app.ts` — context flag + conditional 인스턴스화 + validation

**Gate A1**: `cdk synth --all -c includeRolling=true -c includeSecondaryCidr=true` 성공, dep cycle 없음.

**Gate A2**: `cdk diff --all -c includeRolling=false`에서 기존 stack 변경 0 라인 검증.

### Phase B — App / Image

1. `app/server.js` — `VERSION` env + `/info` 응답에 `version` 필드
2. `scripts/push-image.sh` — tag 인자화
3. ECR로 `:v1`, `:v2` 이미지 push (실제로는 동일 이미지)

**Gate B1**: `docker run --rm -e VERSION=v1 -e COLOR=blue bg-app:v1` 응답에 `"version":"v1"`.

**Gate B2**: ECR에 4 태그 (`:blue`, `:green`, `:v1`, `:v2`) 존재 확인.

### Phase C — Demo Assets

1. `demos/shared.sh` — Rolling helper 함수 추가 (기존 함수 0 라인 수정)
2. `demos/scenario-rolling-1-deploy.sh`
3. `demos/scenario-rolling-2-refresh.sh`
4. `demos/scenario-rolling-3-rollback.sh`
5. `demos/watch-rolling.sh`
6. `demos/launcher.sh` — 메뉴 섹션 추가 + 상단 상태 표시 확장

**Gate C1**: `shellcheck demos/*.sh` 모두 통과.

**Gate C2**: `./demos/launcher.sh`가 메뉴 11항목 정상 렌더 + 상태 라인 정상.

### Phase D — Live Rehearsal

1. **D1 Regression**: 기존 시나리오 4개 실행 → 정상 동작 확인. `./scenario1-deploy-blue.sh` → `./scenario3-shift-traffic.sh 50` → `./scenario4-rollback-to-blue.sh`. 기존 `watch-bluegreen-traffic.sh` 정상.
2. **D2 Rolling 시연**: `./scenario-rolling-1-deploy.sh` → 별도 터미널 `./watch-rolling.sh` → `./scenario-rolling-2-refresh.sh 50` → 진행률 시각화 → `./scenario-rolling-3-rollback.sh 50`. 5xx 누적=0 확인.
3. **D3 (선택) 동시 격리**: 기존 + Rolling 데모를 동시에 돌려 `bg-*` vs `bg-rolling-*` 자원 충돌 없음 확인.

**Gate D2**: Refresh 시작 후 완료까지 CloudWatch ALB 메트릭 `HTTPCode_Target_5XX_Count` 합계 0.

## 7. Testing & Rehearsal

### 7.1 단위 검증

- `cdk synth` 출력에서 자원 prefix `bg-rolling-*` 8종 모두 존재
- 기존 자원(`bg-alb-ec2asg`, `bg-ec2asg-blue` 등)은 unchanged
- ASG LaunchTemplate user-data에 `COLOR` + `VERSION` env 박힘

### 7.2 통합 검증 (실 AWS)

- Phase 1 (Deploy): ASG healthy=4, Warm Pool stopped=4
- Phase 2 (Refresh start): describe-instance-refreshes returns `InProgress`
- Phase 2 (mid): inventory 분포 in-service v1:v2 = 2:2 또는 1:3, draining 인스턴스 보임
- Phase 2 (complete): 모든 인스턴스 v2 @ private2, 5xx=0
- Phase 3 (rollback): 모든 인스턴스 v1 @ private1 복귀, 5xx=0

### 7.3 Rehearsal 시나리오

```
풀 시연 ~20분:
  0:00  [1]      Deploy Blue (기존 시연)
  8:00  [2]      Add Secondary CIDR
  9:00  [3] 50%  → [5] Slider → [6] Rollback (기존 시연 종합)
  12:00 [R1]     Deploy Rolling (Warm Pool 시각화)
  14:00 별도 터미널 ./watch-rolling.sh
  14:30 [R2] 50% Rolling Refresh
  17:30 [R3]     Rollback (anti-direction)
  20:00 끝
```

## 8. Future Work (이번 spec 범위 밖)

- **Canary**: priority-2 listener rule + 부분 weight (예: 10% v2)로 진정한 canary
- **합성 데모**: Blue/Green weight 50/50 후 Green 측 Rolling 교체 시연
- **CloudWatch Alarm 자동 rollback**: 5xx 임계 초과 시 Instance Refresh 자동 cancel + 역방향 트리거
- **ECS Rolling 시연**: ECS Service의 `minimumHealthyPercent` / `maximumPercent`로 task 단위 rolling 패턴 별도 spec
- **추가 보안 강화**: AWS WAF Web ACL을 CloudFront에 attach (Managed Rules), ALB access log → S3, VPC Flow Logs, custom header secret rotation. 시연 자산이 아니라 운영성 강화 영역이므로 별도 spec

## 9. Open Risks

- **CloudFront propagation 시간**: 신규 distribution 첫 deploy 시 ~5-10분. 시연 직전 미리 배포 필요.
- **Warm Pool 인스턴스의 cold start 후 정지 시간**: launch → /health 통과 → stop까지 ~2분. Refresh 시작 직후 첫 사이클이 평소보다 느릴 수 있음. 시연자는 "첫 사이클은 Warm Pool 재충전 포함" 설명 필요.
- **ECR 동일 이미지 4 tag push**: ECR이 같은 manifest를 가리키지만 *태그별*로 garbage collection 정책이 다를 수 있음. lifecycle policy 검토 필요.
- **시연 환경 비용**: Warm Pool 4× t4g.xlarge stopped + EBS 30GB GP3 = 약 $9.6/월/instance × 4 = ~$38/월 추가. 시연 안 할 때는 `includeRolling=false`로 destroy 권장.

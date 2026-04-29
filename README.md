# Blue/Green CDK Test

ALB weighted target group 기반 Blue/Green 시연 + VPC 진화(서브넷 마이그레이션) 시연용 CDK 프로젝트.

## VPC 토폴로지 (배포 후)

| 영역 | CIDR | 용도 |
|---|---|---|
| Primary CIDR | `10.1.0.0/16` | 모든 자원 거주 |
| ↳ private1 (auto /24×2) | `10.1.2.0/24`, `10.1.3.0/24` | **Blue compute** |
| ↳ private2 (manual /22×2) | `10.1.8.0/22`, `10.1.12.0/22` | **Green compute** (마이그레이션 자리) |
| ↳ private3 (auto /24×2) | `10.1.4.0/24`, `10.1.5.0/24` | 예약 |
| ↳ public, db | … | ALB+NAT, Aurora |
| Secondary CIDR | `10.2.0.0/16` | **시연용 association만** (자원 없음) |

> 색상 전환은 CDK 재배포가 아니라 ALB weighted listener rule로 제어합니다. Blue/Green TG는 두 stack(Blue/Green)에 걸쳐 공유 ALB(BgTestAlbStack) 위에서 가중치만 바뀝니다.

## Quick Start

```bash
npm install
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/ap-northeast-2
./demos/launcher.sh
```

## Stacks

| Stack | 책임 |
|---|---|
| BgTestNetworkStack | VPC, 서브넷, NAT, VPC endpoints |
| BgTestDataStack | Aurora MySQL 8.0/3.08, ElastiCache Redis 7.1 |
| BgTestEcrStack | ECR repo bg-app |
| BgTestClusterStack | ECS cluster test-cluster (단일, Blue/Green 공유) |
| BgTestAlbStack | ALB×3 + Blue/Green TG + weighted listener rule (가중치 진실의 원천) |
| BgTestBlueStack | EC2 ASG + ECS service×2, private1 거주 |
| BgTestGreenStack | EC2 ASG + ECS service×2, private2 거주 (includeGreen=true 시) |
| BgTestCfStack | CloudFront 1 distribution + 3 origins + 4 behaviors |

## Scenarios (`demos/launcher.sh`)

**Phase 1 — Deploy**
1. `scenario1-deploy-blue.sh` — Blue 인프라 배포
2. `scenario2-add-secondary-cidr.sh` — secondary CIDR 시연 + private2 /22 carve-out

**Phase 2 — Traffic Control (ALB weighted)**
3. `scenario3-shift-traffic.sh <green_pct>` — 정확한 % 즉시 적용
4. `scenario-progressive-shift.sh [interval_s]` — 0→10→25→50→75→90→100 자동 점진
5. `scenario-slider.sh` — TUI 인터랙티브 슬라이더 (←→ ±5, +/- ±1)
6. `scenario4-rollback-to-blue.sh` — 풀 Blue 복귀

**Observability**
7. `watch-bluegreen-traffic.sh` — 별도 터미널 라이브 모니터

## CDK Context

| Key | Default | 의미 |
|---|---|---|
| includeSecondaryCidr | false | 10.2.0.0/16 association 추가 (시연용) + private2 /22 서브넷을 primary CIDR에 carve |
| includeGreen | false | GreenStack + 가중치 0인 Green TG 배포 |
| cloudFrontPrefixListId | pl-22a6434b | CloudFront origin-facing managed prefix list (ap-northeast-2 default) |

> 트래픽 색상 전환은 CDK 재배포가 아닌 ALB weighted listener rule로 제어합니다. 위 Phase 2 스크립트들 모두 `aws elbv2 modify-rule`을 호출해 1-2초 내 반영합니다.

## Tests

```bash
npm test                                 # 모든 stack 단위 테스트
npm test -- test/network-stack.test.ts   # 특정 stack 테스트
cd app && node --test test/server.test.js  # Express app 테스트
```

## Spec / Plan

- 설계: `docs/superpowers/specs/2026-04-28-bluegreen-cdk-design.md`
- 구현 계획: `docs/superpowers/plans/2026-04-28-bluegreen-cdk.md`

## Cleanup

```bash
npx cdk destroy --all
```

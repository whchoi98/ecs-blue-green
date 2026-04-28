# Blue/Green CDK Test

Phase 1 — Blue 인프라 + VPC secondary CIDR 시나리오 시연용 CDK 프로젝트.

## Quick Start

```bash
npm install
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/ap-northeast-2
./demos/launcher.sh
```

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

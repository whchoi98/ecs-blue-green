# Blue/Green CDK Test

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-0.1.0-green.svg)]()
<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

ALB weighted Blue/Green + EC2 ASG Rolling migration CDK demo | ALB 가중치 기반 Blue/Green + EC2 ASG 롤링 마이그레이션 CDK 시연

---

<a id="english"></a>

# English

## Overview

This project demonstrates two AWS compute migration patterns on ap-northeast-2 (Seoul) using AWS CDK TypeScript:

1. **Blue/Green traffic shifting** -- Two parallel compute tiers (Blue: private1 subnets, Green: private2 subnets) share a common Application Load Balancer. Traffic percentage between tiers is changed in real time by modifying ALB weighted listener rules via AWS CLI, with no CDK redeployment required.
2. **EC2 ASG Rolling update** -- A separate stack (BgTestRollingStack) demonstrates graceful instance refresh using an independent ALB and CloudFront distribution with a Warm Pool for pre-warmed standby instances.

## Features

- **Zero-downtime Blue/Green** -- ALB weighted rule changes take effect in 1-2 seconds without touching CDK state.
- **Interactive demo launcher** -- `./demos/launcher.sh` provides a TUI menu for all scenario scripts, including a real-time traffic slider.
- **Graviton ARM64 throughout** -- All EC2 and ECS workloads run on m7g/c7g Graviton instances for price/performance.
- **Live monitoring** -- `watch-bluegreen-traffic.sh` and `watch-rolling.sh` provide terminal-based live dashboards.
- **Context-flag gating** -- Optional stacks (Green, Rolling) are deployed only when their CDK context flag is set, keeping the base deployment minimal.

## Prerequisites

- Node.js 20+ (`node --version`)
- AWS CLI v2 configured for ap-northeast-2 (`aws configure`)
- Docker buildx for ARM64 image builds (`docker buildx ls`)
- AWS CDK CLI (`npm install -g aws-cdk` or use `npx cdk`)

## Installation

```bash
# Clone the repository
git clone https://github.com/whchoi98/ecs-blue-green.git
cd ecs-blue-green

# Install dependencies
npm install

# Bootstrap CDK (once per account/region)
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/ap-northeast-2
```

## Usage

```bash
# Launch the interactive demo menu
./demos/launcher.sh

# Or run scenarios directly:

# Deploy Blue infrastructure
./demos/scenario1-deploy-blue.sh

# Shift 30% traffic to Green
./demos/scenario3-shift-traffic.sh 30

# Full rollback to Blue
./demos/scenario4-rollback-to-blue.sh

# Live traffic monitor (run in a separate terminal)
./demos/watch-bluegreen-traffic.sh
```

## Configuration

Context flags control optional stack deployment:

| Key | Default | Description |
|-----|---------|-------------|
| `includeSecondaryCidr` | `false` | Add 10.2.0.0/16 VPC association + private2 /22 subnets |
| `includeGreen` | `false` | Deploy Green compute stack (weight 0 initially) |
| `includeRolling` | `false` | Deploy Rolling ASG + dedicated CloudFront |

Pass context flags on deployment:
```bash
npx cdk deploy --all --context includeGreen=true
```

## Project Structure

```
bin/            # CDK app entry (stack wiring + context guards)
lib/            # CDK stack definitions
app/            # Express.js application (ARM64 Docker)
demos/          # Scenario scripts + launcher + monitors
scripts/        # Developer scripts (build/push, setup, install-hooks)
test/           # CDK jest stack synthesis tests
tests/          # Harness validation tests (hooks, structure)
docs/           # Architecture, ADRs, runbooks, onboarding, API reference
```

## VPC Topology

| Zone | CIDR | Purpose |
|------|------|---------|
| Primary CIDR | `10.1.0.0/16` | All resources reside here |
| private1 (auto /24 x 2) | `10.1.2.0/24`, `10.1.3.0/24` | Blue compute |
| private2 (manual /22 x 2) | `10.1.8.0/22`, `10.1.12.0/22` | Green compute (migration target) |
| private3 (auto /24 x 2) | `10.1.4.0/24`, `10.1.5.0/24` | Reserved |
| public, db | ... | ALB + NAT, Aurora/Redis |
| Secondary CIDR | `10.2.0.0/16` | Demo-only association (no resources) |

## Stacks

| Stack | Responsibility |
|-------|---------------|
| BgTestNetworkStack | VPC, subnets, NAT, VPC endpoints |
| BgTestDataStack | Aurora MySQL 8.0/3.08, ElastiCache Redis 7.1 |
| BgTestEcrStack | ECR repo `bg-app` |
| BgTestClusterStack | ECS cluster `test-cluster` (shared by Blue/Green) |
| BgTestAlbStack | ALB x 3 + Blue/Green TG + weighted listener rule |
| BgTestBlueStack | EC2 ASG + ECS services, private1 |
| BgTestGreenStack | EC2 ASG + ECS services, private2 (`includeGreen=true`) |
| BgTestCfStack | CloudFront 1 distribution + 3 origins + 4 behaviors |
| BgTestRollingStack | EC2 ASG + Warm Pool + ALB (`includeRolling=true`) |
| BgTestRollingCfStack | CloudFront distribution for Rolling scenario |

## Testing

```bash
# Run all CDK stack tests
npm test

# Run a specific stack test
npm test -- test/network-stack.test.ts

# Run Express app tests
cd app && node --test test/server.test.js

# Run harness validation tests
bash tests/run-all.sh
```

## Contributing

1. Fork the repository
2. Create your branch (`git checkout -b feat/amazing-feature`)
3. Commit changes (`git commit -m 'feat(stack): add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

Use Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`

## Cleanup

```bash
npx cdk destroy --all
```

## License

MIT

## Contact

- Maintainer: [whchoi98](https://github.com/whchoi98)
- Issues: https://github.com/whchoi98/ecs-blue-green/issues

---

<a id="korean"></a>

# 한국어

## 개요

이 프로젝트는 ap-northeast-2(서울) 리전에서 AWS CDK TypeScript를 사용하여 두 가지 AWS 컴퓨트 마이그레이션 패턴을 시연합니다.

1. **Blue/Green 트래픽 전환** -- 두 개의 병렬 컴퓨트 티어(Blue: private1, Green: private2)가 공유 ALB를 사용합니다. CDK 재배포 없이 AWS CLI로 ALB 가중치 리스너 룰을 수정하여 실시간으로 트래픽 비율을 변경합니다.
2. **EC2 ASG 롤링 업데이트** -- 별도 스택(BgTestRollingStack)이 독립 ALB, CloudFront, Warm Pool을 사용한 인스턴스 교체를 시연합니다.

## 주요 기능

- **무중단 Blue/Green 전환** -- ALB 가중치 룰 변경이 1-2초 내에 적용되며 CDK 상태를 변경하지 않습니다.
- **인터랙티브 데모 런처** -- `./demos/launcher.sh`가 실시간 트래픽 슬라이더를 포함한 모든 시나리오 스크립트 TUI 메뉴를 제공합니다.
- **Graviton ARM64 일관 사용** -- 모든 EC2/ECS 워크로드가 m7g/c7g Graviton 인스턴스에서 실행됩니다.
- **실시간 모니터링** -- `watch-bluegreen-traffic.sh`와 `watch-rolling.sh`가 터미널 기반 라이브 대시보드를 제공합니다.
- **컨텍스트 플래그 게이팅** -- 선택적 스택(Green, Rolling)은 CDK 컨텍스트 플래그가 설정된 경우에만 배포됩니다.

## 사전 요구 사항

- Node.js 20+ (`node --version`)
- ap-northeast-2용 AWS CLI v2 구성 (`aws configure`)
- ARM64 이미지 빌드를 위한 Docker buildx (`docker buildx ls`)
- AWS CDK CLI (`npm install -g aws-cdk` 또는 `npx cdk` 사용)

## 설치 방법

```bash
# 저장소 클론
git clone https://github.com/whchoi98/ecs-blue-green.git
cd ecs-blue-green

# 의존성 설치
npm install

# CDK 부트스트랩 (계정/리전당 한 번)
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/ap-northeast-2
```

## 사용법

```bash
# 인터랙티브 데모 메뉴 실행
./demos/launcher.sh

# 또는 시나리오 직접 실행:

# Blue 인프라 배포
./demos/scenario1-deploy-blue.sh

# Green에 30% 트래픽 전환
./demos/scenario3-shift-traffic.sh 30

# Blue로 전체 롤백
./demos/scenario4-rollback-to-blue.sh

# 라이브 트래픽 모니터 (별도 터미널에서 실행)
./demos/watch-bluegreen-traffic.sh
```

## 환경 설정

컨텍스트 플래그로 선택적 스택 배포를 제어합니다:

| 키 | 기본값 | 설명 |
|----|--------|------|
| `includeSecondaryCidr` | `false` | 10.2.0.0/16 VPC 연결 + private2 /22 서브넷 추가 |
| `includeGreen` | `false` | Green 컴퓨트 스택 배포 (초기 가중치 0) |
| `includeRolling` | `false` | 롤링 ASG + 전용 CloudFront 배포 |

배포 시 컨텍스트 플래그 전달:
```bash
npx cdk deploy --all --context includeGreen=true
```

## 프로젝트 구조

```
bin/            # CDK 앱 진입점 (스택 연결 + 컨텍스트 가드)
lib/            # CDK 스택 정의
app/            # Express.js 애플리케이션 (ARM64 Docker)
demos/          # 시나리오 스크립트 + 런처 + 모니터
scripts/        # 개발자 스크립트 (빌드/푸시, 설치)
test/           # CDK jest 스택 합성 테스트
tests/          # 하네스 검증 테스트
docs/           # 아키텍처, ADR, 런북, 온보딩, API 레퍼런스
```

## VPC 토폴로지

| 영역 | CIDR | 용도 |
|------|------|------|
| Primary CIDR | `10.1.0.0/16` | 모든 자원 거주 |
| private1 (auto /24 x 2) | `10.1.2.0/24`, `10.1.3.0/24` | Blue 컴퓨트 |
| private2 (manual /22 x 2) | `10.1.8.0/22`, `10.1.12.0/22` | Green 컴퓨트 (마이그레이션 자리) |
| private3 (auto /24 x 2) | `10.1.4.0/24`, `10.1.5.0/24` | 예약 |
| public, db | ... | ALB+NAT, Aurora |
| Secondary CIDR | `10.2.0.0/16` | 시연용 association만 (자원 없음) |

## 스택

| 스택 | 책임 |
|------|------|
| BgTestNetworkStack | VPC, 서브넷, NAT, VPC endpoints |
| BgTestDataStack | Aurora MySQL 8.0/3.08, ElastiCache Redis 7.1 |
| BgTestEcrStack | ECR repo `bg-app` |
| BgTestClusterStack | ECS cluster `test-cluster` (Blue/Green 공유) |
| BgTestAlbStack | ALB x 3 + Blue/Green TG + 가중치 리스너 룰 |
| BgTestBlueStack | EC2 ASG + ECS services, private1 거주 |
| BgTestGreenStack | EC2 ASG + ECS services, private2 거주 (`includeGreen=true` 시) |
| BgTestCfStack | CloudFront 1 배포 + 3 오리진 + 4 동작 |
| BgTestRollingStack | EC2 ASG + Warm Pool + ALB (`includeRolling=true` 시) |
| BgTestRollingCfStack | 롤링 시나리오용 CloudFront 배포 |

## 시나리오 (`demos/launcher.sh`)

**Phase 1 — Deploy**
1. `scenario1-deploy-blue.sh` -- Blue 인프라 배포
2. `scenario2-add-secondary-cidr.sh` -- Secondary CIDR 시연 + private2 /22 carve-out

**Phase 2 -- 트래픽 제어 (ALB weighted)**
3. `scenario3-shift-traffic.sh <green_pct>` -- 정확한 % 즉시 적용
4. `scenario-progressive-shift.sh [interval_s]` -- 0->10->25->50->75->90->100 자동 점진
5. `scenario-slider.sh` -- TUI 인터랙티브 슬라이더
6. `scenario4-rollback-to-blue.sh` -- 풀 Blue 복귀

**Rolling**
7. `scenario-rolling-1-deploy.sh` -- 롤링 스택 배포
8. `scenario-rolling-2-refresh.sh` -- ASG 인스턴스 교체 트리거
9. `scenario-rolling-3-rollback.sh` -- 롤링 롤백

**Observability**
10. `watch-bluegreen-traffic.sh` -- 라이브 Blue/Green 트래픽 모니터
11. `watch-rolling.sh` -- 라이브 롤링 ASG 모니터

## CDK Context

| 키 | 기본값 | 의미 |
|----|--------|------|
| `includeSecondaryCidr` | `false` | 10.2.0.0/16 association 추가 + private2 /22 서브넷 carve |
| `includeGreen` | `false` | GreenStack + 가중치 0인 Green TG 배포 |
| `includeRolling` | `false` | RollingStack + RollingCfStack 배포 |
| `cloudFrontPrefixListId` | `pl-22a6434b` | CloudFront origin-facing 관리형 접두사 목록 (ap-northeast-2 기본값) |

## 테스트

```bash
# 모든 stack 단위 테스트
npm test

# 특정 stack 테스트
npm test -- test/network-stack.test.ts

# Express app 테스트
cd app && node --test test/server.test.js

# 하네스 검증 테스트
bash tests/run-all.sh
```

## 기여 방법

1. 저장소 포크
2. 브랜치 생성 (`git checkout -b feat/awesome-feature`)
3. 변경 사항 커밋 (`git commit -m 'feat(stack): 기능 추가'`)
4. 브랜치에 푸시 (`git push origin feat/awesome-feature`)
5. Pull Request 열기

커밋 컨벤션: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`

## 정리

```bash
npx cdk destroy --all
```

## 라이선스

MIT

## 연락처

- 관리자: [whchoi98](https://github.com/whchoi98)
- 이슈: https://github.com/whchoi98/ecs-blue-green/issues

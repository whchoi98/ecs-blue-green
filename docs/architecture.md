# Architecture

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

## System Overview

ecs-blue-green is an AWS CDK demonstration project implementing ALB weighted Blue/Green traffic shifting and EC2 ASG rolling instance replacement on ap-northeast-2 (Seoul). The system deploys two parallel compute tiers (Blue and Green) behind a shared Application Load Balancer; traffic distribution is controlled entirely by ALB weighted listener rules without CDK redeployment. A separate rolling-update scenario (BgTestRollingStack) demonstrates graceful EC2 ASG instance refresh using an independent ALB and CloudFront distribution.

Primary data flow: Internet -> CloudFront -> ALB (weighted rule) -> Blue or Green ECS/EC2 -> Aurora MySQL / ElastiCache Redis.

## Components

### Ingestion Layer
- **BgTestCfStack** -- CloudFront distribution with 3 origins (ALB Blue, ALB Green, ALB Rolling) and 4 path-based behaviors. Adds X-Custom-Secret header for ALB origin authentication.
- **BgTestRollingCfStack** -- Dedicated CloudFront distribution for the Rolling scenario ALB.

### Networking Layer
- **BgTestNetworkStack** -- VPC (10.1.0.0/16 primary, optional 10.2.0.0/16 secondary), subnets (public, private1, private2, db), NAT Gateway, VPC Endpoints (S3, ECR, ECS). private2 subnets (/22 x 2) are carved from the primary CIDR for Green compute migration demonstration.

### Load Balancing Layer
- **BgTestAlbStack** -- Three ALBs: Blue ALB (private1), Green ALB (private2), shared ALB with weighted listener rule. Blue/Green target groups and weighted forward rule are the single source of truth for traffic color.

### Storage Layer
- **BgTestDataStack** -- Aurora MySQL 8.0 cluster (Writer + Reader, db.t4g.large, ap-northeast-2a/2b), ElastiCache Redis 7.1 replication group (cache.m7g.large, 2 nodes). Both placed in dedicated db subnets with SG-to-SG ingress only.
- **BgTestEcrStack** -- ECR repository `bg-app` with lifecycle policy (keep last 10 images).

### Processing Layer
- **BgTestClusterStack** -- Shared ECS cluster `test-cluster` with Container Insights v2.
- **BgTestBlueStack** -- EC2 ASG (m7g.large, private1 subnets) + ECS EC2 service + ECS Fargate service. Hosts Blue compute tier.
- **BgTestGreenStack** -- EC2 ASG (m7g.large, private2 subnets) + ECS EC2 service + ECS Fargate service. Hosts Green compute tier. Deployed when `includeGreen=true`.
- **BgTestRollingStack** -- EC2 ASG (m7g.large) with Warm Pool (MaxPrepared=4, Stopped) for Rolling demo. Deployed when `includeRolling=true`.

### Presentation Layer
- **app/server.js** -- Express.js application (ARM64 Docker, port 3000). Endpoints: `/`, `/health`, `/info`, `/redis/hit`, `/db/ping`. Responds with JSON including `COLOR` env var to identify Blue or Green.

### Security Layer
- Security groups with SG-to-SG ingress (no CIDR-based rules where avoidable)
- CloudFront prefix list restricts ALB direct access (managed prefix list pl-22a6434b)
- X-Custom-Secret header validates CloudFront-to-ALB origin requests
- ECR image scanning enabled; no public registry access

## Full Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│                    Internet / Client                      │
└───────────────────────────┬──────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────┐
│                  Ingestion Layer                          │
│                                                          │
│  ┌───────────────────┐   ┌───────────────────────────┐   │
│  │ BgTestCfStack     │   │ BgTestRollingCfStack       │   │
│  │ CloudFront        │   │ CloudFront (Rolling only)  │   │
│  │ 3 origins         │   │ 1 origin                   │   │
│  │ 4 behaviors       │   │                            │   │
│  └────────┬──────────┘   └──────────┬─────────────────┘   │
└───────────┼──────────────────────────┼────────────────────┘
            ▼                          ▼
┌──────────────────────────────────────────────────────────┐
│                  Load Balancing Layer                     │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ BgTestAlbStack                                    │   │
│  │ Shared ALB ──[weighted rule]──▶ Blue TG / Green TG│   │
│  │ Blue ALB (private1)                               │   │
│  │ Green ALB (private2)                              │   │
│  │ Rolling ALB (private1 or private2)                │   │
│  └──────────┬────────────────────────────────────────┘   │
└─────────────┼──────────────────────────────────────────── ┘
       ┌──────┴──────┐
       ▼             ▼
┌──────────────┐  ┌──────────────┐
│ Blue Compute │  │ Green Compute│
│ BgTestBlue   │  │ BgTestGreen  │
│ EC2 ASG      │  │ EC2 ASG      │
│ (private1)   │  │ (private2)   │
│ ECS EC2 svc  │  │ ECS EC2 svc  │
│ ECS FG svc   │  │ ECS FG svc   │
└──────┬───────┘  └──────┬───────┘
       └──────┬───────────┘
              ▼
┌──────────────────────────────────────────────────────────┐
│                  Storage Layer                           │
│                                                          │
│  ┌──────────────────┐    ┌──────────────────────────┐   │
│  │ BgTestDataStack  │    │ BgTestEcrStack            │   │
│  │ Aurora MySQL 8.0 │    │ ECR: bg-app               │   │
│  │ (Writer+Reader)  │    │ ARM64 Docker images       │   │
│  │ Redis 7.1 (2 nd) │    │                           │   │
│  └──────────────────┘    └──────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

## Data Flow Summary

```
Client -> CloudFront -> Shared ALB [weighted: Blue%/Green%] -> ECS/EC2
                                                                   |
                                            ┌──────────────────────┘
                                            ▼
                                    Aurora MySQL / Redis
```

## Infrastructure

### Deployment Region
- ap-northeast-2 (Seoul)

### CDK Stacks

| Stack | Resources | Description |
|-------|-----------|-------------|
| BgTestNetworkStack | VPC, 8 subnets, 2 NAT GWs, VPC Endpoints | Networking foundation; private2 from primary CIDR for Green |
| BgTestDataStack | Aurora MySQL cluster (2 nodes), Redis cluster (2 nodes) | Shared data tier; both stacks connect via SG-to-SG |
| BgTestEcrStack | ECR repository bg-app | ARM64 container image registry |
| BgTestClusterStack | ECS cluster test-cluster | Shared cluster; Blue and Green services both registered here |
| BgTestAlbStack | 3 ALBs, 2 TGs, 1 weighted listener rule | Traffic routing; weights are the sole Blue/Green control plane |
| BgTestBlueStack | EC2 ASG + ECS EC2 + ECS Fargate | Blue compute tier in private1 subnets |
| BgTestGreenStack | EC2 ASG + ECS EC2 + ECS Fargate | Green compute tier in private2 subnets |
| BgTestCfStack | CloudFront distribution | Public HTTPS entry point with path routing |
| BgTestRollingStack | EC2 ASG + Warm Pool + ALB | Rolling instance refresh demo |
| BgTestRollingCfStack | CloudFront distribution | Rolling scenario public entry point |

### Context Flags

| Key | Default | Effect |
|-----|---------|--------|
| `includeSecondaryCidr` | `false` | Add 10.2.0.0/16 association + private2 /22 subnets |
| `includeGreen` | `false` | Deploy BgTestGreenStack with 0-weight Green TG |
| `includeRolling` | `false` | Deploy BgTestRollingStack + BgTestRollingCfStack |

## Key Design Decisions

- ALB weighted listener rule as single source of truth for traffic color -- avoids CDK state (activeColor fields) that would force redeployment to change traffic; rule weight changes take effect in 1-2 seconds via AWS CLI.
- private2 subnets carved from primary CIDR (10.1.8.0/22, 10.1.12.0/22) -- secondary CIDR association is demonstration-only; actual resources deploy in primary CIDR to avoid VPC endpoint routing complexity.
- Shared ECS cluster for Blue and Green -- reduces overhead; ECS placement constraints use subnet selection (not task attributes) to isolate Blue/Green workloads.
- Graviton ARM64 (m7g family) throughout -- better price/performance for ap-northeast-2; Docker images must be built with `--platform linux/arm64`.
- X-Custom-Secret header validates CloudFront-to-ALB -- prevents direct ALB access bypassing CloudFront WAF/HTTPS enforcement.

## Operations
- Deployment: see `docs/runbooks/` (create with `/add-runbook deploy-production`)
- Traffic shift: `./demos/scenario3-shift-traffic.sh <green_pct>`
- Full rollback: `./demos/scenario4-rollback-to-blue.sh`

---

<a id="korean"></a>

# 한국어

## 시스템 개요

ecs-blue-green은 ap-northeast-2(서울) 리전에서 ALB 가중치 기반 Blue/Green 트래픽 전환 및 EC2 ASG 롤링 인스턴스 교체를 구현하는 AWS CDK 시연 프로젝트입니다. 두 개의 병렬 컴퓨트 티어(Blue, Green)가 공유 Application Load Balancer 뒤에 배치되며, CDK 재배포 없이 ALB 가중치 리스너 룰만으로 트래픽 분배를 제어합니다. 별도의 롤링 업데이트 시나리오(BgTestRollingStack)는 독립 ALB와 CloudFront 배포를 사용한 EC2 ASG 인스턴스 교체를 시연합니다.

기본 데이터 흐름: 인터넷 -> CloudFront -> ALB (가중치 룰) -> Blue 또는 Green ECS/EC2 -> Aurora MySQL / ElastiCache Redis

## 컴포넌트

### 수신(Ingestion) 레이어
- **BgTestCfStack** -- CloudFront 배포 (3개 오리진, 4개 경로 기반 동작). ALB 오리진 인증을 위한 X-Custom-Secret 헤더 추가.
- **BgTestRollingCfStack** -- 롤링 시나리오 전용 CloudFront 배포.

### 네트워킹 레이어
- **BgTestNetworkStack** -- VPC(primary 10.1.0.0/16, optional secondary 10.2.0.0/16), 서브넷(public, private1, private2, db), NAT Gateway, VPC Endpoint. private2 서브넷(/22 x 2)은 Green 컴퓨트 마이그레이션 시연을 위해 primary CIDR에서 분할.

### 로드 밸런싱 레이어
- **BgTestAlbStack** -- ALB 3개: Blue ALB(private1), Green ALB(private2), 가중치 리스너 룰이 있는 공유 ALB. Blue/Green 타겟 그룹과 가중치 포워드 룰이 트래픽 색상의 단일 진실 원천.

### 스토리지 레이어
- **BgTestDataStack** -- Aurora MySQL 8.0 클러스터(Writer + Reader, db.t4g.large), ElastiCache Redis 7.1 복제 그룹(cache.m7g.large, 2 노드). 전용 db 서브넷에 SG-to-SG 인그레스만 허용.
- **BgTestEcrStack** -- ECR 저장소 `bg-app` (수명 주기 정책: 최근 이미지 10개 유지).

### 처리(Processing) 레이어
- **BgTestClusterStack** -- 공유 ECS 클러스터 `test-cluster` (Container Insights v2).
- **BgTestBlueStack** -- EC2 ASG(m7g.large, private1) + ECS EC2 서비스 + ECS Fargate 서비스. Blue 컴퓨트 티어.
- **BgTestGreenStack** -- EC2 ASG(m7g.large, private2) + ECS EC2 서비스 + ECS Fargate 서비스. Green 컴퓨트 티어 (`includeGreen=true` 시 배포).
- **BgTestRollingStack** -- Warm Pool(MaxPrepared=4, Stopped) 탑재 EC2 ASG. 롤링 시연용 (`includeRolling=true` 시 배포).

### 프레젠테이션 레이어
- **app/server.js** -- Express.js 애플리케이션 (ARM64 Docker, 포트 3000). 엔드포인트: `/`, `/health`, `/info`, `/redis/hit`, `/db/ping`. `COLOR` 환경변수를 포함한 JSON 응답으로 Blue/Green 식별.

### 보안 레이어
- SG-to-SG 인그레스 (가능한 경우 CIDR 기반 룰 미사용)
- CloudFront 관리형 접두사 목록(pl-22a6434b)으로 ALB 직접 접근 제한
- X-Custom-Secret 헤더로 CloudFront-to-ALB 오리진 요청 검증
- ECR 이미지 스캐닝 활성화

## 전체 아키텍처 다이어그램

영문 섹션의 ASCII 다이어그램과 동일한 구조입니다.

## 인프라

### 배포 리전
- ap-northeast-2 (서울)

### CDK 스택

| 스택 | 리소스 | 설명 |
|------|--------|------|
| BgTestNetworkStack | VPC, 서브넷 8개, NAT GW 2개, VPC Endpoint | 네트워킹 기반; Green용 private2는 primary CIDR에서 분할 |
| BgTestDataStack | Aurora MySQL 클러스터(2노드), Redis 클러스터(2노드) | 공유 데이터 티어 |
| BgTestEcrStack | ECR 저장소 bg-app | ARM64 컨테이너 이미지 레지스트리 |
| BgTestClusterStack | ECS 클러스터 test-cluster | Blue/Green 서비스가 공유하는 단일 클러스터 |
| BgTestAlbStack | ALB 3개, TG 2개, 가중치 리스너 룰 1개 | 트래픽 라우팅; 가중치가 유일한 Blue/Green 제어 플레인 |
| BgTestBlueStack | EC2 ASG + ECS EC2 + ECS Fargate | private1 서브넷의 Blue 컴퓨트 티어 |
| BgTestGreenStack | EC2 ASG + ECS EC2 + ECS Fargate | private2 서브넷의 Green 컴퓨트 티어 |
| BgTestCfStack | CloudFront 배포 | 경로 라우팅이 있는 공개 HTTPS 진입점 |
| BgTestRollingStack | EC2 ASG + Warm Pool + ALB | 롤링 인스턴스 교체 시연 |
| BgTestRollingCfStack | CloudFront 배포 | 롤링 시나리오 공개 진입점 |

## 핵심 설계 결정

- ALB 가중치 리스너 룰을 트래픽 색상의 단일 진실 원천으로 사용 -- CDK 상태(activeColor 필드) 없이 1-2초 내 AWS CLI로 트래픽 전환 가능.
- private2 서브넷을 primary CIDR에서 분할 -- secondary CIDR 연동은 시연용; 실제 리소스는 VPC 엔드포인트 라우팅 복잡성 방지를 위해 primary CIDR에 배포.
- Blue와 Green이 ECS 클러스터 공유 -- 오버헤드 감소; 서브넷 선택으로 Blue/Green 워크로드 격리.
- Graviton ARM64(m7g 계열) 일관 사용 -- ap-northeast-2에서 최적 가격/성능; Docker 이미지는 `--platform linux/arm64` 빌드 필수.
- X-Custom-Secret 헤더로 CloudFront-to-ALB 검증 -- CloudFront 우회 직접 ALB 접근 방지.

## 운영
- 배포: `docs/runbooks/` 참고 (`/add-runbook deploy-production`으로 생성)
- 트래픽 전환: `./demos/scenario3-shift-traffic.sh <green_pct>`
- 전체 롤백: `./demos/scenario4-rollback-to-blue.sh`

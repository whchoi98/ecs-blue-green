# Changelog

<a href="#english"><img src="https://img.shields.io/badge/lang-English-blue.svg" alt="English"></a>
<a href="#korean"><img src="https://img.shields.io/badge/lang-한국어-red.svg" alt="Korean"></a>

---

<a id="english"></a>

# English

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-05-13

### Added
- Add Rolling ASG demo scenario (`BgTestRollingStack` + `BgTestRollingCfStack`) with Warm Pool (MaxPrepared=4, Stopped)
- Add Rolling demo scripts: `scenario-rolling-1-deploy.sh`, `scenario-rolling-2-refresh.sh`, `scenario-rolling-3-rollback.sh`
- Add `watch-rolling.sh` 6-section live monitor for Rolling ASG instance refresh
- Add Rolling menu section to `launcher.sh` (additive; Phase 1/2 sections preserved)
- Add Rolling helpers to `shared.sh` without modifying existing Blue/Green helpers
- Add `validateRollingContext` pure function in `lib/rolling-context.ts`
- Add `VERSION` env variable exposed in `/info` response for image tag tracking
- Add `ensure_npm_deps` helper in `shared.sh` — auto-installs `node_modules` before CDK invocations
- Add Korean section captions to `watch-bluegreen-traffic.sh` for bilingual presentation
- Add DATA TIER HEALTH section to `watch-bluegreen-traffic.sh` (spec compliance)
- Wire `BgTestRollingStack` in `bin/app.ts` behind `includeRolling` context flag

### Changed
- Refactor `shared.sh`: rename `COLOR` variable to `TAG` for clarity
- Align jest tests with private2 /22 CIDR configuration

### Fixed
- Fix `watch-bluegreen-traffic.sh` to poll `/redis/hit` for incrementing counter (spec §4.7)
- Fix `watch-bluegreen-traffic.sh` missing DATA TIER section

## [0.1.0] - 2026-05-08

### Added
- Add Blue/Green ALB weighted traffic shifting demo (Phase 1 + Phase 2)
- Add `BgTestAlbStack` with 3 ALBs, Blue/Green target groups, and weighted listener rule
- Add `BgTestBlueStack` (EC2 ASG + ECS EC2 + ECS Fargate, private1 subnets, m7g.large)
- Add `BgTestGreenStack` (same as Blue in private2 subnets, deployed with `includeGreen=true`)
- Add `BgTestNetworkStack`: VPC 10.1.0.0/16 primary, optional 10.2.0.0/16 secondary; private2 /22 subnets in primary CIDR
- Add `BgTestDataStack`: Aurora MySQL 8.0 (db.t4g.large), ElastiCache Redis 7.1 (cache.m7g.large)
- Add `BgTestEcrStack`: ECR repository `bg-app` with lifecycle policy
- Add `BgTestClusterStack`: shared ECS cluster with Container Insights v2
- Add `BgTestCfStack`: CloudFront distribution with 3 origins and 4 path behaviors
- Add Express.js application with endpoints: `/`, `/health`, `/info`, `/redis/hit`, `/db/ping`
- Add ARM64 Dockerfile and `scripts/build-and-push.sh` for ECR image builds
- Add `demos/launcher.sh` interactive TUI menu
- Add Phase 2 traffic scripts: `scenario3-shift-traffic.sh`, `scenario4-rollback-to-blue.sh`, `scenario-progressive-shift.sh`, `scenario-slider.sh`
- Add `watch-bluegreen-traffic.sh` live Blue/Green traffic monitor

### Changed
- Move private2 subnets to primary CIDR (10.1.8.0/22, 10.1.12.0/22) — secondary CIDR is demo-only
- Remove `activeColor` from ALB stack; ALB weights are the sole source of truth

### Fixed
- Replace non-ASCII arrow character in security group descriptions (AWS rejects non-ASCII)
- Fix Aurora and Redis instance type selection for ap-northeast-2 Graviton availability
- Consolidate ECS capacity provider associations in compute stack

[Unreleased]: https://github.com/whchoi98/ecs-blue-green/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/whchoi98/ecs-blue-green/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/whchoi98/ecs-blue-green/releases/tag/v0.1.0

---

<a id="korean"></a>

# 한국어

이 프로젝트의 모든 주요 변경 사항은 이 파일에 기록됩니다.
이 문서는 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 기반으로 하며,
[Semantic Versioning](https://semver.org/spec/v2.0.0.html)을 따릅니다.

## [Unreleased]

## [0.2.0] - 2026-05-13

### Added
- Warm Pool(MaxPrepared=4, Stopped) 탑재 롤링 ASG 데모 시나리오 추가 (`BgTestRollingStack` + `BgTestRollingCfStack`)
- 롤링 데모 스크립트 추가: `scenario-rolling-1-deploy.sh`, `scenario-rolling-2-refresh.sh`, `scenario-rolling-3-rollback.sh`
- 롤링 ASG 인스턴스 교체용 `watch-rolling.sh` 6섹션 라이브 모니터 추가
- `launcher.sh`에 Rolling 메뉴 섹션 추가 (기존 Phase 1/2 섹션 유지)
- `shared.sh`에 기존 Blue/Green 헬퍼 변경 없이 Rolling 헬퍼 추가
- `lib/rolling-context.ts`에 `validateRollingContext` 순수 함수 추가
- `/info` 응답에 이미지 태그 추적을 위한 `VERSION` 환경변수 노출
- CDK 호출 전 `node_modules` 자동 설치하는 `ensure_npm_deps` 헬퍼 추가
- 이중 언어 프레젠테이션을 위해 `watch-bluegreen-traffic.sh`에 한국어 섹션 캡션 추가
- 스펙 §4.7 준수를 위해 `watch-bluegreen-traffic.sh`에 DATA TIER HEALTH 섹션 추가
- `includeRolling` 컨텍스트 플래그 뒤에 `BgTestRollingStack` 연결

### Changed
- `shared.sh`의 `COLOR` 변수를 명확성을 위해 `TAG`로 이름 변경
- private2 /22 CIDR 설정에 맞게 jest 테스트 정렬

### Fixed
- 스펙 §4.7에 따라 `/redis/hit`를 폴링하도록 `watch-bluegreen-traffic.sh` 수정
- `watch-bluegreen-traffic.sh`의 누락된 DATA TIER 섹션 수정

## [0.1.0] - 2026-05-08

### Added
- Blue/Green ALB 가중치 트래픽 전환 데모 추가 (Phase 1 + Phase 2)
- ALB 3개, Blue/Green 타겟 그룹, 가중치 리스너 룰이 있는 `BgTestAlbStack` 추가
- `BgTestBlueStack` 추가 (EC2 ASG + ECS EC2 + ECS Fargate, private1 서브넷, m7g.large)
- `BgTestGreenStack` 추가 (Blue와 동일, private2 서브넷, `includeGreen=true` 시 배포)
- `BgTestNetworkStack` 추가: primary VPC 10.1.0.0/16, optional secondary 10.2.0.0/16; primary CIDR의 private2 /22 서브넷
- `BgTestDataStack` 추가: Aurora MySQL 8.0 (db.t4g.large), ElastiCache Redis 7.1 (cache.m7g.large)
- `BgTestEcrStack` 추가: 수명 주기 정책이 있는 ECR 저장소 `bg-app`
- `BgTestClusterStack` 추가: Container Insights v2가 있는 공유 ECS 클러스터
- `BgTestCfStack` 추가: 3개 오리진과 4개 경로 동작이 있는 CloudFront 배포
- Express.js 애플리케이션 추가: 엔드포인트 `/`, `/health`, `/info`, `/redis/hit`, `/db/ping`
- ARM64 Dockerfile 및 ECR 이미지 빌드용 `scripts/build-and-push.sh` 추가
- `demos/launcher.sh` 인터랙티브 TUI 메뉴 추가
- Phase 2 트래픽 스크립트 추가: `scenario3-shift-traffic.sh`, `scenario4-rollback-to-blue.sh`, `scenario-progressive-shift.sh`, `scenario-slider.sh`
- 라이브 Blue/Green 트래픽 모니터 `watch-bluegreen-traffic.sh` 추가

### Changed
- private2 서브넷을 primary CIDR(10.1.8.0/22, 10.1.12.0/22)로 이동 -- secondary CIDR은 시연용만
- ALB 스택에서 `activeColor` 제거; ALB 가중치가 유일한 진실 원천

### Fixed
- 보안 그룹 설명의 비 ASCII 화살표 문자 교체 (AWS는 비 ASCII 문자 거부)
- ap-northeast-2 Graviton 가용성에 맞게 Aurora 및 Redis 인스턴스 유형 수정
- 컴퓨트 스택에서 ECS 용량 공급자 연결 통합

[Unreleased]: https://github.com/whchoi98/ecs-blue-green/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/whchoi98/ecs-blue-green/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/whchoi98/ecs-blue-green/releases/tag/v0.1.0

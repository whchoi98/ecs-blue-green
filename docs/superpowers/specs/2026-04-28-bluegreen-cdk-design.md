# Blue/Green Test 인프라 CDK 설계

| 항목 | 값 |
|---|---|
| 작성일 | 2026-04-28 |
| 대상 | AWS Lab 환경에서 Blue/Green 배포 시연용 인프라 |
| 계정 / 리전 | 120443221648 / ap-northeast-2 |
| IaC | AWS CDK v2 (TypeScript) |
| 참조 패턴 | `whchoi98/ec2_vscode/infra-cdk` (CF→ALB 보안), `whchoi98/aws_lab_infra/cdk` (멀티 스택 + 명명 규약), `whchoi98/spot-gpu-lotto/demos` (프리젠테이션 모드 데모) |

## 1. 개요

청중 시연용 Blue/Green 배포 환경을 CDK로 정의한다. 단순 색상 전환을 넘어 **VPC 진화 시나리오** — 초기 /24 서브넷에 배포 → IP 부족 시뮬레이션 → secondary CIDR 추가 → 새 /22 서브넷으로 컴퓨트 마이그레이션 → 원복 — 까지 4단계 데모 스크립트로 시연한다.

### 1.1 목표

1. ap-northeast-2 단일 VPC에서 EC2 ASG, ECS on EC2, ECS Fargate 세 컴퓨트 워크로드를 동시 운영
2. CloudFront → 워크로드별 ALB 3개 → 컴퓨트의 보안 흐름 (Defense in Depth, 3중 방어)
3. Aurora MySQL (Writer+Reader) + ElastiCache Redis (primary+replica) 데이터 레이어
4. CDK context 변경만으로 Blue/Green 전환 + 롤백 가능
5. 4개 데모 시나리오 (배포→CIDR 확장→마이그레이션→롤백) 시각적 시연

### 1.2 비목표 (YAGNI)

- 커스텀 도메인 / Route 53 / ACM 인증서 (default `cloudfront.net` 사용)
- WAF / Shield / CloudFront Functions / Lambda@Edge
- CodeDeploy / CodePipeline 자동 배포 (CDK + 수동 데모 스크립트로 충분)
- 다중 리전 / DR
- production-grade 모니터링 (CloudWatch alarms, SNS 알림)

## 2. 아키텍처

### 2.1 High-level 흐름

```
Internet (HTTPS)
   ↓
CloudFront (1 distribution, default cloudfront.net cert)
  behavior /ec2-asg/*  → origin ALB-EC2-ASG-{active}
  behavior /ecs-ec2/*  → origin ALB-ECS-EC2-{active}
  behavior /ecs-fg/*   → origin ALB-ECS-FG-{active}
  behavior default     → origin ALB-EC2-ASG-{active}
  custom origin header X-Custom-Secret: <workload-secret>
   ↓ HTTP:80
ALB×3 (public subnets)
  SG ingress: prefix list com.amazonaws.global.cloudfront.origin-facing only
  Listener default: 403
  Rule (priority 1): X-Custom-Secret 매치 시에만 forward → TG
   ↓
EC2 ASG / ECS-EC2 service / ECS-Fargate service (private-1 또는 private-2)
   ↓
Aurora MySQL (db subnet) + ElastiCache Redis (private-1)
```

### 2.2 Stack 구성

| Stack | 책임 | 변경 빈도 | 의존성 |
|---|---|---|---|
| `BgTestNetworkStack` | VPC, subnets (primary + secondary CIDR), NAT GW, IGW, 라우팅, VPC endpoints (ECR, S3, CW Logs, Secrets Manager) | 시나리오 1에서 1회 배포, 시나리오 2에서 update (CIDR 추가) | 없음 |
| `BgTestDataStack` | Aurora MySQL cluster (Writer+Reader), ElastiCache Redis replication group, Secrets Manager 비밀번호 | 1회 | Network |
| `BgTestEcrStack` | ECR repo `bg-app` (lifecycle: keep last 10 images) | 1회 | 없음 |
| `BgTestClusterStack` | ECS cluster `test-cluster` (Container Insights enabled) — Blue/Green 공유 | 1회 | Network |
| `BgTestComputeStack` (재사용) | ALB×3, EC2 ASG, ECS service×2 (cluster reference, EC2 capacity provider for ec2 launch type), SG, listener rules, target groups | Blue/Green 각각 인스턴스화 | Network, Data, Ecr, Cluster |
| `BgTestCfStack` | CloudFront distribution, origin/behavior, active color 기반 origin domain | 시나리오 1에서 1회, 시나리오 3 / 4에서 update | Compute (Blue/Green) |

**Stack 인스턴스화** (bin/app.ts):

```ts
// BlueStack은 항상 배포 (또는 includeBlue context로 제어 가능)
new BgTestComputeStack(app, 'BgTestBlueStack', {
  color: 'blue',
  computeSubnets: 'private-1',  // 10.0.21.0/24 + 10.0.22.0/24
  ...
});

// GreenStack은 includeGreen=true일 때만 배포
if (app.node.tryGetContext('includeGreen')) {
  new BgTestComputeStack(app, 'BgTestGreenStack', {
    color: 'green',
    computeSubnets: 'private-2',  // 10.1.0.0/22 + 10.1.4.0/22
    ...
  });
}
```

## 3. Network Layer

### 3.1 VPC `test-vpc`

- Primary CIDR: `10.0.0.0/16`
- Secondary CIDR: `10.1.0.0/16` (시나리오 2에서 `includeSecondaryCidr=true`로 활성화)
- 2 AZ (ap-northeast-2a, ap-northeast-2c)

### 3.2 Subnet 레이아웃

| 서브넷 | AZ-a CIDR | AZ-c CIDR | 라우팅 | 용도 |
|---|---|---|---|---|
| public | 10.0.11.0/24 | 10.0.12.0/24 | IGW | ALB×3 (Blue + Green), NAT GW×2 |
| private-1 | 10.0.21.0/24 | 10.0.22.0/24 | NAT GW | Redis, BlueStack 컴퓨트 (EC2 ASG, ECS-EC2 host, ECS-FG task) |
| private-3 | 10.0.41.0/24 | 10.0.42.0/24 | NAT GW | 예비 |
| db | 10.0.51.0/24 | 10.0.52.0/24 | (isolated) | Aurora subnet group — 외부 egress 불필요 |
| **private-2** (시나리오 2 이후) | **10.1.0.0/22** | **10.1.4.0/22** | NAT GW (기존 재사용) | GreenStack 컴퓨트, IP 풍부 |

NAT GW는 public subnet에 AZ당 1개씩 배치 (총 2개, HA).

### 3.3 VPC Endpoints (interface)

비용 절감 + private subnet 안정성:

- ECR DKR + ECR API (ECS task가 ECR pull용)
- S3 (gateway endpoint)
- CloudWatch Logs (ECS / EC2 로그 송신)
- Secrets Manager (DB 비밀번호 fetch)
- SSM + SSMMessages + EC2Messages (EC2 ASG의 SSM Session Manager 접근)

모든 endpoint는 private-1 + (활성화 시) private-2 양쪽에 연결.

### 3.4 Security Groups

| SG | Ingress | Egress |
|---|---|---|
| `bg-alb-ec2asg-{color}-sg` | prefix list `pl-*` (CF origin-facing), tcp/80 | all |
| `bg-alb-ecsec2-{color}-sg` | (동일) | all |
| `bg-alb-ecsfg-{color}-sg` | (동일) | all |
| `bg-ec2asg-{color}-sg` | from ALB-EC2-ASG SG, tcp/80 | all |
| `bg-ecsec2-host-{color}-sg` | from ALB-ECS-EC2 SG, tcp/0-65535 (dynamic host port) | all |
| `bg-ecsfg-task-{color}-sg` | from ALB-ECS-FG SG, tcp/3000 | all |
| `bg-aurora-sg` | from EC2 + ECS SG, tcp/3306 | all |
| `bg-redis-sg` | from EC2 + ECS SG, tcp/6379 | all |

## 4. Data Layer (`BgTestDataStack`)

### 4.1 Aurora MySQL

- Engine: Aurora MySQL 3.08 (MySQL 8.0 호환, latest)
- Cluster: 1 Writer + 1 Reader (Multi-AZ)
- Instance: `db.t4g.xlarge` (Graviton2)
- Subnet group: db-a + db-b
- 비밀번호: Secrets Manager `bg-test/db` (16자 random, 자동 생성)
- DB 이름: `bgtest`
- 사용자: `admin`
- Backup retention: 1일 (lab 환경)
- Deletion protection: false (lab)

### 4.2 ElastiCache Redis

- Engine: Redis 7.1 (latest, cluster mode disabled)
- Replication group: primary + 1 replica (Multi-AZ)
- Node type: `cache.t4g.xlarge` (Graviton2)
- Subnet group: private-1-a + private-1-b
- AUTH: 비활성화 (lab, VPC 내부)
- Encryption in transit: 활성화 (TLS)
- Encryption at rest: 활성화

## 5. Compute Layer (`BgTestComputeStack` × 2)

### 5.1 공통

- 단일 Docker 이미지 사용: ECR repo `bg-app`, tag `<color>` (`blue` 또는 `green`)
- 모든 인스턴스/태스크 ARM64 (Graviton 통일)
- 환경변수로 색상/타입/엔드포인트 차별화

### 5.2 EC2 ASG

- Instance: `t4g.xlarge`, AL2023 ARM64 (SSM `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64`)
- ASG: desired=4, min=4, max=8, vpcSubnets=`computeSubnets` props
- Launch Template userdata:
  - dnf install docker → systemctl start
  - aws ecr get-login-password → docker login
  - DB 비밀번호 Secrets Manager에서 fetch
  - `docker run -d --restart=always -p 80:3000 -e COLOR=<color> -e COMPUTE_TYPE=ec2-asg -e REDIS_URL=... -e DB_HOST=... -e DB_USER=admin -e DB_PASSWORD=... <ECR_URI>:<color>`
- Instance refresh: rolling
- IAM: SSM + ECR pull + Secrets Manager read
- Health check: ELB type
- ALB TG target type: `instance`, port 80, health `/health`

### 5.3 ECS Cluster `test-cluster` (단일, dual capacity provider)

ECS cluster는 별도 `BgTestClusterStack`에 정의 (Blue/Green 공유, 사용자 요구 "단일 클러스터"를 강제 보장).

- Cluster name: `test-cluster`
- Container Insights: enabled
- Capacity Providers (cluster-level 등록):
  - `ec2-cp-blue` — Blue ASG (t4g.xlarge×2, min=2, max=6, private-1 subnets, ECS-optimized AL2023 ARM64)
  - `ec2-cp-green` — Green ASG (시나리오 3 이후, private-2 subnets) — `includeGreen=true` 시 추가
  - `FARGATE` (built-in)
- Capacity provider association: Blue/Green compute stack에서 자기 capacity provider만 cluster에 attach. Service는 자기 색상의 capacity provider를 명시적으로 strategy에 지정.

`BgTestComputeStack`은 자기 색상의 EC2 ASG (ECS host용) + 자기 색상의 ECS service만 정의하고, cluster는 cross-stack reference (`StringParameter` 또는 `Fn.importValue`).

### 5.4 ECS Service: `bg-ecs-ec2-{color}`

- Task definition `bg-ecsec2-{color}` (network mode `bridge`)
  - Container `app`: image `<ECR_URI>:<color>`, port 3000 (host port 0 = dynamic)
  - Env: COLOR, COMPUTE_TYPE=ecs-ec2, REDIS_URL, DB_HOST, DB_USER
  - Secrets: DB_PASSWORD from Secrets Manager
- Capacity provider strategy: `[{ec2-cp: weight=1}]`
- Desired count: 2
- ALB TG target type: `instance` (dynamic host port mapping)

### 5.5 ECS Service: `bg-ecs-fargate-{color}`

- Task definition `bg-ecsfg-{color}` (network mode `awsvpc`, runtime ARM64)
  - Container `app`: image `<ECR_URI>:<color>`, port 3000
  - Env: COLOR, COMPUTE_TYPE=ecs-fargate, REDIS_URL, DB_HOST, DB_USER
  - Secrets: DB_PASSWORD
- Capacity provider strategy: `[{FARGATE: weight=1}]`
- Desired count: 2
- Subnets: `computeSubnets`, SG: `bg-ecsfg-task-{color}-sg`
- ALB TG target type: `ip`, port 3000

### 5.6 ALB×3

각 워크로드 전용:

| ALB | Scheme | Subnets | TG | Listener |
|---|---|---|---|---|
| `bg-alb-ec2asg-{color}` | internet-facing | public | ec2asg-tg (instance, 80) | :80 → default 403, X-Custom-Secret 매치 시 forward |
| `bg-alb-ecsec2-{color}` | internet-facing | public | ecsec2-tg (instance, dyn port) | (동일 패턴) |
| `bg-alb-ecsfg-{color}` | internet-facing | public | ecsfg-tg (ip, 3000) | (동일 패턴) |

Idle timeout: 60s (default)
TG health check: `/health`, 200 OK, 30s 간격

### 5.7 X-Custom-Secret 생성

- 워크로드별 + 색상별로 다른 secret
- 형식: `bg-{color}-{workload}-{account-id}-{stack-suffix}`
- CfStack에서 동일 값을 CF custom origin header에 주입

## 6. Edge Layer (`BgTestCfStack`)

### 6.1 CloudFront Distribution

- Comment: `bg-test-cf`
- Default root object: 없음
- Price class: `PriceClass_200`
- Viewer protocol policy: REDIRECT_TO_HTTPS (모든 behavior 공통)
- Default cert: cloudfront.net default

### 6.2 Origins (3개)

| Origin ID | Domain (active=blue 시) | Custom Header |
|---|---|---|
| `origin-ec2asg`  | `<ALB-EC2-ASG-blue>.elb.amazonaws.com` | `X-Custom-Secret: <secret-blue-ec2asg>` |
| `origin-ecsec2`  | `<ALB-ECS-EC2-blue>.elb.amazonaws.com` | `X-Custom-Secret: <secret-blue-ecsec2>` |
| `origin-ecsfg`   | `<ALB-ECS-FG-blue>.elb.amazonaws.com`  | `X-Custom-Secret: <secret-blue-ecsfg>` |

`activeColor=green` 시 모든 origin domain이 GreenStack ALB로 전환.

Origin protocol policy: HTTP_ONLY, port 80
Origin connection attempts: 3, connection timeout: 5s
Origin read timeout: 30s, keepalive timeout: 5s

### 6.3 Cache Behaviors (4개)

| Path Pattern | Origin | Cache Policy | Origin Request Policy | Methods |
|---|---|---|---|---|
| `/ec2-asg/*` | `origin-ec2asg` | CACHING_DISABLED | ALL_VIEWER | ALL |
| `/ecs-ec2/*` | `origin-ecsec2` | CACHING_DISABLED | ALL_VIEWER | ALL |
| `/ecs-fg/*` | `origin-ecsfg` | CACHING_DISABLED | ALL_VIEWER | ALL |
| default | `origin-ec2asg` | CACHING_DISABLED | ALL_VIEWER | ALL |

`ALL_VIEWER` = 모든 viewer 헤더/쿼리/쿠키를 origin으로 전달 (X-Custom-Secret은 CF가 추가).

## 7. Application Layer

### 7.1 단일 Node.js Express 앱 (`app/`)

- 의존성: `express`, `ioredis`, `mysql2/promise`
- Container: `node:20-alpine`, ARM64
- Port: 3000

### 7.2 환경변수

| 변수 | 용도 | 주입 방식 |
|---|---|---|
| `COLOR` | `blue` 또는 `green` | env (compute-stack에서 주입) |
| `COMPUTE_TYPE` | `ec2-asg` / `ecs-ec2` / `ecs-fargate` | env |
| `REDIS_URL` | `rediss://<endpoint>:6379` | env (DataStack 출력 참조) |
| `DB_HOST` | Aurora cluster writer endpoint | env |
| `DB_USER` | `admin` | env |
| `DB_PASSWORD` | (런타임) Secrets Manager 값 | EC2: userdata fetch / ECS: task secrets |
| `DB_NAME` | `bgtest` | env |
| `AWS_REGION` | `ap-northeast-2` | env |

### 7.3 Endpoints

| Path | 응답 |
|---|---|
| `GET /` | HTML 페이지: 배경색=COLOR (Blue=#1e88e5, Green=#43a047), "BLUE" 또는 "GREEN" 큰 글자, 부가정보 표시 (auto-fetch /info, /redis/hit, /db/ping) |
| `GET /health` | 200, `{"status":"healthy","color":"<color>","compute":"<type>"}` |
| `GET /info` | `{ color, compute, hostname, az, instanceId(or taskArn), redisHits, dbPingMs }` |
| `GET /redis/hit` | Redis `INCR visits:<color>` 후 `{ visits: <n> }` |
| `GET /db/ping` | `SELECT NOW() AS t, @@hostname AS h` 결과 |

### 7.4 ECR 이미지 빌드

`scripts/build-and-push.sh <color>`:

```bash
COLOR=${1:-blue}
docker build --platform linux/arm64 -t bg-app:${COLOR} ./app
aws ecr get-login-password ... | docker login ...
docker tag bg-app:${COLOR} <ECR_URI>:${COLOR}
docker push <ECR_URI>:${COLOR}
```

Phase 1: `./build-and-push.sh blue`
Phase 2 (시나리오 3 전): `./build-and-push.sh green` (현재는 동일 이미지, 향후 색상 차별화 가능)

## 8. CDK Context 패턴 (롤백 가능 설계)

### 8.1 cdk.json default

```json
{
  "context": {
    "activeColor": "blue",
    "includeSecondaryCidr": false,
    "includeGreen": false
  }
}
```

### 8.2 시나리오별 명령

```bash
# 시나리오 1: Blue 배포
cdk deploy --all

# 시나리오 2: VPC secondary CIDR 추가
cdk deploy BgTestNetworkStack -c includeSecondaryCidr=true

# 시나리오 3: Green 배포 + CF 전환
cdk deploy BgTestGreenStack BgTestCfStack \
  -c includeSecondaryCidr=true -c includeGreen=true -c activeColor=green

# 시나리오 4: Blue로 롤백
cdk deploy BgTestCfStack \
  -c includeSecondaryCidr=true -c includeGreen=true -c activeColor=blue
```

코드 자체는 양쪽 색상 정의를 모두 보유 → 어느 시점에서든 context 변경만으로 원복 가능.

## 9. Demo Scripts (`demos/`)

### 9.1 `shared.sh`

공통 함수:
- ANSI 색상 변수 (R, G, Y, B, M, C, W, D, BG_*)
- `hr <char> <color>` — horizontal rule
- `center <text>` — 텍스트 가운데 정렬
- `typewrite <text> <delay>` — 한 글자씩 출력
- `typewrite_color <color> <text> <delay>`
- `spinner <pid> <msg>` — 백그라운드 작업 동안 spinner 표시
- `anim_bar <pct> <color> <label>` — 진행률 막대
- `pause_key` — Press Enter to continue
- `print_step <n> <total> <title>` — STEP n/M 헤더
- `fetch_status` — CF URL, active color, stack 상태 조회 (CFn describe-stacks + describe-target-health)
- `cdk_deploy <stack> <context_args>` — `cdk deploy` 래퍼 (spinner 포함)

### 9.2 `launcher.sh`

ASCII 로고 + 실시간 status header + 4 시나리오 메뉴 + watch 옵션. spot-gpu-lotto/launcher.sh 동일 패턴.

### 9.3 `scenario1-deploy-blue.sh` — Blue 전체 배포 + 검증

```
STEP 1/5  Pre-flight Check
  - AWS account/region
  - cdk version
  - CloudFront origin-facing prefix list ID 자동 조회
  - ECR login 사전 검증

STEP 2/5  CDK Bootstrap (idempotent)

STEP 3/5  Deploy Foundation (병렬)
  - cdk deploy BgTestNetworkStack BgTestEcrStack
  - 진행률 spinner

STEP 4/5  Build & Push App Image (Blue)
  - scripts/build-and-push.sh blue
  - Docker build → ECR push (anim_bar)

STEP 5/5  Deploy Data + Blue + CF
  - cdk deploy BgTestDataStack BgTestBlueStack BgTestCfStack
  - CF distribution propagation 대기 (~5분, spinner + narrative)
  - 최종 검증:
    * curl https://<cf>/health → 200
    * curl https://<cf>/ec2-asg/info → COLOR=blue, COMPUTE=ec2-asg
    * curl https://<cf>/ecs-ec2/info → COLOR=blue, COMPUTE=ecs-ec2
    * curl https://<cf>/ecs-fg/info  → COLOR=blue, COMPUTE=ecs-fargate
    * GET /redis/hit × 5 → counter 증가 확인
    * GET /db/ping → Aurora 응답
```

### 9.4 `scenario2-add-secondary-cidr.sh` — VPC secondary CIDR 추가 + 검증

```
STEP 1/4  현재 VPC 상태 출력
  - aws ec2 describe-vpcs로 현재 CIDR 표시
  - private-1 서브넷의 사용 가능 IP 카운트 표시

STEP 2/4  Secondary CIDR 추가
  - cdk deploy BgTestNetworkStack -c includeSecondaryCidr=true
  - VPC 10.1.0.0/16 + private-2-a (10.1.0.0/22) + private-2-b (10.1.4.0/22) 생성
  - 라우팅 테이블 추가 / VPC endpoints 자동 attach

STEP 3/4  새 서브넷 정상성 검증
  - 새 서브넷 라우팅 NAT 연결 확인
  - 임시 EC2 launch (또는 existing ALB target health 활용)
  - 외부 ping (NAT egress) 확인

STEP 4/4  요약
  - 변경 전후 비교 표 (CIDRs, subnet count, available IPs)
```

### 9.5 `scenario3-migrate-to-green.sh` — Green 배포 + CF 전환

```
STEP 1/5  Build Green Image
  - scripts/build-and-push.sh green
  - (Phase 2에서 색상 차별화 시 이 단계가 의미 있음)

STEP 2/5  Deploy GreenStack
  - cdk deploy BgTestGreenStack -c includeSecondaryCidr=true -c includeGreen=true
  - GreenStack: ALB×3 + EC2 ASG + ECS service×2 → private-2 (/22)
  - Redis/Aurora는 BlueStack 그대로 사용 (cross-stack)

STEP 3/5  Green 직접 검증 (CF 거치지 않고 Green ALB 직접)
  - 아직 CF는 Blue 가리킴
  - GreenStack outputs에서 ALB DNS 가져와서 X-Custom-Secret 헤더 포함 curl
  - 응답 "GREEN" 확인

STEP 4/5  CF Origin Swap
  - cdk deploy BgTestCfStack -c activeColor=green -c includeGreen=true ...
  - propagation 대기 (~5분, spinner)
  - 트래픽 즉시 전환 (sticky session 무 → 즉시)

STEP 5/5  최종 검증
  - curl https://<cf>/ec2-asg/info → COLOR=green
  - Redis counter 확인 (Blue에서 누적된 값 그대로 + Green에서 증가)
  - Aurora row 보존 확인
```

### 9.6 `scenario4-rollback-to-blue.sh` — Blue 원복

```
STEP 1/3  현재 active color 확인
  - aws cloudfront get-distribution-config로 origin domain 조회
  - GreenStack 가리키는 것 확인

STEP 2/3  CF Origin 원복
  - cdk deploy BgTestCfStack -c activeColor=blue -c includeGreen=true ...
  - propagation 대기

STEP 3/3  검증
  - curl 응답 "BLUE" 복귀
  - GreenStack은 유지 (재전환 가능)
  - 옵션: cdk destroy BgTestGreenStack
```

### 9.7 `watch-bluegreen-status.sh`

5초 간격 무한 루프 + clear:
- 현재 active color (CF origin domain 파싱)
- 각 ALB의 TG healthy/unhealthy count
- Redis counter 값 (color별 visits 키)
- Aurora 연결 가능성 (curl /db/ping)

별도 터미널에서 띄우면 시나리오 진행 중 실시간 변화 추적.

## 10. 명명 규약 + 태그

### 10.1 Stack 이름

`BgTest{Network,Data,Ecr,Blue,Green,Cf}Stack`

### 10.2 리소스 Name 태그

`bg-{tier}-{resource}` 또는 `bg-{tier}-{resource}-{color}`:

- `bg-vpc`, `bg-public-rt`, `bg-private-rt`
- `bg-redis`, `bg-aurora-cluster`, `bg-aurora-writer`, `bg-aurora-reader`
- `bg-ecr`
- `bg-alb-ec2asg-blue`, `bg-alb-ecsec2-blue`, `bg-alb-ecsfg-blue` (green 동일 패턴)
- `bg-ec2asg-blue`, `bg-ecs-cluster`
- `bg-cf`

### 10.3 공통 태그 (모든 리소스)

```
Project=bg-test
Environment=lab
ManagedBy=cdk
```

`Color=blue` 또는 `Color=green` 태그는 BlueStack/GreenStack 리소스에 추가.

## 11. 의존성 / Stack Dependency

```
Network ──┬──→ Data ─────┐
          ├──→ Ecr ──────┤
          ├──→ Cluster ──┼──→ Blue ──┐
          │              │           ├──→ Cf
          │              └──→ Green ─┘
          └──→ (시나리오 2에서 secondary CIDR update)
```

- CfStack은 Blue/Green compute stack에서 ALB DNS와 X-Custom-Secret을 cross-stack reference (CfnOutput / Fn.importValue 또는 직접 prop 전달)
- ClusterStack은 ECS cluster ARN을 export → Blue/Green compute stack이 import해서 service의 cluster prop으로 사용
- DataStack의 Aurora endpoint, Redis endpoint, Secrets ARN도 동일하게 export → compute stack이 환경변수로 주입

## 12. 구현 단계 (Phase 1 우선)

### Phase 1: Blue 시나리오 완성

1. CDK 프로젝트 초기화 + 패키지 + tsconfig
2. `lib/config.ts` (CIDR, naming, instance types, region)
3. `lib/network-stack.ts` (VPC + subnets + NAT + endpoints, includeSecondaryCidr 분기)
4. `lib/data-stack.ts` (Aurora + Redis)
5. `lib/ecr-stack.ts`
6. `lib/cluster-stack.ts` (ECS cluster, FARGATE 등록, Blue/Green 공유)
7. `lib/compute-stack.ts` (재사용 클래스, color/computeSubnets props, EC2 ASG capacity provider 자기 색상 등록)
8. `lib/cf-stack.ts` (origin domain은 active color 기반)
9. `bin/app.ts` (모든 stack 인스턴스화 + dependency 설정)
10. `app/server.js` + Dockerfile + package.json
11. `scripts/build-and-push.sh`
12. `demos/shared.sh` + `launcher.sh` + `scenario1-deploy-blue.sh`
13. `cdk synth` 검증 + `cdk deploy --all` 시연
14. `demos/scenario2-add-secondary-cidr.sh` + 시연

### Phase 2: Green + 마이그레이션 + 롤백 (추후)

1. `bin/app.ts`에 GreenStack 추가 (이미 includeGreen 분기 있음)
2. `demos/scenario3-migrate-to-green.sh`
3. `demos/scenario4-rollback-to-blue.sh`
4. `demos/watch-bluegreen-status.sh`
5. (선택) Green 이미지 색상 차별화 (server.js의 COLOR 환경변수 외에 다른 시각적 차이)

## 13. 검증 / 테스트 전략

### 13.1 CDK 단위

- `cdk synth` 모든 stack 통과 (CloudFormation 합성 검증)
- `cdk diff` 시나리오별 예상 변경 확인
- `cfn-lint` 또는 `cdk-nag` (선택)

### 13.2 배포 후

- 각 ALB TG의 모든 target healthy
- CF distribution status = `Deployed`
- 직접 ALB curl (X-Custom-Secret 없이) → 403 (default action 동작 확인)
- 직접 ALB curl (X-Custom-Secret 매치) → 200 (rule 동작 확인)
- CF URL → 200 + 정확한 COLOR/COMPUTE 응답
- Redis INCR 동작 (워크로드별 카운터 증가)
- Aurora SELECT NOW 동작
- SSM Session Manager로 EC2 ASG 인스턴스 접근 (디버깅 용이)

### 13.3 시나리오별 데모 검증

각 시나리오 끝에서 자동 검증 단계 (curl + jq) 후 PASS/FAIL 출력.

## 14. 보안 고려사항

- ALB SG: prefix list만 허용 (직접 접근 차단)
- ALB Listener: default 403 + 헤더 매치 시에만 forward
- CF custom origin header: HTTPS 구간 (CF→ALB)에서만 평문 전송
- Secrets Manager: DB 비밀번호 평문 저장 X
- VPC endpoints: NAT egress 줄여 외부 노출 최소화
- ElastiCache: TLS in-transit + at-rest encryption
- Aurora: at-rest encryption (default)
- IAM: 워크로드별 least-privilege role (ECR pull, Secrets read, CW Logs write)
- restrictDefaultSecurityGroup: true (CDK feature flag)

## 15. 비용 추정 (대략, lab 환경 기준 일별)

| 리소스 | 일 비용 (USD) |
|---|---|
| EC2 t4g.xlarge × 4 (Blue ASG) | ~$15 |
| ECS-EC2 t4g.xlarge × 2 | ~$8 |
| Fargate ARM64 task × 2 (1 vCPU/2GB) | ~$2 |
| Aurora db.t4g.xlarge × 2 + 스토리지 | ~$15 |
| ElastiCache cache.t4g.xlarge × 2 | ~$8 |
| ALB × 3 | ~$1.5 |
| NAT GW × 2 + 데이터 | ~$3 |
| CloudFront | <$0.5 (lab 트래픽) |
| **Phase 1 (Blue만) 합계** | **~$53/일** |
| Phase 2 (Blue+Green 동시) | **~$100/일** |

데모 후 즉시 `cdk destroy --all`로 종료 권장.

## 16. 미해결 / 추후 결정

- (없음 — 모든 결정 사항이 이 spec에 반영됨)

## 17. 다음 단계

이 spec 사용자 review → 승인 시 `superpowers:writing-plans` 스킬로 단계별 구현 plan 작성 → `superpowers:executing-plans`로 구현 진행.

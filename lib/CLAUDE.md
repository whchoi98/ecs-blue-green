# lib/ Module — CDK Stack Definitions

## Role

Contains all AWS CDK stack classes for the ecs-blue-green project. Each file is a self-contained CDK stack. Stacks reference each other via constructor injection (no `Fn.importValue` across stacks — props are passed directly).

## Key Files

| File | Stack | Purpose |
|------|-------|---------|
| `config.ts` | (no stack) | `LAB_CONFIG` constant: CIDRs, instance types, common tags |
| `network-stack.ts` | `BgTestNetworkStack` | VPC, subnets (public/private1/private2/db), NAT GWs, VPC Endpoints |
| `data-stack.ts` | `BgTestDataStack` | Aurora MySQL 8.0 cluster + ElastiCache Redis 7.1 replication group |
| `ecr-stack.ts` | `BgTestEcrStack` | ECR repository `bg-app` with lifecycle policy |
| `cluster-stack.ts` | `BgTestClusterStack` | ECS cluster `test-cluster` (shared by Blue/Green) |
| `alb-stack.ts` | `BgTestAlbStack` | 3 ALBs + Blue/Green TGs + weighted listener rule |
| `compute-stack.ts` | `BgTestBlueStack` / `BgTestGreenStack` | EC2 ASG + ECS EC2 service + ECS Fargate service (parametric by color + subnet) |
| `cf-stack.ts` | `BgTestCfStack` | CloudFront distribution with 3 origins and 4 path behaviors |
| `rolling-stack.ts` | `BgTestRollingStack` | EC2 ASG + Warm Pool + independent ALB for rolling demo |
| `rolling-cf-stack.ts` | `BgTestRollingCfStack` | CloudFront distribution for Rolling scenario |
| `rolling-context.ts` | (util) | `validateRollingContext()` pure function — validates required context keys |

## Rules

- **Naming**: All stacks must be named `BgTest<Name>Stack`. Use `resourcePrefix` from `LAB_CONFIG` for resource Name tags.
- **ARM64 only**: All EC2 instances use Graviton (m7g, c7g, t4g family). All ECS task definitions use `CpuArchitecture.ARM64`.
- **No `any` types**: TypeScript strict mode; explicit return types on all public methods and CDK construct constructors.
- **RemovalPolicy**: Stateful resources (Aurora, Redis, ECR) must have explicit `RemovalPolicy`. Default is `RETAIN` for production safety.
- **SG rules**: Prefer SG-to-SG ingress over CIDR-based rules. Avoid `0.0.0.0/0` on non-public resources.
- **CfnOutput**: Add CfnOutput for any ALB DNS name, CloudFront domain, cluster name, or ECR URI that other stacks or scripts need.
- **Context flags**: Always validate with `app.node.tryGetContext('key') === 'true'` pattern. Document new flags in `CLAUDE.md` and `README.md`.
- **ALB weights**: Blue/Green ratio lives only in `BgTestAlbStack`. Never store traffic color in any stack property or SSM parameter.
- **Tests**: Every new CDK construct must have a corresponding `test/` assertion (stack synth + resource count check at minimum).

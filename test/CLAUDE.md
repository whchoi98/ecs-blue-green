# test/ Module — CDK Jest Tests

## Role

Jest test suite for CDK stack synthesis validation. Tests assert that CDK stacks synthesize correctly and contain the expected AWS resources. Uses `ts-jest` for TypeScript compilation.

## Key Files

| File | Stack Tested |
|------|-------------|
| `network-stack.test.ts` | BgTestNetworkStack — VPC, subnets, NAT GWs, VPC Endpoints |
| `data-stack.test.ts` | BgTestDataStack — Aurora cluster, Redis replication group |
| `ecr-stack.test.ts` | BgTestEcrStack — ECR repository, lifecycle policy |
| `cluster-stack.test.ts` | BgTestClusterStack — ECS cluster |
| `alb-stack.test.ts` | BgTestAlbStack — ALBs, TGs, listener rules |
| `compute-stack.test.ts` | BgTestBlueStack / BgTestGreenStack — ASG, ECS services |
| `cf-stack.test.ts` | BgTestCfStack — CloudFront distribution, behaviors |
| `rolling-stack.test.ts` | BgTestRollingStack — Rolling ASG, Warm Pool |

## Rules

- Use `it()` not `test()` for consistency (jest both work; project uses `it()`).
- Each test file imports only the stack under test + its direct dependency stacks (construct test isolation).
- Use `Template.fromStack(stack)` and `template.hasResourceProperties()` for assertions.
- CIDR assertions must match `lib/config.ts` `LAB_CONFIG` values — never hardcode CIDRs in tests.
- When adding a new CDK resource, add at minimum: resource type count assertion + key property assertion.
- Run specific stack test: `npm test -- test/<stack-name>.test.ts`
- Snapshot updates: `npm test -- -u` (use only when CDK construct intentionally changed)
- The app-level test (`test/app.test.ts` if present) validates full stack dependency chain.

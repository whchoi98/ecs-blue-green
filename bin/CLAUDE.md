# bin/ Module — CDK App Entry Point

## Role

CDK application entry point. Instantiates all stacks in dependency order and applies context-flag gating for optional stacks (Green, Rolling). This is the only place where stacks are connected via constructor props.

## Key Files

| File | Purpose |
|------|---------|
| `app.ts` | Main CDK app — instantiates stacks, wires props, applies context guards |

## Stack Instantiation Order

```
BgTestNetworkStack
  -> BgTestDataStack (needs: vpc, subnets)
  -> BgTestEcrStack
  -> BgTestClusterStack (needs: vpc)
  -> BgTestAlbStack (needs: vpc, subnets, cluster)
    -> BgTestBlueStack (needs: alb TGs, subnets, data, cluster, ecr)
    -> [BgTestGreenStack] (includeGreen=true, same props as Blue with green subnets)
    -> BgTestCfStack (needs: ALB DNS names)
  -> [BgTestRollingStack] (includeRolling=true, needs: vpc, subnets, data, ecr)
    -> [BgTestRollingCfStack] (needs: Rolling ALB DNS)
```

## Rules

- Context flags are read with `app.node.tryGetContext('key') === 'true'`. Never use `app.node.getContext()` (throws if missing).
- All stack `env` must be set to `{ account: process.env.CDK_DEFAULT_ACCOUNT, region: 'ap-northeast-2' }`.
- No business logic in `bin/app.ts` — only wiring. Validation belongs in stack constructors or `rolling-context.ts`.
- Stack tags: apply `Tags.of(app).add('Project', 'ecs-blue-green')` at the app level.
- When adding a new optional stack: add it inside an `if (includeXxx)` block and document the context key in `README.md` and root `CLAUDE.md`.

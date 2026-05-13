# Project Conventions

## Commit conventions

- Do **NOT** add `Co-Authored-By: Claude ...` (or any AI co-author) lines to commit messages.
- All commits in this repository are attributed solely to the user (`whchoi98 <whchoi98@gmail.com>`).
- Rationale: the project's GitHub contributors graph reflects human authorship only.

## Git identity

- `user.name`  = `whchoi98`
- `user.email` = `whchoi98@gmail.com`

(Already set in this repo's local `.git/config`. Do not override.)

---

## Overview

**ecs-blue-green** is an ALB weighted Blue/Green + EC2 ASG Rolling migration CDK demo for AWS ap-northeast-2 (Seoul) using Graviton ARM64 instances. It demonstrates traffic shifting between Blue and Green ECS/EC2 compute tiers via weighted ALB listener rules, without CDK redeployment. A secondary rolling-update scenario (BgTestRollingStack) shows EC2 ASG instance refresh.

## Tech Stack

- **Infrastructure**: AWS CDK v2 (2.248.0), TypeScript 5.9
- **Runtime**: Node.js 20+, ts-node 10, ts-jest 29, jest 30
- **AWS Region**: ap-northeast-2 (Seoul)
- **Compute**: EC2 Graviton ARM64 (m7g/c7g), ECS EC2 + Fargate
- **Networking**: VPC (10.1.0.0/16 primary, 10.2.0.0/16 secondary demo), ALB×3, CloudFront
- **Data**: Aurora MySQL 8.0/3.08 (db.t4g.large), ElastiCache Redis 7.1 (cache.m7g.large)
- **App**: Express.js (ARM64 Docker image, ECR bg-app repo)

## Project Structure

```
bin/            - CDK app entry (app.ts) — context flag branching
lib/            - CDK stack definitions (Network, Data, Ecr, Cluster, Alb, Blue, Green, Cf, Rolling, RollingCf)
app/            - Express.js server with Redis/Aurora connectivity
demos/          - Scenario scripts + launcher.sh + shared helpers + watch monitors
scripts/        - build-and-push.sh (ARM64 Docker → ECR), setup.sh, install-hooks.sh
test/           - jest stack synth tests
tests/          - Harness validation tests (hooks, structure, secrets)
docs/           - Architecture, ADRs, runbooks, onboarding, API reference
docs/superpowers/ - Design specs and implementation plans (preserve — do not edit)
.claude/        - Claude Code hooks, skills, commands, agents
tools/prompts/  - Reusable prompt templates
```

## Key Commands

```bash
npm install                    # Install all dependencies
npm test                       # Run all CDK stack jest tests
npm run build                  # TypeScript compile
npx cdk synth                  # Synthesize CloudFormation templates
npx cdk deploy --all           # Deploy all stacks
./demos/launcher.sh            # Interactive demo launcher (presentation mode)
bash scripts/setup.sh          # New developer setup (install + hooks)
bash tests/run-all.sh          # Run harness validation tests
```

## Conventions

- CDK stacks: `BgTest<Name>Stack` prefix (e.g., `BgTestNetworkStack`)
- Context flags: `includeSecondaryCidr`, `includeGreen`, `includeRolling` (string "true")
- ALB weights are the single source of truth for Blue/Green traffic split
- ARM64 Docker images only — use `--platform linux/arm64` in buildx
- TypeScript: no `any`, strict null checks, explicit return types on public methods
- Commit style: Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`)
- No emoji in code or commit messages

## Auto-Sync Rules

Rules applied automatically after plan-mode exit and on major code changes.

### Post-Plan Mode Actions

After exiting Plan mode, before starting implementation:

1. **Architecture decision made** -- Update `docs/architecture.md`
2. **Technical choice/trade-off made** -- Create `docs/decisions/ADR-NNN-title.md`
3. **New CDK stack added** -- Create or update `lib/CLAUDE.md` and `docs/architecture.md`
4. **Operational procedure defined** -- Create runbook in `docs/runbooks/`
5. **Changes needed in this file** -- Update relevant sections above

### Code Change Sync Rules

- New CDK stack under `lib/` -- Update `lib/CLAUDE.md` and `docs/architecture.md` Infrastructure table
- New demo script under `demos/` -- Update `demos/CLAUDE.md` scenario index
- Express endpoint added/changed -- Update `docs/api-reference.md`
- Infrastructure cost change -- Note in ADR

### ADR Numbering

Find the highest number in `docs/decisions/ADR-*.md` and increment by 1.
Format: `ADR-NNN-concise-title.md`

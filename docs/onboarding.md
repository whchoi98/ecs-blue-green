# Developer Onboarding

## Quick Start

### 1. Prerequisites

- [ ] Node.js 20+ installed (`node --version`)
- [ ] AWS CLI v2 installed and configured for ap-northeast-2 (`aws configure`)
- [ ] Docker buildx installed and available (for ARM64 image builds: `docker buildx ls`)
- [ ] AWS CDK CLI installed (`npm install -g aws-cdk` or use `npx cdk`)
- [ ] Repository access granted

### 2. Setup

```bash
# Clone the repository
git clone https://github.com/whchoi98/ecs-blue-green.git
cd ecs-blue-green

# Run the automated setup script
bash scripts/setup.sh
```

The setup script installs Node.js dependencies, creates a `.env` from `.env.example`, and installs Git hooks.

**Manual steps after setup:**

```bash
# Bootstrap CDK (once per account/region)
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/ap-northeast-2

# Synthesize all stacks (validates TypeScript compilation)
npx cdk synth

# Launch the interactive demo menu
./demos/launcher.sh
```

### 3. Verify

```bash
# Run all CDK stack tests
npm test

# Verify TypeScript compiles cleanly
npm run build

# Check harness tests
bash tests/run-all.sh
```

All tests should pass before beginning development.

## Project Overview

Read the following documents in order to understand the project:

1. `CLAUDE.md` -- Project conventions, commit style, key commands
2. `docs/architecture.md` -- Full system design, CDK stacks, data flows
3. `docs/api-reference.md` -- Express app endpoints
4. `docs/decisions/` -- Architectural decisions and trade-offs
5. `docs/superpowers/specs/` -- Original design specifications

## Development Workflow

- **Branch naming**: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`
- **Commit convention**: Conventional Commits with stack scope (e.g., `feat(rolling): add warm pool`)
- **No AI co-author lines**: The commit-msg hook strips `Co-Authored-By:` automatically
- **Tests before merge**: `npm test` must pass; run `npx cdk diff` to preview infrastructure changes

## Key Concepts

### Blue/Green Traffic Control
Traffic between Blue and Green compute tiers is controlled exclusively by ALB weighted listener rules. To shift 30% to Green:
```bash
./demos/scenario3-shift-traffic.sh 30
```
This calls `aws elbv2 modify-rule` and takes effect within 1-2 seconds. No CDK redeployment needed.

### CDK Context Flags
The stacks are gated by context flags:
- `includeSecondaryCidr=true` -- Adds secondary VPC CIDR + private2 subnets
- `includeGreen=true` -- Deploys Green compute stack + Green TG (weight 0 initially)
- `includeRolling=true` -- Deploys Rolling ASG + dedicated CloudFront

Always pass context flags consistently: `npx cdk deploy --all --context includeGreen=true`

### ARM64 Docker Images
All EC2 instances and ECS tasks use Graviton ARM64. Docker images must be built for `linux/arm64`:
```bash
bash scripts/build-and-push.sh v1
```

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| `npm test` fails with snapshot mismatch | CDK construct changed | Run `npm test -- -u` to update snapshots |
| `cdk deploy` fails with "not bootstrapped" | CDK bootstrap not run | `npx cdk bootstrap aws://ACCOUNT/ap-northeast-2` |
| ECS tasks failing to start | ARM64 image not pushed or wrong tag | `bash scripts/build-and-push.sh <tag>` |
| ALB returns 502 | ECS tasks not healthy or wrong target group | Check ECS service events in console |
| CloudFront 403 | X-Custom-Secret header mismatch | Check ALB listener rule condition in console |

## Resources

- Design spec: `docs/superpowers/specs/2026-04-28-bluegreen-cdk-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-28-bluegreen-cdk.md`
- Architecture: `docs/architecture.md`
- API reference: `docs/api-reference.md`
- GitHub: https://github.com/whchoi98/ecs-blue-green

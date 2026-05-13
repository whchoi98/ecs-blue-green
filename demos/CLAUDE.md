# demos/ Module — Scenario Scripts

## Role

Bash scripts for the interactive CDK demo presentation. All scripts use `shared.sh` for common helpers (color output, AWS CLI wrappers, `ensure_npm_deps`). The `launcher.sh` is the single entry point for all demo scenarios.

## Key Files

| File | Purpose |
|------|---------|
| `launcher.sh` | Interactive TUI menu — Phase 1 (Deploy), Phase 2 (Traffic), Rolling, Observability |
| `shared.sh` | Common helpers: `print_header`, `ensure_npm_deps`, `get_alb_rule_arn`, `set_weights` |
| `scenario1-deploy-blue.sh` | Phase 1: Deploy Blue infrastructure (5-step demo flow) |
| `scenario2-add-secondary-cidr.sh` | Phase 1: Secondary CIDR demo + private2 /22 carve-out |
| `scenario3-shift-traffic.sh` | Phase 2: Set exact Green traffic percentage (arg: 0-100) |
| `scenario4-rollback-to-blue.sh` | Phase 2: Full rollback to Blue (Green weight = 0) |
| `scenario-progressive-shift.sh` | Phase 2: Auto step 0->10->25->50->75->90->100 |
| `scenario-slider.sh` | Phase 2: TUI interactive slider (arrow keys +/-5, +/- keys +/-1) |
| `scenario-rolling-1-deploy.sh` | Rolling: Deploy Rolling stack + CDK diff |
| `scenario-rolling-2-refresh.sh` | Rolling: Trigger ASG instance refresh |
| `scenario-rolling-3-rollback.sh` | Rolling: Rollback Rolling deployment |
| `watch-bluegreen-traffic.sh` | Observability: Live monitor (Blue/Green TG weights, ALB requests, app hits) |
| `watch-rolling.sh` | Observability: Live monitor for Rolling ASG instance refresh |

## Rules

- All scripts must `source "$(dirname "$0")/shared.sh"` at the top.
- Use `print_header` and `print_step` functions from `shared.sh` for consistent presentation output.
- `ensure_npm_deps` must be called before any `npx cdk` invocation.
- Scripts that shift ALB weights must use `set_weights <blue_pct> <green_pct>` from `shared.sh`.
- No hardcoded AWS account IDs or CloudFront URLs — derive at runtime via `aws cloudformation describe-stacks`.
- `watch-*.sh` scripts use `tput clear` + ANSI colors for terminal UI; graceful `trap cleanup SIGINT`.
- All scripts must be executable (`chmod +x`) and pass `bash -n` syntax check.
- Add new scenarios to `launcher.sh` menu immediately after creation.

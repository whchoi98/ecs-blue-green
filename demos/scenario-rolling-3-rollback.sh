#!/usr/bin/env bash
# Phase 3 — Rollback (v1 @ private1) via reverse Instance Refresh
# Usage: ./scenario-rolling-3-rollback.sh [min_healthy_pct]   # default 50
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/shared.sh"

cd "$ROOT_DIR"
ensure_npm_deps || exit 1

MIN_HEALTHY="${1:-50}"

print_step 1 5 "Phase 3 — Rollback (MinHealthy=${MIN_HEALTHY}%)"
echo "  ${D}Same mechanism, reverse direction: v2 → v1, private2 → private1.${RESET}"
pause_key

print_step 2 5 "Register reverse intent via CDK"
npx cdk deploy --all \
  -c includeSecondaryCidr=true \
  -c includeGreen=true \
  -c includeRolling=true \
  -c rollingLaunchVersion=v1 \
  -c rollingTargetSubnet=private1 \
  --require-approval never

print_step 3 5 "Trigger Instance Refresh (reverse)"
lt_id=$(aws ec2 describe-launch-templates --launch-template-names bg-rolling-lt \
  --query 'LaunchTemplates[0].LaunchTemplateId' --output text)
refresh_id=$(aws autoscaling start-instance-refresh \
  --auto-scaling-group-name bg-rolling-ec2asg \
  --strategy Rolling \
  --preferences "MinHealthyPercentage=${MIN_HEALTHY},InstanceWarmup=120,ScaleInProtectedInstances=Refresh,StandbyInstances=Terminate" \
  --desired-configuration "LaunchTemplate={LaunchTemplateId=${lt_id},Version=\$Latest}" \
  --query 'InstanceRefreshId' --output text)
echo "  ${G}✓${RESET} Reverse refresh started: ${refresh_id}"

print_step 4 5 "Polling"
start_epoch=$(date +%s)
while true; do
  state=$(fetch_rolling_refresh_status)
  status=$(echo "$state" | cut -d'|' -f1)
  pct=$(echo "$state" | cut -d'|' -f2)
  printf "  %s  status=%s  pct=%s%%\n" "$(date +%H:%M:%S)" "$status" "$pct"
  case "$status" in
    Successful) echo "  ${G}✓${RESET} Rollback completed"; break ;;
    Failed|Cancelled) echo "  ${R}✗${RESET} Ended status=${status}"; break ;;
  esac
  sleep 60
done

print_step 5 5 "Final verification"
fivexx=$(fetch_rolling_5xx "$start_epoch")
echo "  HTTP 5xx during rollback: ${fivexx}"
[ "$fivexx" = "0" ] && echo "  ${G}✓${RESET} Zero downtime in rollback as well"
pause_key

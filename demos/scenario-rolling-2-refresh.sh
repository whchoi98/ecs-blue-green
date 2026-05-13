#!/usr/bin/env bash
# Phase 2 — Rolling Migration via Instance Refresh
# Usage: ./scenario-rolling-2-refresh.sh [min_healthy_pct]   # default 50
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared.sh"

MIN_HEALTHY="${1:-50}"

print_step 1 6 "Phase 2 — Rolling Migration (MinHealthy=${MIN_HEALTHY}%)"
echo "  ${D}Change LT to v2 + ASG subnets to private2, then Instance Refresh.${RESET}"
pause_key

print_step 2 6 "Pre-flight: ECR :v2"
v2_exists=$(aws ecr describe-images --repository-name bg-app --image-ids imageTag=v2 \
  --query 'imageDetails[0].imageTags' --output text 2>/dev/null)
if [ -z "$v2_exists" ]; then
  echo "  ${R}✗${RESET} ECR :v2 missing — run ./scripts/build-and-push.sh v2"
  exit 1
fi
echo "  ${G}✓${RESET} ECR :v2 present"

print_step 3 6 "Register intent via CDK"
npx cdk deploy --all \
  -c includeSecondaryCidr=true \
  -c includeGreen=true \
  -c includeRolling=true \
  -c rollingLaunchVersion=v2 \
  -c rollingTargetSubnet=private2 \
  --require-approval never

print_step 4 6 "Pre-execution verification"
echo "  ${BOLD}Intent registered. Running instances are *still* v1 @ private1.${RESET}"
lt_id=$(aws ec2 describe-launch-templates --launch-template-names bg-rolling-lt \
  --query 'LaunchTemplates[0].LaunchTemplateId' --output text)
latest_v=$(aws ec2 describe-launch-templates --launch-template-names bg-rolling-lt \
  --query 'LaunchTemplates[0].LatestVersionNumber' --output text)
echo "  LT latest version: ${latest_v}  (id=${lt_id})"
zones=$(aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names bg-rolling-ec2asg \
  --query 'AutoScalingGroups[0].VPCZoneIdentifier' --output text)
echo "  ASG VPCZoneIdentifier: ${zones}"

print_step 5 6 "Trigger Instance Refresh"
refresh_id=$(aws autoscaling start-instance-refresh \
  --auto-scaling-group-name bg-rolling-ec2asg \
  --strategy Rolling \
  --preferences "MinHealthyPercentage=${MIN_HEALTHY},InstanceWarmup=120,ScaleInProtectedInstances=Refresh,StandbyInstances=Terminate" \
  --desired-configuration "LaunchTemplate={LaunchTemplateId=${lt_id},Version=\$Latest}" \
  --query 'InstanceRefreshId' --output text)
echo "  ${G}✓${RESET} Refresh started: ${refresh_id}"
echo "  ${D}💡 Open ./demos/watch-rolling.sh in another terminal for live view${RESET}"

print_step 6 6 "Polling progress (60s interval)"
start_epoch=$(date +%s)
while true; do
  state=$(fetch_rolling_refresh_status)
  status=$(echo "$state" | cut -d'|' -f1)
  pct=$(echo "$state" | cut -d'|' -f2)
  printf "  %s  status=%s  pct=%s%%\n" "$(date +%H:%M:%S)" "$status" "$pct"
  case "$status" in
    Successful) echo "  ${G}✓${RESET} Refresh completed"; break ;;
    Failed|Cancelled) echo "  ${R}✗${RESET} Ended status=${status}"; break ;;
  esac
  sleep 60
done

fivexx=$(fetch_rolling_5xx "$start_epoch")
echo "  HTTP 5xx since refresh start: ${fivexx}"
[ "$fivexx" = "0" ] && echo "  ${G}✓${RESET} Zero downtime achieved" || echo "  ${R}✗${RESET} 5xx detected"
pause_key

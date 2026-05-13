#!/usr/bin/env bash
# Phase 1 — Initial Rolling deploy (v1 image @ private1 subnets)
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/shared.sh"

cd "$ROOT_DIR"
ensure_npm_deps || exit 1

print_step 1 5 "Phase 1 — Initial Rolling Deploy (v1 @ private1)"
echo "  ${D}Creates ALB, ASG (4 in-service), Warm Pool (4 stopped), CloudFront.${RESET}"
echo "  ${D}Existing Blue/Green stacks are unchanged.${RESET}"
pause_key

print_step 2 5 "CDK Deploy"
echo "  ${C}\$ npx cdk deploy --all \\${RESET}"
echo "  ${C}    -c includeSecondaryCidr=true \\${RESET}"
echo "  ${C}    -c includeGreen=true \\${RESET}"
echo "  ${C}    -c includeRolling=true \\${RESET}"
echo "  ${C}    -c rollingLaunchVersion=v1 \\${RESET}"
echo "  ${C}    -c rollingTargetSubnet=private1${RESET}"
echo
npx cdk deploy --all \
  -c includeSecondaryCidr=true \
  -c includeGreen=true \
  -c includeRolling=true \
  -c rollingLaunchVersion=v1 \
  -c rollingTargetSubnet=private1 \
  --require-approval never

print_step 3 5 "Verify ASG state"
asg_state=$(aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names bg-rolling-ec2asg \
  --query 'AutoScalingGroups[0].[DesiredCapacity,length(Instances[?LifecycleState==`InService`])]' \
  --output text)
desired=$(echo "$asg_state" | awk '{print $1}')
in_service=$(echo "$asg_state" | awk '{print $2}')
echo "  ${BOLD}ASG bg-rolling-ec2asg${RESET}  desired=${desired}  in-service=${in_service}"
[ "$in_service" = "4" ] && echo "  ${G}✓${RESET} 4 in-service instances" || echo "  ${Y}⚠${RESET} expected 4 in-service, got ${in_service}"

print_step 4 5 "Verify Warm Pool"
warm_count=$(aws autoscaling describe-warm-pool \
  --auto-scaling-group-name bg-rolling-ec2asg \
  --query 'length(Instances[?LifecycleState==`Stopped`])' --output text 2>/dev/null)
echo "  Warm Pool stopped: ${warm_count}"
[ "$warm_count" = "4" ] && echo "  ${G}✓${RESET} 4 warm-pool instances stopped" || echo "  ${Y}⚠${RESET} expected 4, got ${warm_count}"

print_step 5 5 "Verify response via CloudFront"
cf_url=$(fetch_rolling_cf_url)
echo "  Rolling CF URL: ${cf_url}"
if [ "$cf_url" != "(not deployed)" ]; then
  body=$(curl -s --max-time 10 "${cf_url}/info" || echo "(timeout)")
  echo "  Response: ${body}"
  echo "$body" | grep -q '"version":"v1"' && echo "  ${G}✓${RESET} version=v1 confirmed" || echo "  ${Y}⚠${RESET} version not v1"
fi

echo
echo "  ${BOLD}Next:${RESET} Phase 2 (Instance Refresh to v2 @ private2)"
echo "  ${D}Tip: open a separate terminal: ./demos/watch-rolling.sh${RESET}"
pause_key

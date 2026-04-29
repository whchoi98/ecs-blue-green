#!/usr/bin/env bash
# Shift traffic between Blue and Green via ALB weighted target groups.
# Effective in ~1-2 seconds (no DNS, no CF propagation, no rolling restart).
#
# Usage:
#   ./scenario3-shift-traffic.sh           → interactive prompt
#   ./scenario3-shift-traffic.sh 10        → Blue 90% / Green 10%  (canary)
#   ./scenario3-shift-traffic.sh 50        → Blue 50% / Green 50%
#   ./scenario3-shift-traffic.sh 100       → Blue   0% / Green 100% (full Green)
#   ./scenario3-shift-traffic.sh 0         → Blue 100% / Green   0% (full Blue / rollback)

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared.sh"

if [ $# -lt 1 ]; then
  echo
  printf "%bUsage: %s <green_percent>%b\n" "$Y$BOLD" "$0" "$RESET"
  printf "       0   = full Blue (rollback)\n"
  printf "       10  = canary (Blue 90, Green 10)\n"
  printf "       50  = even split\n"
  printf "       100 = full Green\n"
  echo
  echo -ne "  ${C}Enter green % (0-100): ${RESET}"
  read -r GREEN
else
  GREEN="$1"
fi

if ! [[ "$GREEN" =~ ^[0-9]+$ ]] || [ "$GREEN" -lt 0 ] || [ "$GREEN" -gt 100 ]; then
  printf "%bError: green_percent must be 0-100%b\n" "$R" "$RESET" >&2
  exit 1
fi
BLUE=$((100 - GREEN))

clear
echo
hr '=' "$W$BOLD"
center "TRAFFIC SHIFT — Blue ${BLUE}% / Green ${GREEN}%"
hr '=' "$W$BOLD"
echo
typewrite "ALB weighted forward — modifying listener rule on 3 ALBs..." 0.01
echo; echo

apply_shift() {
  local workload="$1"
  local alb_name="bg-alb-${workload}-blue"

  local alb_arn listener_arn rule_arn blue_tg_arn green_tg_arn
  alb_arn=$(aws elbv2 describe-load-balancers --names "$alb_name" --query "LoadBalancers[0].LoadBalancerArn" --output text 2>/dev/null) || {
    printf "  %b%-12s%b ALB not found (%s)\n" "$R" "$workload" "$RESET" "$alb_name"
    return 1
  }
  listener_arn=$(aws elbv2 describe-listeners --load-balancer-arn "$alb_arn" --query "Listeners[0].ListenerArn" --output text)
  rule_arn=$(aws elbv2 describe-rules --listener-arn "$listener_arn" --query "Rules[?Priority=='1'].RuleArn" --output text)
  blue_tg_arn=$(aws elbv2 describe-target-groups --names "bg-tg-${workload}-blue" --query "TargetGroups[0].TargetGroupArn" --output text 2>/dev/null)
  green_tg_arn=$(aws elbv2 describe-target-groups --names "bg-tg-${workload}-green" --query "TargetGroups[0].TargetGroupArn" --output text 2>/dev/null) || true

  if [ -z "$rule_arn" ] || [ "$rule_arn" = "None" ]; then
    printf "  %b%-12s%b listener rule (priority 1) not found — skip\n" "$Y" "$workload" "$RESET"
    return 1
  fi
  if [ -z "$green_tg_arn" ] || [ "$green_tg_arn" = "None" ]; then
    printf "  %b%-12s%b Green TG not found — Green stack not deployed?\n" "$Y" "$workload" "$RESET"
    return 1
  fi

  aws elbv2 modify-rule --rule-arn "$rule_arn" --actions \
    "Type=forward,ForwardConfig={TargetGroups=[{TargetGroupArn=${blue_tg_arn},Weight=${BLUE}},{TargetGroupArn=${green_tg_arn},Weight=${GREEN}}]}" \
    > /dev/null
  printf "  %b%-12s%b  Blue %b%3d%%%b  Green %b%3d%%%b   %b✓ applied%b\n" \
    "$W$BOLD" "$workload" "$RESET" \
    "$B$BOLD" "$BLUE" "$RESET" \
    "$G$BOLD" "$GREEN" "$RESET" \
    "$G" "$RESET"
}

apply_shift ec2asg
apply_shift ecsec2
apply_shift ecsfg

echo
hr '=' "$G$BOLD"
if [ "$GREEN" -eq 0 ]; then
  center "🔵 Full Blue (rollback)  · weight 100/0"
elif [ "$GREEN" -eq 100 ]; then
  center "🟢 Full Green  · weight 0/100"
elif [ "$GREEN" -le 25 ]; then
  center "🐤 Canary  · ${BLUE}% / ${GREEN}%"
elif [ "$GREEN" -ge 75 ]; then
  center "🚀 Mostly Green  · ${BLUE}% / ${GREEN}%"
else
  center "⚖️  Split  · ${BLUE}% / ${GREEN}%"
fi
hr '=' "$G$BOLD"
echo
printf "  %bEffective:%b traffic redistributes within 1-2 seconds.\n" "$BOLD" "$RESET"
printf "  %bMonitor:%b   %b./demos/watch-bluegreen-traffic.sh%b   (별도 터미널)\n" "$BOLD" "$RESET" "$C" "$RESET"
printf "  %bVerify:%b    curl https://\$(aws cloudformation describe-stacks --stack-name BgTestCfStack --query \"Stacks[0].Outputs[?OutputKey=='CfDomain'].OutputValue\" --output text | tr -d 'https://')/info\n" "$BOLD" "$RESET"
echo

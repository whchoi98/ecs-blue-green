#!/usr/bin/env bash
# Shared functions for bg-test demo scripts. source this file.

R='\033[0;31m'; G='\033[0;32m'; Y='\033[0;33m'; B='\033[0;34m'
M='\033[0;35m'; C='\033[0;36m'; W='\033[1;37m'; D='\033[0;90m'
BG_B='\033[44m'; BG_G='\033[42m'; BG_R='\033[41m'; BG_Y='\033[43m'
BG_M='\033[45m'; BG_C='\033[46m'; BG_D='\033[100m'
RESET='\033[0m'; BOLD='\033[1m'

COLS=$(tput cols 2>/dev/null || echo 80)

hr() {
  local ch="${1:--}" color="${2:-$D}"
  printf '%b' "$color"
  for ((i=0; i<COLS; i++)); do printf '%s' "$ch"; done
  printf '%b\n' "$RESET"
}

center() {
  local text="$1" pad
  pad=$(( (COLS - ${#text}) / 2 ))
  [ "$pad" -lt 0 ] && pad=0
  printf '%*s%s\n' "$pad" '' "$text"
}

typewrite() {
  local text="$1" delay="${2:-0.02}"
  for ((i=0; i<${#text}; i++)); do
    printf '%s' "${text:$i:1}"
    sleep "$delay"
  done
}

spinner() {
  local pid=$1 msg="${2:-Working}"
  local frames=('|' '/' '-' '\')
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${C}${frames[$i]}${RESET} ${msg}..."
    i=$(( (i+1) % 4 ))
    sleep 0.1
  done
  printf "\r  ${G}[OK]${RESET} ${msg}   \n"
}

anim_bar() {
  local pct=$1 width=40 color="${2:-$G}" label="${3:-}"
  local filled=$(( pct * width / 100 ))
  local empty=$(( width - filled ))
  printf "  ${D}%3d%%${RESET} ${color}" "$pct"
  for ((j=0; j<filled; j++)); do printf '#'; done
  printf "${D}"
  for ((j=0; j<empty; j++)); do printf '.'; done
  printf "${RESET}"
  [ -n "$label" ] && printf " ${D}%s${RESET}" "$label"
  printf '\n'
}

pause_key() {
  echo
  echo -ne "  ${D}Press Enter to continue...${RESET}"
  read -r
}

print_step() {
  local n="$1" total="$2" title="$3"
  clear
  echo
  printf '  %b STEP %s/%s %b  %b%s%b\n' "$BG_M$W$BOLD" "$n" "$total" "$RESET" "$W$BOLD" "$title" "$RESET"
  hr '-' "$D"
  echo
}

cdk_deploy() {
  local stacks="$1" extra_ctx="${2:-}"
  echo "  ${C}\$ npx cdk deploy ${stacks} ${extra_ctx} --require-approval never${RESET}"
  npx cdk deploy ${stacks} ${extra_ctx} --require-approval never
}

fetch_active_weights() {
  # Returns "Blue NN / Green NN" by reading the weighted forward rule on the ec2asg ALB.
  # All 3 ALBs are kept in lock-step by scenario3-shift-traffic.sh, so one is representative.
  local alb_arn listener_arn rule_arn tgs
  alb_arn=$(aws elbv2 describe-load-balancers --names "bg-alb-ec2asg" \
    --query "LoadBalancers[0].LoadBalancerArn" --output text 2>/dev/null) || { echo "(not deployed)"; return; }
  [ -z "$alb_arn" ] || [ "$alb_arn" = "None" ] && { echo "(not deployed)"; return; }
  listener_arn=$(aws elbv2 describe-listeners --load-balancer-arn "$alb_arn" \
    --query "Listeners[0].ListenerArn" --output text 2>/dev/null)
  rule_arn=$(aws elbv2 describe-rules --listener-arn "$listener_arn" \
    --query "Rules[?Priority=='1'].RuleArn" --output text 2>/dev/null)
  [ -z "$rule_arn" ] || [ "$rule_arn" = "None" ] && { echo "Blue 100 / Green   0"; return; }
  tgs=$(aws elbv2 describe-rules --rule-arns "$rule_arn" \
    --query "Rules[0].Actions[0].ForwardConfig.TargetGroups" --output json 2>/dev/null)
  python3 - "$tgs" <<'PY' 2>/dev/null || echo "Blue 100 / Green   0"
import sys, json
b, g = 100, 0
for tg in json.loads(sys.argv[1]):
    name = tg['TargetGroupArn'].split(':')[-1].split('/')[1]  # bg-tg-ec2asg-blue
    if name.endswith('-blue'):  b = tg.get('Weight', 0)
    elif name.endswith('-green'): g = tg.get('Weight', 0)
print(f'Blue {b:>3} / Green {g:>3}')
PY
}

fetch_cf_url() {
  aws cloudformation describe-stacks --stack-name BgTestCfStack \
    --query "Stacks[0].Outputs[?OutputKey=='CfDomain'].OutputValue" --output text 2>/dev/null \
    || echo "(not deployed)"
}

# ALB ARN cache for fast weight changes — populated by discover_alb_arns(),
# consumed by apply_weights_cached(). Keys: workload (ec2asg|ecsec2|ecsfg).
# Value format: "rule_arn|blue_tg_arn|green_tg_arn"
declare -A ALB_INFO

# Discover ALB rule + Blue/Green TG ARNs for all 3 workloads in one shot.
# Caches into ALB_INFO so subsequent apply_weights_cached() calls only do modify-rule.
# Returns 0 on success, 1 if any workload's resources are missing.
discover_alb_arns() {
  local workload alb_arn listener_arn rule_arn blue_tg green_tg
  for workload in ec2asg ecsec2 ecsfg; do
    alb_arn=$(aws elbv2 describe-load-balancers --names "bg-alb-${workload}" \
      --query "LoadBalancers[0].LoadBalancerArn" --output text 2>/dev/null) || return 1
    [ -z "$alb_arn" ] || [ "$alb_arn" = "None" ] && return 1
    listener_arn=$(aws elbv2 describe-listeners --load-balancer-arn "$alb_arn" \
      --query "Listeners[0].ListenerArn" --output text 2>/dev/null)
    rule_arn=$(aws elbv2 describe-rules --listener-arn "$listener_arn" \
      --query "Rules[?Priority=='1'].RuleArn" --output text 2>/dev/null)
    blue_tg=$(aws elbv2 describe-target-groups --names "bg-tg-${workload}-blue" \
      --query "TargetGroups[0].TargetGroupArn" --output text 2>/dev/null)
    green_tg=$(aws elbv2 describe-target-groups --names "bg-tg-${workload}-green" \
      --query "TargetGroups[0].TargetGroupArn" --output text 2>/dev/null) || green_tg=""
    [ -z "$rule_arn" ] || [ "$rule_arn" = "None" ] && return 1
    [ -z "$blue_tg" ] || [ -z "$green_tg" ] && return 1
    ALB_INFO[$workload]="${rule_arn}|${blue_tg}|${green_tg}"
  done
  return 0
}

# Apply weights to all 3 ALBs using cached ARNs. Args: blue_pct green_pct.
# Calls run in parallel (& + wait) so total latency is single-API-call latency.
apply_weights_cached() {
  local blue=$1 green=$2 workload rule_arn blue_tg green_tg
  for workload in ec2asg ecsec2 ecsfg; do
    IFS='|' read -r rule_arn blue_tg green_tg <<<"${ALB_INFO[$workload]}"
    aws elbv2 modify-rule --rule-arn "$rule_arn" --actions \
      "Type=forward,ForwardConfig={TargetGroups=[{TargetGroupArn=${blue_tg},Weight=${blue}},{TargetGroupArn=${green_tg},Weight=${green}}]}" \
      > /dev/null 2>&1 &
  done
  wait
}

# ─── Rolling demo helpers (additive; existing functions untouched) ────────────

# Returns: "Status|PercentageComplete|StartTime|MinHealthy=N"
# Empty if no refresh history.
fetch_rolling_refresh_status() {
  aws autoscaling describe-instance-refreshes \
    --auto-scaling-group-name bg-rolling-ec2asg \
    --max-records 1 \
    --query 'InstanceRefreshes[0].[Status,PercentageComplete,StartTime,Preferences.MinHealthyPercentage]' \
    --output text 2>/dev/null \
    | awk 'NF { printf "%s|%s|%s|MinHealthy=%s\n", $1, $2, $3, $4 }'
}

# Target health counts for bg-rolling-tg.
# Returns: "healthy|draining|unhealthy"
fetch_rolling_tg_health() {
  local tg_arn
  tg_arn=$(aws elbv2 describe-target-groups --names bg-rolling-tg \
    --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null)
  [ -z "$tg_arn" ] || [ "$tg_arn" = "None" ] && return 1
  aws elbv2 describe-target-health --target-group-arn "$tg_arn" \
    --query 'TargetHealthDescriptions[].TargetHealth.State' --output text 2>/dev/null \
    | tr '\t' '\n' \
    | awk 'BEGIN {h=0; d=0; u=0}
           /^healthy$/  { h++ }
           /^draining$/ { d++ }
           /^unhealthy$/{ u++ }
           END { printf "%d|%d|%d\n", h, d, u }'
}

# 5xx accumulated since given epoch (default: 10 min ago).
# Returns integer.
fetch_rolling_5xx() {
  local since="${1:-$(($(date +%s) - 600))}"
  local now_iso since_iso alb_arn alb_dim
  now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  since_iso=$(date -u -d "@${since}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "${since}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)
  alb_arn=$(aws elbv2 describe-load-balancers --names bg-rolling-alb \
    --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null)
  [ -z "$alb_arn" ] || [ "$alb_arn" = "None" ] && { echo 0; return; }
  alb_dim=$(echo "$alb_arn" | sed -E 's|^.*loadbalancer/||')
  aws cloudwatch get-metric-statistics \
    --namespace AWS/ApplicationELB \
    --metric-name HTTPCode_Target_5XX_Count \
    --dimensions Name=LoadBalancer,Value="$alb_dim" \
    --statistics Sum --period 60 \
    --start-time "$since_iso" --end-time "$now_iso" \
    --query 'sum(Datapoints[].Sum)' --output text 2>/dev/null \
    | awk '{ printf "%d\n", $1 + 0 }'
}

# Subnet ID → "Name" tag (cached). Falls back to subnet ID if no tag.
declare -A _SUBNET_LABEL_CACHE
map_subnet_to_label() {
  local sid="$1"
  if [ -z "${_SUBNET_LABEL_CACHE[$sid]:-}" ]; then
    local label
    label=$(aws ec2 describe-subnets --subnet-ids "$sid" \
      --query 'Subnets[0].Tags[?Key==`Name`].Value | [0]' --output text 2>/dev/null)
    [ -z "$label" ] || [ "$label" = "None" ] && label="$sid"
    _SUBNET_LABEL_CACHE[$sid]="$label"
  fi
  printf '%s' "${_SUBNET_LABEL_CACHE[$sid]}"
}

# v1 → blue, v2 → green.
map_lt_version_to_color() {
  case "$1" in
    v1|1) echo "blue" ;;
    v2|2) echo "green" ;;
    *)    echo "unknown" ;;
  esac
}

# Returns "https://...cloudfront.net" or "(not deployed)".
fetch_rolling_cf_url() {
  local out
  out=$(aws cloudformation describe-stacks --stack-name BgTestRollingCfStack \
    --query 'Stacks[0].Outputs[?ExportName==`BgRollingCfDomain`].OutputValue | [0]' \
    --output text 2>/dev/null)
  if [ -z "$out" ] || [ "$out" = "None" ]; then
    echo "(not deployed)"
  else
    echo "$out"
  fi
}

# Ensure node_modules is installed before running CDK (ts-node needs aws-cdk-lib + @types/node).
# Idempotent: skips if aws-cdk-lib is already present. Returns 1 on install failure.
ensure_npm_deps() {
  local repo_root
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

  if [ -d "${repo_root}/node_modules/aws-cdk-lib" ]; then
    printf "  %b✓%b dependencies present (node_modules/aws-cdk-lib)\n" "$G" "$RESET"
    return 0
  fi

  printf "  %b⚠%b node_modules/aws-cdk-lib not found — running 'npm install'...\n" "$Y" "$RESET"
  if ( cd "$repo_root" && npm install ); then
    printf "  %b✓%b dependencies installed\n" "$G" "$RESET"
    return 0
  else
    printf "  %b✗%b npm install failed — fix and retry\n" "$R" "$RESET"
    return 1
  fi
}

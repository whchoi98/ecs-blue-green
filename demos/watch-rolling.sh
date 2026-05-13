#!/usr/bin/env bash
# Live monitor for Rolling demo — 6 sections, 2s interval.
# Usage: ./demos/watch-rolling.sh [interval_seconds]
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared.sh"

INTERVAL="${1:-2}"
CF_URL="$(fetch_rolling_cf_url)"
[ "$CF_URL" = "(not deployed)" ] && { echo "RollingCfStack not deployed"; exit 1; }

START_EPOCH=$(date +%s)
TOTAL=0
LAST_REDIS_HITS="-"
LAST_DB_PING_MS="-"
declare -a HISTORY=()
SPARK_WIDTH=60

draw_header() {
  clear
  echo
  printf "%b" "$BOLD$W"
  center "BG ROLLING — Live Migration Monitor"
  printf "%b\n" "$RESET"
  hr '=' "$D"
  printf "  %bCF URL%b : %s\n" "$BOLD" "$RESET" "$CF_URL"
  local elapsed=$(( $(date +%s) - START_EPOCH ))
  printf "  %bRuntime%b: %ds   %bTotal%b: %d   %bInterval%b: %ss\n" \
    "$BOLD" "$RESET" "$elapsed" "$BOLD" "$RESET" "$TOTAL" "$BOLD" "$RESET" "$INTERVAL"
  hr '=' "$D"
  echo
}

draw_refresh_progress() {
  printf "  %b%s%b\n" "$BOLD$W" "INSTANCE REFRESH PROGRESS" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"
  local state status pct start_time minhealthy
  state=$(fetch_rolling_refresh_status)
  if [ -z "$state" ]; then
    printf "  %bNo refresh history yet.%b\n\n" "$D" "$RESET"
    return
  fi
  status=$(echo "$state" | cut -d'|' -f1)
  pct=$(echo "$state" | cut -d'|' -f2)
  start_time=$(echo "$state" | cut -d'|' -f3)
  minhealthy=$(echo "$state" | cut -d'|' -f4)
  printf "  Status   : %s\n" "$status"
  printf "  Started  : %s   %s\n" "$start_time" "$minhealthy"
  local bar_w=40
  local filled=$(( ${pct:-0} * bar_w / 100 ))
  printf "  Progress : ["
  printf "%b" "$G"
  for ((i=0; i<filled; i++)); do printf "█"; done
  printf "%b" "$D"
  for ((i=filled; i<bar_w; i++)); do printf "░"; done
  printf "%b] %s%%\n\n" "$RESET" "${pct:-0}"
}

draw_inventory() {
  printf "  %b%s%b\n" "$BOLD$W" "INSTANCE INVENTORY" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"
  local in_count warm_count
  in_count=$(aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names bg-rolling-ec2asg \
    --query 'length(AutoScalingGroups[0].Instances)' --output text 2>/dev/null)
  warm_count=$(aws autoscaling describe-warm-pool \
    --auto-scaling-group-name bg-rolling-ec2asg \
    --query 'length(Instances)' --output text 2>/dev/null)
  printf "  In-Service: %s    Warm Pool: %s\n\n" "${in_count:-0}" "${warm_count:-0}"
}

draw_tg_health() {
  printf "  %b%s%b\n" "$BOLD$W" "ALB TG HEALTH (bg-rolling-tg)" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"
  local h
  h=$(fetch_rolling_tg_health)
  if [ -z "$h" ]; then
    printf "  %bTG not found%b\n\n" "$D" "$RESET"
    return
  fi
  local healthy draining unhealthy
  healthy=$(echo "$h" | cut -d'|' -f1)
  draining=$(echo "$h" | cut -d'|' -f2)
  unhealthy=$(echo "$h" | cut -d'|' -f3)
  printf "  healthy:   %s\n  draining:  %s\n  unhealthy: %s\n\n" "$healthy" "$draining" "$unhealthy"
}

call_one() {
  local resp_info resp_hit ver db redis
  resp_info=$(curl -s --max-time 6 "${CF_URL}/info" 2>/dev/null)
  resp_hit=$(curl -s --max-time 6 "${CF_URL}/redis/hit" 2>/dev/null)

  if echo "$resp_info" | grep -q '"version"'; then
    ver=$(echo "$resp_info" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("version","?"))' 2>/dev/null)
    db=$(echo "$resp_info" | python3 -c 'import sys,json;v=json.load(sys.stdin).get("dbPingMs");print("-" if v is None else v)' 2>/dev/null)
  else
    ver="err"
    db="-"
  fi

  if echo "$resp_hit" | grep -q '"visits"'; then
    redis=$(echo "$resp_hit" | python3 -c 'import sys,json;v=json.load(sys.stdin).get("visits");print("-" if v is None else v)' 2>/dev/null)
  else
    redis="-"
  fi

  LAST_REDIS_HITS="$redis"
  LAST_DB_PING_MS="$db"
  HISTORY+=("$ver")
  [ "${#HISTORY[@]}" -gt "$SPARK_WIDTH" ] && HISTORY=("${HISTORY[@]: -$SPARK_WIDTH}")
  TOTAL=$((TOTAL + 1))
}

draw_recent() {
  printf "  %b%s%b\n" "$BOLD$W" "RECENT CALLS" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"
  printf "  "
  for v in "${HISTORY[@]}"; do
    case "$v" in
      v1) printf "%bv1%b " "$BG_B$W" "$RESET" ;;
      v2) printf "%bv2%b " "$BG_G$W" "$RESET" ;;
      *)  printf "%b?%b " "$BG_R$W" "$RESET" ;;
    esac
  done
  printf "\n\n"
}

draw_data_tier() {
  printf "  %b%s%b\n" "$BOLD$W" "DATA TIER HEALTH" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"

  # Redis — counter-only check (no latency from /info). Counter monotonic = healthy.
  if [ "$LAST_REDIS_HITS" = "-" ]; then
    printf "  Redis (visits counter):  %b[ DOWN     ]%b\n" "$BG_R$W$BOLD" "$RESET"
  else
    printf "  Redis (visits counter):  %b[ OK       ]%b   hits=%s\n" "$BG_G$W$BOLD" "$RESET" "$LAST_REDIS_HITS"
  fi

  # Aurora — dbPingMs latency classification
  if [ "$LAST_DB_PING_MS" = "-" ]; then
    printf "  Aurora (SELECT NOW()):   %b[ DOWN     ]%b\n" "$BG_R$W$BOLD" "$RESET"
  elif [ "$LAST_DB_PING_MS" -gt 500 ] 2>/dev/null; then
    printf "  Aurora (SELECT NOW()):   %b[ DEGRADED ]%b   %sms\n" "$BG_Y$W$BOLD" "$RESET" "$LAST_DB_PING_MS"
  elif [ "$LAST_DB_PING_MS" -gt 0 ] 2>/dev/null; then
    printf "  Aurora (SELECT NOW()):   %b[ OK       ]%b   %sms\n" "$BG_G$W$BOLD" "$RESET" "$LAST_DB_PING_MS"
  else
    printf "  Aurora (SELECT NOW()):   %b[ OK       ]%b   %sms\n" "$BG_G$W$BOLD" "$RESET" "$LAST_DB_PING_MS"
  fi
  echo
}

draw_invariant() {
  printf "  %b%s%b\n" "$BOLD$W" "INVARIANT — ZERO DOWNTIME EVIDENCE" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"
  local fivexx
  fivexx=$(fetch_rolling_5xx "$START_EPOCH")
  if [ "${fivexx:-0}" = "0" ]; then
    printf "  %b✓ HTTP 5xx since watch start: %s%b\n\n" "$G" "$fivexx" "$RESET"
  else
    printf "  %b✗ HTTP 5xx since watch start: %s%b\n\n" "$R" "$fivexx" "$RESET"
  fi
}

trap 'echo; exit 0' INT
while true; do
  call_one
  draw_header
  draw_refresh_progress
  draw_inventory
  draw_tg_health
  draw_data_tier
  draw_recent
  draw_invariant
  sleep "$INTERVAL"
done

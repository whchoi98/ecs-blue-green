#!/usr/bin/env bash
# Realtime Blue/Green traffic monitor — 터미널에서 양 stack 응답을 시각화
# Usage: ./demos/watch-bluegreen-traffic.sh [interval_seconds]
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared.sh"

INTERVAL="${1:-2}"
CF_URL="$(fetch_cf_url 2>/dev/null)"
[ -z "$CF_URL" ] || [ "$CF_URL" = "(not deployed)" ] && { echo "CfStack not deployed"; exit 1; }

# Counters (process local)
declare -A C_HIT C_LAT
TOTAL=0; START_TS=$(date +%s)

call_one() {
  local path="$1"
  local resp t0 t1 ms
  t0=$(date +%s%3N)
  resp=$(curl -s --max-time 6 "${CF_URL}${path}/info" 2>/dev/null)
  t1=$(date +%s%3N)
  ms=$((t1 - t0))
  if [ -n "$resp" ] && echo "$resp" | grep -q '"color"'; then
    local color=$(echo "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("color","?"))' 2>/dev/null)
    local compute=$(echo "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("compute","?"))' 2>/dev/null)
    local host=$(echo "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("hostname","?"))' 2>/dev/null)
    local hits=$(echo "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("redisHits","-"))' 2>/dev/null)
    local dbms=$(echo "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("dbPingMs","-"))' 2>/dev/null)
    local key="${color}/${compute}"
    C_HIT[$key]=$(( ${C_HIT[$key]:-0} + 1 ))
    C_LAT[$key]="$ms"
    echo "$color|$compute|$host|$hits|$dbms|$ms"
  else
    echo "ERR|$path||||"
  fi
}

draw() {
  local weights="$1"
  clear
  echo
  printf "%b" "$BOLD$W"
  center "B L U E   /   G R E E N   ·   T R A F F I C   M O N I T O R"
  printf "%b\n" "$RESET"
  hr '=' "$D"
  printf "  %bCF URL%b  : %s\n" "$BOLD" "$RESET" "$CF_URL"
  printf "  %bWeights%b : %s\n" "$BOLD" "$RESET" "$weights"
  local elapsed=$(( $(date +%s) - START_TS ))
  printf "  %bRuntime%b: %ds   %bTotal calls%b: %d   %bInterval%b: %ss\n" \
    "$BOLD" "$RESET" "$elapsed" "$BOLD" "$RESET" "$TOTAL" "$BOLD" "$RESET" "$INTERVAL"
  hr '=' "$D"
  echo
}

draw_workloads() {
  printf "  %b%s%b\n" "$BOLD$W" "WORKLOAD HITS (this session)" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"
  for compute in ec2-asg ecs-ec2 ecs-fargate; do
    local b="${C_HIT[blue/$compute]:-0}"
    local g="${C_HIT[green/$compute]:-0}"
    local b_lat="${C_LAT[blue/$compute]:-—}"
    local g_lat="${C_LAT[green/$compute]:-—}"
    printf "  %-14s " "$compute"
    printf "%b BLUE %b %3d (%4sms)   " "$BG_B$W$BOLD" "$RESET" "$b" "$b_lat"
    printf "%b GREEN %b %3d (%4sms)\n" "$BG_G$W$BOLD" "$RESET" "$g" "$g_lat"
  done
  echo
}

draw_recent() {
  printf "  %b%s%b\n" "$BOLD$W" "RECENT CALLS" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"
  printf "  %-19s %-7s %-12s %-32s %5s %5s\n" "Time" "Color" "Compute" "Hostname" "Redis" "DBms"
  for line in "${RECENT[@]}"; do
    IFS='|' read -r ts color compute host hits dbms lat <<<"$line"
    local color_bg="$BG_R$W"
    if [ "$color" = "blue" ]; then color_bg="$BG_B$W"; fi
    if [ "$color" = "green" ]; then color_bg="$BG_G$W"; fi
    local short="${host:0:30}"
    printf "  %-19s %b %5s %b %-12s %-32s %5s %5s\n" \
      "$ts" "$color_bg$BOLD" "$color" "$RESET" "$compute" "$short" "$hits" "$dbms"
  done
  echo
}

draw_redis_log() {
  printf "  %b%s%b\n" "$BOLD$W" "REDIS ACTIVITY (counter values per workload)" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"
  local body=$(curl -s --max-time 5 "${CF_URL}/redis/hit" 2>/dev/null)
  if [ -n "$body" ]; then
    local color=$(echo "$body" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("color","?"))' 2>/dev/null)
    local visits=$(echo "$body" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("visits",0))' 2>/dev/null)
    local host=$(echo "$body" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("hostname","?"))' 2>/dev/null 2>&1 || echo "?")
    printf "  Redis INCR  visits:%-7s  →  %b %d %b   served by  %b%s%b\n" \
      "$color" "$BG_M$W$BOLD" "$visits" "$RESET" "$C" "$host" "$RESET"
  fi
  echo
}

draw_aurora_log() {
  printf "  %b%s%b\n" "$BOLD$W" "AURORA QUERY (SELECT NOW)" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"
  local body=$(curl -s --max-time 6 "${CF_URL}/db/ping" 2>/dev/null)
  if [ -n "$body" ]; then
    local nowt=$(echo "$body" | python3 -c 'import sys,json;d=json.load(sys.stdin);r=d.get("rows",[{}])[0];print(r.get("t",""))' 2>/dev/null)
    local h=$(echo "$body" | python3 -c 'import sys,json;d=json.load(sys.stdin);r=d.get("rows",[{}])[0];print(r.get("h",""))' 2>/dev/null)
    local color=$(echo "$body" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("color","?"))' 2>/dev/null)
    printf "  Aurora SELECT NOW()  →  %s   (db host: %b%s%b)\n" "$nowt" "$C" "$h" "$RESET"
    printf "  Served from  %b %s %b\n" "$BG_C$W$BOLD" "$color" "$RESET"
  fi
  echo
}

draw_tg_health() {
  printf "  %b%s%b\n" "$BOLD$W" "TARGET GROUP HEALTH (live AWS API)" "$RESET"
  printf "  %b%s%b\n" "$D" "─────────────────────────────────────────────────────────────" "$RESET"
  for tg_arn in $(aws elbv2 describe-target-groups --query "TargetGroups[?starts_with(TargetGroupName,'BgTest')].TargetGroupArn" --output text 2>/dev/null); do
    local name=$(aws elbv2 describe-target-groups --target-group-arns "$tg_arn" --query "TargetGroups[0].TargetGroupName" --output text 2>/dev/null)
    local healthy=$(aws elbv2 describe-target-health --target-group-arn "$tg_arn" --query "length(TargetHealthDescriptions[?TargetHealth.State=='healthy'])" --output text 2>/dev/null)
    local total=$(aws elbv2 describe-target-health --target-group-arn "$tg_arn" --query "length(TargetHealthDescriptions[])" --output text 2>/dev/null)
    local pct=$(( total > 0 ? healthy * 100 / total : 0 ))
    local bar_color="$G"
    if [ "$pct" -lt 50 ]; then bar_color="$R"; elif [ "$pct" -lt 100 ]; then bar_color="$Y"; fi
    printf "  %-30s  %b%2d/%2d%b  " "$name" "$bar_color$BOLD" "$healthy" "$total" "$RESET"
    local bar_len=$(( pct / 5 ))
    printf "%b" "$bar_color"
    for ((i=0; i<bar_len; i++)); do printf "█"; done
    printf "%b" "$D"
    for ((i=bar_len; i<20; i++)); do printf "░"; done
    printf "%b\n" "$RESET"
  done
  echo
}

# Main loop
RECENT=()
trap 'echo; printf "%bExiting...%b\n" "$D" "$RESET"; exit 0' INT
while true; do
  weights="$(fetch_active_weights 2>/dev/null)"
  results=()
  for path in "/ec2-asg" "/ecs-ec2" "/ecs-fg"; do
    line=$(call_one "$path")
    TOTAL=$((TOTAL + 1))
    ts=$(date +%H:%M:%S.%3N)
    IFS='|' read -r color compute host hits dbms ms <<<"$line"
    RECENT=("$ts|$color|$compute|$host|$hits|$dbms|$ms" "${RECENT[@]}")
    [ "${#RECENT[@]}" -gt 12 ] && RECENT=("${RECENT[@]:0:12}")
  done
  draw "$weights"
  draw_workloads
  draw_recent
  draw_redis_log
  draw_aurora_log
  draw_tg_health
  printf "  %b(Ctrl+C to stop)  Refreshing every %ss%b\n" "$D" "$INTERVAL" "$RESET"
  sleep "$INTERVAL"
done

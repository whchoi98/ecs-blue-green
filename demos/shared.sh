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

fetch_active_color() {
  aws cloudformation describe-stacks --stack-name BgTestCfStack \
    --query "Stacks[0].Outputs[?OutputKey=='ActiveColor'].OutputValue" --output text 2>/dev/null \
    || echo "(not deployed)"
}

fetch_cf_url() {
  aws cloudformation describe-stacks --stack-name BgTestCfStack \
    --query "Stacks[0].Outputs[?OutputKey=='CfDomain'].OutputValue" --output text 2>/dev/null \
    || echo "(not deployed)"
}

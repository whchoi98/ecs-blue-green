#!/usr/bin/env bash
# Interactive Blue/Green weighted-ratio slider — TUI for live demos.
# Auto-applies each change to all 3 ALBs immediately, so the watch monitor
# (in a separate terminal) reacts in real time.
#
# Keys:
#   ← →     ±5%   (or ↑ ↓)
#   + -     ±1%
#   0       jump to Blue 100 / Green 0
#   m       jump to 50 / 50
#   g       jump to Blue 0 / Green 100
#   r       refresh display from current ALB state
#   q / Esc quit (last applied weights remain)

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared.sh"

if ! discover_alb_arns; then
  printf "%bALB resources not found.%b Is BgTestAlbStack deployed?\n" "$R" "$RESET" >&2
  exit 1
fi

# Initialize Green % from current ALB state. Parse "Blue NN / Green NN".
init_str=$(fetch_active_weights)
GREEN=$(echo "$init_str" | sed -nE 's/.*Green[[:space:]]+([0-9]+).*/\1/p')
[[ "$GREEN" =~ ^[0-9]+$ ]] || GREEN=0
[ "$GREEN" -gt 100 ] && GREEN=100
APPLIED_GREEN=$GREEN

BAR_WIDTH=48

clamp() {
  if [ "$GREEN" -lt 0   ]; then GREEN=0;   fi
  if [ "$GREEN" -gt 100 ]; then GREEN=100; fi
}

apply_now() {
  local blue=$((100 - GREEN))
  apply_weights_cached "$blue" "$GREEN"
  APPLIED_GREEN=$GREEN
}

draw() {
  local blue=$((100 - GREEN))
  local bw=$((blue * BAR_WIDTH / 100))
  local gw=$((BAR_WIDTH - bw))

  clear
  echo
  printf "%b" "$BOLD$W"
  center "B L U E   /   G R E E N   ·   I N T E R A C T I V E   S L I D E R"
  printf "%b\n" "$RESET"
  hr '=' "$D"
  echo

  # The visual: BLUE label · colored bar · GREEN label
  printf "  %bBLUE%b  %b%3d%%%b  " "$B$BOLD" "$RESET" "$B$BOLD" "$blue" "$RESET"
  printf "%b" "$BG_B$W"
  for ((i=0; i<bw; i++)); do printf " "; done
  printf "%b" "$BG_G$W"
  for ((i=0; i<gw; i++)); do printf " "; done
  printf "%b  %b%3d%%%b  %bGREEN%b\n" "$RESET" "$G$BOLD" "$GREEN" "$RESET" "$G$BOLD" "$RESET"

  echo
  if [ "$GREEN" -eq "$APPLIED_GREEN" ]; then
    printf "  %b✓ applied%b   ALB rules synced (Blue %d%% / Green %d%%)\n" \
      "$G$BOLD" "$RESET" "$blue" "$GREEN"
  else
    printf "  %b• pending%b   target Blue %d / Green %d  →  applying...\n" \
      "$Y$BOLD" "$RESET" "$blue" "$GREEN"
  fi

  echo
  hr '-' "$D"
  printf "  %bKeys%b   " "$BOLD" "$RESET"
  printf "%b←/→%b ±5    %b+/-%b ±1    %b0/m/g%b 0·50·100    %br%b refresh    %bq%b quit\n" \
    "$C" "$RESET" "$C" "$RESET" "$C" "$RESET" "$C" "$RESET" "$C" "$RESET"
  hr '-' "$D"
  echo
}

cleanup() {
  echo
  printf "  %bExited slider — last applied: Blue %d%% / Green %d%%%b\n" \
    "$D" "$((100 - APPLIED_GREEN))" "$APPLIED_GREEN" "$RESET"
  echo
  exit 0
}
trap cleanup INT

draw

while true; do
  IFS= read -rsn1 c
  case "$c" in
    $'\e')
      # Escape sequence — could be arrow key (\e[X) or bare Esc.
      read -rsn2 -t 0.05 rest || rest=""
      case "$rest" in
        '[A'|'[C') GREEN=$((GREEN + 5)); clamp; apply_now ;;  # up / right
        '[B'|'[D') GREEN=$((GREEN - 5)); clamp; apply_now ;;  # down / left
        '')         cleanup ;;                                  # bare Esc → quit
      esac
      ;;
    '+'|'=')   GREEN=$((GREEN + 1)); clamp; apply_now ;;
    '-'|'_')   GREEN=$((GREEN - 1)); clamp; apply_now ;;
    '0')       GREEN=0;   apply_now ;;
    'm'|'M')   GREEN=50;  apply_now ;;
    'g'|'G')   GREEN=100; apply_now ;;
    'r'|'R')
      # Re-read ALB state in case it was changed elsewhere
      init_str=$(fetch_active_weights)
      GREEN=$(echo "$init_str" | sed -nE 's/.*Green[[:space:]]+([0-9]+).*/\1/p')
      [[ "$GREEN" =~ ^[0-9]+$ ]] || GREEN=0
      APPLIED_GREEN=$GREEN
      ;;
    'q'|'Q')   cleanup ;;
  esac
  draw
done

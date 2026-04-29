#!/usr/bin/env bash
# Auto-progressive Blue→Green canary using ALB weighted forward.
# Walks through fixed stages with a configurable interval, applying each
# weight to all 3 ALBs in lock-step.
#
# Usage:
#   ./scenario-progressive-shift.sh           # 30s per stage (default)
#   ./scenario-progressive-shift.sh 15        # 15s per stage (faster demo)
#   ./scenario-progressive-shift.sh 60        # 60s per stage (more time to observe)
#
# Stages (Green %): 0 → 10 → 25 → 50 → 75 → 90 → 100
# Total time = 6 × INTERVAL seconds (first stage is immediate).

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared.sh"

INTERVAL="${1:-30}"
if ! [[ "$INTERVAL" =~ ^[0-9]+$ ]] || [ "$INTERVAL" -lt 1 ]; then
  printf "%bError: interval must be a positive integer (seconds)%b\n" "$R" "$RESET" >&2
  exit 1
fi

STAGES=(0 10 25 50 75 90 100)
TOTAL_SECS=$(( (${#STAGES[@]} - 1) * INTERVAL ))

if ! discover_alb_arns; then
  printf "%bALB resources not found.%b Is BgTestAlbStack deployed?\n" "$R" "$RESET" >&2
  exit 1
fi

clear
echo
hr '=' "$W$BOLD"
center "P R O G R E S S I V E   C A N A R Y   ·   B L U E   →   G R E E N"
hr '=' "$W$BOLD"
echo
typewrite "${#STAGES[@]} stages × ${INTERVAL}s = ~${TOTAL_SECS}s total. Ctrl+C to abort." 0.01
echo; echo

label_for() {
  local g=$1
  if   [ "$g" -eq 0   ];   then echo "🔵 baseline"
  elif [ "$g" -le 25  ];   then echo "🐤 canary"
  elif [ "$g" -lt 75  ];   then echo "⚖️  split"
  elif [ "$g" -lt 100 ];   then echo "🚀 mostly green"
  else                          echo "🟢 full green"
  fi
}

trap 'echo; printf "\n%b⏸  Aborted at Green %d%% — last applied weights remain.%b\n" "$Y" "$GREEN" "$RESET"; exit 130' INT

for i in "${!STAGES[@]}"; do
  GREEN=${STAGES[$i]}
  blue=$((100 - GREEN))
  apply_weights_cached "$blue" "$GREEN"

  printf "  %b[%d/%d]%b  Blue %b%3d%%%b  Green %b%3d%%%b   %s\n" \
    "$BOLD" "$((i+1))" "${#STAGES[@]}" "$RESET" \
    "$B$BOLD" "$blue" "$RESET" \
    "$G$BOLD" "$GREEN" "$RESET" \
    "$(label_for "$GREEN")"

  if [ "$i" -lt "$((${#STAGES[@]} - 1))" ]; then
    sleep "$INTERVAL"
  fi
done

echo
hr '=' "$G$BOLD"
center "🎉  PROGRESSIVE SHIFT COMPLETE  ·  Blue 0% / Green 100%"
hr '=' "$G$BOLD"
echo
printf "  %bMonitor:%b   ./demos/watch-bluegreen-traffic.sh   (별도 터미널)\n" "$BOLD" "$RESET"
printf "  %bRollback:%b  ./demos/scenario4-rollback-to-blue.sh\n" "$BOLD" "$RESET"
echo

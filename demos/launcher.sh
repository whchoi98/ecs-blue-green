#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared.sh"

draw_menu() {
  clear
  echo
  printf '%b' "$B$BOLD"
  cat <<'LOGO'
   ██████╗  ██████╗     ████████╗███████╗███████╗████████╗
   ██╔══██╗██╔════╝     ╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝
   ██████╔╝██║  ███╗       ██║   █████╗  ███████╗   ██║
   ██╔══██╗██║   ██║       ██║   ██╔══╝  ╚════██║   ██║
   ██████╔╝╚██████╔╝       ██║   ███████╗███████║   ██║
   ╚═════╝  ╚═════╝        ╚═╝   ╚══════╝╚══════╝   ╚═╝
LOGO
  printf '%b' "$RESET"
  echo
  center "B L U E   /   G R E E N   T E S T"
  echo

  local weights cf
  weights=$(fetch_active_weights)
  cf=$(fetch_cf_url)

  hr '=' "$W$BOLD"
  printf "  %bCF URL%b  : %s\n" "$BOLD" "$RESET" "$cf"
  printf "  %bWeights%b : %s\n" "$BOLD" "$RESET" "$weights"
  hr '=' "$W$BOLD"
  echo

  printf '  %bPhase 1 — Deploy%b\n' "$D$BOLD" "$RESET"
  printf '  %b%b [1] %b  %bDeploy Blue Infrastructure%b\n' "$BOLD" "$BG_B$W" "$RESET" "$W$BOLD" "$RESET"
  printf '  %b%b [2] %b  %bAdd VPC Secondary CIDR (demo)%b   %b10.2.0.0/16 association — no resources%b\n' "$BOLD" "$BG_C$W" "$RESET" "$W$BOLD" "$RESET" "$D" "$RESET"
  echo
  printf '  %bPhase 2 — Traffic Control (ALB Weighted)%b\n' "$D$BOLD" "$RESET"
  printf '  %b%b [3] %b  %bShift Traffic (exact %%)%b         %b./scenario3-shift-traffic.sh <green_pct>%b\n' "$BOLD" "$BG_G$W" "$RESET" "$W$BOLD" "$RESET" "$D" "$RESET"
  printf '  %b%b [4] %b  %bProgressive Auto-Shift%b           %b0→10→25→50→75→90→100, fixed cadence%b\n' "$BOLD" "$BG_M$W" "$RESET" "$W$BOLD" "$RESET" "$D" "$RESET"
  printf '  %b%b [5] %b  %bInteractive Slider (TUI)%b         %b←/→ ±5, +/- ±1, 0/m/g jump%b\n' "$BOLD" "$BG_C$W" "$RESET" "$W$BOLD" "$RESET" "$D" "$RESET"
  printf '  %b%b [6] %b  %bRollback to Blue%b                 %b(weight 100/0)%b\n' "$BOLD" "$BG_Y$W" "$RESET" "$W$BOLD" "$RESET" "$D" "$RESET"
  echo
  printf '  %bObservability%b\n' "$D$BOLD" "$RESET"
  printf '  %b%b [7] %b  %bWatch Traffic Monitor%b            %b(별도 터미널 권장)%b\n' "$BOLD" "$BG_D$W" "$RESET" "$W$BOLD" "$RESET" "$D" "$RESET"
  echo
  printf '  %b [q] %b  Quit\n' "$BG_R$W$BOLD" "$RESET"
  echo
  hr '=' "$W$BOLD"
  echo
}

run_scenario() {
  local script="$1"
  echo
  bash "$SCRIPT_DIR/$script"
  echo
  echo -ne "  ${D}Press Enter to return to menu...${RESET}"
  read -r
}

trap 'echo; exit 0' INT
while true; do
  draw_menu
  printf '  %bSelect [1-7, q]: %b ' "$W$BOLD" "$RESET"
  read -r choice
  case "$choice" in
    1) run_scenario "scenario1-deploy-blue.sh" ;;
    2) run_scenario "scenario2-add-secondary-cidr.sh" ;;
    3) run_scenario "scenario3-shift-traffic.sh" ;;
    4) run_scenario "scenario-progressive-shift.sh" ;;
    5) run_scenario "scenario-slider.sh" ;;
    6) run_scenario "scenario4-rollback-to-blue.sh" ;;
    7) run_scenario "watch-bluegreen-traffic.sh" ;;
    q|Q) echo; exit 0 ;;
    *) echo "Invalid"; sleep 1 ;;
  esac
done

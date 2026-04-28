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

  local active cf
  active=$(fetch_active_color)
  cf=$(fetch_cf_url)

  hr '=' "$W$BOLD"
  printf "  %bCF URL%b : %s\n" "$BOLD" "$RESET" "$cf"
  printf "  %bActive%b : %s\n" "$BOLD" "$RESET" "$active"
  hr '=' "$W$BOLD"
  echo

  printf '  %b%b [1] %b  %bDeploy Blue Infrastructure%b      %bPhase 1%b\n' "$BOLD" "$BG_B$W" "$RESET" "$W$BOLD" "$RESET" "$D" "$RESET"
  printf '  %b%b [2] %b  %bAdd VPC Secondary CIDR%b          %bPhase 1%b\n' "$BOLD" "$BG_C$W" "$RESET" "$W$BOLD" "$RESET" "$D" "$RESET"
  printf '  %b%b [3] %b  %bDeploy Green & Switch%b           %b(Phase 2 - 추후)%b\n' "$BOLD" "$BG_G$W" "$RESET" "$D" "$RESET" "$D" "$RESET"
  printf '  %b%b [4] %b  %bRollback to Blue%b                %b(Phase 2 - 추후)%b\n' "$BOLD" "$BG_Y$W" "$RESET" "$D" "$RESET" "$D" "$RESET"
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
  printf '  %bSelect [1-4, q]: %b ' "$W$BOLD" "$RESET"
  read -r choice
  case "$choice" in
    1) run_scenario "scenario1-deploy-blue.sh" ;;
    2) run_scenario "scenario2-add-secondary-cidr.sh" ;;
    3) echo "Phase 2 — 추후 구현"; sleep 2 ;;
    4) echo "Phase 2 — 추후 구현"; sleep 2 ;;
    q|Q) echo; exit 0 ;;
    *) echo "Invalid"; sleep 1 ;;
  esac
done

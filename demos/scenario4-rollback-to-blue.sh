#!/usr/bin/env bash
# Rollback to 100% Blue traffic (Green weight = 0).
# Convenience wrapper around scenario3-shift-traffic.sh 0
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/shared.sh"

clear
echo
printf '%b' "$BG_B$W$BOLD"
center " R O L L B A C K   T O   B L U E "
printf '%b\n' "$RESET"
echo
typewrite "Reverting all 3 ALB rules to Blue 100% / Green 0%..." 0.015
echo; echo

exec "$SCRIPT_DIR/scenario3-shift-traffic.sh" 0

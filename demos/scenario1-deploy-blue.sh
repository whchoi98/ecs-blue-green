#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/shared.sh"

cd "$ROOT_DIR"

# ── Banner ──
clear
echo
printf '%b' "$B$BOLD"
center "SCENARIO 1: Deploy Blue Infrastructure"
printf '%b' "$RESET"
echo
hr '=' "$W$BOLD"
echo
printf "  %bAccount%b : %s\n" "$BOLD" "$RESET" "$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo unknown)"
printf "  %bRegion%b  : %s\n" "$BOLD" "$RESET" "${AWS_REGION:-ap-northeast-2}"
echo
pause_key

# ── STEP 1/5: Pre-flight ──
print_step 1 5 "Pre-flight Check"
typewrite "AWS account / region / CDK / Docker 사전 확인" 0.01
echo; echo
aws sts get-caller-identity > /dev/null && echo "  ${G}[OK]${RESET} AWS credentials"
command -v docker > /dev/null && echo "  ${G}[OK]${RESET} docker"
npx --yes cdk --version > /dev/null && echo "  ${G}[OK]${RESET} cdk"

CF_PL=$(aws ec2 describe-managed-prefix-lists \
  --filters "Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing" \
  --query "PrefixLists[0].PrefixListId" --output text 2>/dev/null)
echo "  ${G}[OK]${RESET} CloudFront prefix list: $CF_PL"
pause_key

# ── STEP 2/5: CDK Bootstrap ──
print_step 2 5 "CDK Bootstrap (idempotent)"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION="${AWS_REGION:-ap-northeast-2}"
typewrite "npx cdk bootstrap aws://${ACCOUNT}/${REGION}" 0.01
echo
npx cdk bootstrap "aws://${ACCOUNT}/${REGION}"
pause_key

# ── STEP 3/5: Deploy Foundation (Network + Ecr) ──
print_step 3 5 "Deploy Foundation (Network + Ecr)"
cdk_deploy "BgTestNetworkStack BgTestEcrStack" "--context cloudFrontPrefixListId=${CF_PL}"
pause_key

# ── STEP 4/5: Build & Push App Image (Blue) ──
print_step 4 5 "Build & Push App Image (Blue)"
anim_bar 10 "$C" "Docker build starting"
"$ROOT_DIR/scripts/build-and-push.sh" blue
anim_bar 100 "$G" "Image pushed"
pause_key

# ── STEP 5/5: Deploy Data + Cluster + Blue + Cf ──
print_step 5 5 "Deploy Data + Cluster + Blue + CloudFront"
cdk_deploy "BgTestDataStack BgTestClusterStack BgTestBlueStack BgTestCfStack" "--context cloudFrontPrefixListId=${CF_PL}"

CF_URL=$(fetch_cf_url)
echo
hr '=' "$G$BOLD"
echo
printf "  %b✓ DEPLOYMENT COMPLETE%b\n" "$G$BOLD" "$RESET"
printf "  %bCF URL%b: %s\n" "$BOLD" "$RESET" "$CF_URL"
echo

echo "  ${C}— Smoke tests —${RESET}"
for path in "/ec2-asg/info" "/ecs-ec2/info" "/ecs-fg/info"; do
  echo "  curl ${CF_URL}${path}"
  curl -s --max-time 10 "${CF_URL}${path}" || echo "  (CloudFront still propagating, retry in ~3 min)"
  echo
done
echo
hr '=' "$G$BOLD"

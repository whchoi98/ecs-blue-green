#!/usr/bin/env bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/shared.sh"

cd "$ROOT_DIR"

# ── Banner ──
clear
echo
printf '%b' "$C$BOLD"
center "SCENARIO 2: VPC Secondary CIDR (demo) + private-2 /22 carve-out"
printf '%b' "$RESET"
echo
hr '=' "$W$BOLD"
echo
typewrite "Phase 1 마지막 단계: Green 마이그레이션 자리를 *primary CIDR*에 만들고," 0.01
echo
typewrite "동시에 'secondary CIDR을 VPC에 추가'하는 *행위*도 시연합니다 (자원은 안 들어감)." 0.01
echo; echo
pause_key

# ── STEP 1/4: 현재 VPC 상태 ──
print_step 1 4 "현재 VPC 상태 출력"
VPC_ID=$(aws cloudformation describe-stacks --stack-name BgTestNetworkStack \
  --query "Stacks[0].Outputs[?OutputKey=='VpcId'].OutputValue" --output text 2>/dev/null \
  || aws ec2 describe-vpcs --filters "Name=tag:Name,Values=test-vpc" --query "Vpcs[0].VpcId" --output text)

echo "  VPC ID: ${VPC_ID}"
echo
echo "  ${C}현재 CIDR blocks:${RESET}"
aws ec2 describe-vpcs --vpc-ids "$VPC_ID" \
  --query "Vpcs[0].CidrBlockAssociationSet[].[CidrBlock,CidrBlockState.State]" \
  --output table
echo
echo "  ${C}private-1 서브넷의 사용 가능 IP (Blue compute가 거주 중):${RESET}"
aws ec2 describe-subnets --filters "Name=vpc-id,Values=${VPC_ID}" "Name=tag:aws-cdk:subnet-name,Values=private1" \
  --query "Subnets[].[SubnetId,CidrBlock,AvailableIpAddressCount,AvailabilityZone]" --output table
pause_key

# ── STEP 2/4: Secondary CIDR + private-2 carve-out 동시 시연 ──
print_step 2 4 "두 가지를 한 번에 시연 — (a) secondary CIDR 추가  (b) primary CIDR 안에 /22 carve-out"
echo
echo "  ${D}배경:${RESET} 운영에서 IP 부족이 오면 두 가지 선택지가 있습니다:"
printf "    %b1.%b VPC에 secondary CIDR association 추가 — 미래 확장 자산\n" "$C" "$RESET"
printf "    %b2.%b primary CIDR 내 free space에 새 /22 carving — 즉시 배포 가능\n" "$C" "$RESET"
echo "  ${D}이 데모는 (1)은 *시연용 행위*로만 보여주고, 실제 Green 배포는 (2)에 합니다.${RESET}"
echo
typewrite "cdk deploy BgTestNetworkStack --context includeSecondaryCidr=true" 0.01
echo; echo
cdk_deploy "BgTestNetworkStack" "--context includeSecondaryCidr=true"
pause_key

# ── STEP 3/4: 새 상태 검증 ──
print_step 3 4 "변경 후 검증 — secondary CIDR 추가 + private-2 서브넷 생성"
echo "  ${C}변경 후 CIDR blocks (10.2.0.0/16 association이 추가됨):${RESET}"
aws ec2 describe-vpcs --vpc-ids "$VPC_ID" \
  --query "Vpcs[0].CidrBlockAssociationSet[].[CidrBlock,CidrBlockState.State]" --output table
echo
echo "  ${C}private-2 서브넷 (primary CIDR 안의 새 /22 — Green 배포 자리):${RESET}"
aws ec2 describe-subnets --filters "Name=vpc-id,Values=${VPC_ID}" "Name=tag:Name,Values=bg-private2-*" \
  --query "Subnets[].[Tags[?Key=='Name']|[0].Value,CidrBlock,AvailableIpAddressCount,AvailabilityZone]" --output table
echo
echo "  ${D}10.2.0.0/16에는 서브넷이 없습니다 — 미래 확장을 위한 빈 association입니다.${RESET}"
pause_key

# ── STEP 4/4: 요약 ──
print_step 4 4 "변경 요약"
hr '=' "$G$BOLD"
echo
printf "  %b✓ VPC secondary CIDR 10.2.0.0/16 added%b   %b(데모용 — 자원 없음)%b\n" "$G$BOLD" "$RESET" "$D" "$RESET"
printf "  %b✓ private-2-a (10.1.8.0/22) created%b      %b(primary CIDR 안)%b\n" "$G$BOLD" "$RESET" "$D" "$RESET"
printf "  %b✓ private-2-b (10.1.12.0/22) created%b     %b(primary CIDR 안)%b\n" "$G$BOLD" "$RESET" "$D" "$RESET"
echo
printf "  %b다음 단계 (Phase 2): Green stack을 위 두 /22에 배포 → ALB weighted로 점진 전환%b\n" "$D" "$RESET"
echo
hr '=' "$G$BOLD"

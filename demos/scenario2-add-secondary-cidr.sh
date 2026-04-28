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
center "SCENARIO 2: Add VPC Secondary CIDR + private-2 subnets"
printf '%b' "$RESET"
echo
hr '=' "$W$BOLD"
echo
typewrite "초기 /24 서브넷의 IP 부족을 secondary CIDR (10.2.0.0/16) 추가로 해결" 0.01
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
echo "  ${C}private-1 서브넷의 사용 가능 IP:${RESET}"
aws ec2 describe-subnets --filters "Name=vpc-id,Values=${VPC_ID}" "Name=tag:aws-cdk:subnet-name,Values=private1" \
  --query "Subnets[].[SubnetId,CidrBlock,AvailableIpAddressCount,AvailabilityZone]" --output table
pause_key

# ── STEP 2/4: Secondary CIDR 추가 ──
print_step 2 4 "Secondary CIDR 추가 + private-2 서브넷 생성"
typewrite "cdk deploy BgTestNetworkStack --context includeSecondaryCidr=true" 0.01
echo; echo
cdk_deploy "BgTestNetworkStack" "--context includeSecondaryCidr=true"
pause_key

# ── STEP 3/4: 새 서브넷 정상성 검증 ──
print_step 3 4 "새 서브넷 정상성 검증"
echo "  ${C}변경 후 CIDR blocks:${RESET}"
aws ec2 describe-vpcs --vpc-ids "$VPC_ID" \
  --query "Vpcs[0].CidrBlockAssociationSet[].[CidrBlock,CidrBlockState.State]" --output table
echo
echo "  ${C}private-2 서브넷:${RESET}"
aws ec2 describe-subnets --filters "Name=vpc-id,Values=${VPC_ID}" "Name=cidr-block,Values=10.2.0.0/22,10.2.4.0/22" \
  --query "Subnets[].[SubnetId,CidrBlock,AvailableIpAddressCount,AvailabilityZone]" --output table
echo
echo "  ${C}라우팅 테이블 NAT 연결 확인:${RESET}"
aws ec2 describe-route-tables --filters "Name=vpc-id,Values=${VPC_ID}" \
  --query "RouteTables[?Routes[?contains(@.DestinationCidrBlock || \`\`, '10.2')]].[RouteTableId,Tags[?Key=='Name']|[0].Value]" \
  --output table
pause_key

# ── STEP 4/4: 요약 ──
print_step 4 4 "변경 요약"
hr '=' "$G$BOLD"
echo
printf "  %b✓ Secondary CIDR 10.2.0.0/16 added%b\n" "$G$BOLD" "$RESET"
printf "  %b✓ private-2-a (10.2.0.0/22) created%b\n" "$G$BOLD" "$RESET"
printf "  %b✓ private-2-b (10.2.4.0/22) created%b\n" "$G$BOLD" "$RESET"
echo
printf "  %b다음 단계 (Phase 2): Green stack을 private-2 서브넷에 배포 → CF origin 전환%b\n" "$D" "$RESET"
echo
hr '=' "$G$BOLD"

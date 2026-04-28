#!/usr/bin/env bash
set -euo pipefail
COLOR="${1:-blue}"
REGION="${AWS_REGION:-ap-northeast-2}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ECR_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/bg-app"

echo "[build-and-push] color=${COLOR} region=${REGION} ecr=${ECR_URI}"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

docker buildx build --platform linux/arm64 --load \
  -t "bg-app:${COLOR}" \
  -f app/Dockerfile app/

docker tag "bg-app:${COLOR}" "${ECR_URI}:${COLOR}"
docker push "${ECR_URI}:${COLOR}"

echo "[build-and-push] pushed ${ECR_URI}:${COLOR}"

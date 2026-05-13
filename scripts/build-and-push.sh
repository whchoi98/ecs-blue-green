#!/usr/bin/env bash
set -euo pipefail
TAG="${1:-blue}"
REGION="${AWS_REGION:-ap-northeast-2}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ECR_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/bg-app"

echo "[build-and-push] tag=${TAG} region=${REGION} ecr=${ECR_URI}"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

docker buildx build --platform linux/arm64 --load \
  -t "bg-app:${TAG}" \
  -f app/Dockerfile app/

docker tag "bg-app:${TAG}" "${ECR_URI}:${TAG}"
docker push "${ECR_URI}:${TAG}"

echo "[build-and-push] pushed ${ECR_URI}:${TAG}"

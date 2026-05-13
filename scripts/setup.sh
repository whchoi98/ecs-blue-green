#!/bin/bash
# Project setup script for new developers.
# Usage: bash scripts/setup.sh
# Safe to run multiple times (idempotent).

set -e

echo "=== ecs-blue-green Project Setup ==="

# Check prerequisites
command -v git >/dev/null 2>&1 || { echo "ERROR: git is required"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js 20+ is required (https://nodejs.org)"; exit 1; }
command -v aws >/dev/null 2>&1 || { echo "WARNING: AWS CLI not found. Install for deployment."; }
command -v docker >/dev/null 2>&1 || { echo "WARNING: Docker not found. Install for ARM64 image builds."; }

# Install Node.js dependencies
echo "Installing Node.js dependencies..."
npm install

# Setup environment file
if [ -f ".env.example" ] && [ ! -f ".env" ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "IMPORTANT: Review .env and set any required values."
fi

# Make Claude hooks executable
if [ -d ".claude/hooks" ]; then
    chmod +x .claude/hooks/*.sh
    echo "Claude hooks configured (.claude/hooks/)"
fi

# Make demo and script files executable
if [ -d "demos" ]; then
    chmod +x demos/*.sh 2>/dev/null || true
    echo "Demo scripts made executable (demos/)"
fi
if [ -d "scripts" ]; then
    chmod +x scripts/*.sh 2>/dev/null || true
fi

# Install Git hooks
if [ -d ".git" ] && [ -f "scripts/install-hooks.sh" ]; then
    bash scripts/install-hooks.sh
fi

echo ""
echo "=== Setup Complete ==="
echo "Next steps:"
echo "  1. Run 'npm test' to verify CDK stack synthesis"
echo "  2. Set up AWS credentials: aws configure"
echo "  3. Bootstrap CDK: npx cdk bootstrap aws://ACCOUNT_ID/ap-northeast-2"
echo "  4. Read CLAUDE.md for project conventions"
echo "  5. Read docs/onboarding.md for development workflow"
echo "  6. Launch demo: ./demos/launcher.sh"

# scripts/ Module — Operational Scripts

## Role

One-off operational scripts for developers: Docker image build/push, project setup, and Git hook installation. Not used during demos — see `demos/` for demo scripts.

## Key Files

| File | Purpose |
|------|---------|
| `build-and-push.sh` | Build ARM64 Docker image and push to ECR (`bg-app:<tag>`) |
| `setup.sh` | New developer setup: `npm install`, `.env` creation, hook installation |
| `install-hooks.sh` | Install `.git/hooks/commit-msg` to strip `Co-Authored-By:` lines |

## Rules

- All scripts must include `set -e` and usage comments at the top.
- `build-and-push.sh` must use `docker buildx build --platform linux/arm64` — no x86 images.
- `build-and-push.sh` requires `AWS_REGION=ap-northeast-2` and valid ECR login.
- `setup.sh` must be idempotent — safe to run multiple times without breaking existing state.
- `install-hooks.sh` must install the `commit-msg` hook that strips `Co-Authored-By:` lines — critical for maintaining clean git attribution per `CLAUDE.md`.
- All scripts must be executable (`chmod +x`) and pass `bash -n` syntax check.
- Do not add deployment scripts here — deployment is via `npx cdk deploy` (see `demos/`).

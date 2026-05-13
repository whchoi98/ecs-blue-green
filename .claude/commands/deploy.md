---
description: Build and deploy CDK stacks to ap-northeast-2 following project runbooks
allowed-tools: Read, Bash(npm run build:*), Bash(npx cdk synth:*), Bash(npx cdk diff:*), Bash(npx cdk deploy:*), Glob
---

# Deploy

Build and deploy the CDK application to AWS ap-northeast-2.

## Step 1: Pre-Deploy Checks

1. Verify working tree is clean: `git status`
2. Verify current branch (warn if not main)
3. Run tests to ensure nothing is broken: `npm test`
4. Check if a deployment runbook exists: `ls docs/runbooks/deploy-*.md`

## Step 2: Build and Synthesize

```bash
# TypeScript compile
npm run build

# Synthesize (dry run — no AWS calls)
npx cdk synth

# Show diff against deployed stacks
npx cdk diff
```

## Step 3: Deploy

```bash
# Deploy all stacks (requires AWS credentials for ap-northeast-2)
npx cdk deploy --all

# Deploy with context flags
npx cdk deploy --all --context includeGreen=true
npx cdk deploy --all --context includeRolling=true
```

## Step 4: Verify

After deployment:
- Check CloudFormation stack status in AWS console (ap-northeast-2)
- Run `./demos/watch-bluegreen-traffic.sh` to verify ALB routing
- Check `GET /health` on CloudFront distribution URL

## Step 5: Summary

Display:
- Which stacks were deployed
- CloudFront distribution URL (from BgTestCfStack CfnOutput)
- ALB DNS names (from BgTestAlbStack CfnOutputs)
- Suggest creating a deployment runbook if none exists in `docs/runbooks/`

## Error Recovery

### If CDK bootstrap is needed
```bash
npx cdk bootstrap aws://ACCOUNT_ID/ap-northeast-2
```

### If deployment fails
Check CloudFormation console for rollback details:
- `aws cloudformation describe-stack-events --stack-name <name> --region ap-northeast-2`

### If ALB weights need immediate rollback
```bash
./demos/scenario4-rollback-to-blue.sh
```

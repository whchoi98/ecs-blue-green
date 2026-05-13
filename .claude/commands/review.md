---
description: Run code review on current changes with confidence-based filtering
allowed-tools: Read, Glob, Grep, Bash(git diff:*), Bash(git log:*)
---

# Code Review

Review the current code changes using confidence-based scoring.

## Step 1: Get Changes

Determine the scope of review:

- If $ARGUMENTS specifies files, review those files
- Otherwise, review unstaged changes: `git diff`
- If no unstaged changes, review staged changes: `git diff --cached`

## Step 2: Review

For each changed file, apply the code-review skill criteria:
- Project guidelines compliance (from CLAUDE.md: BgTest naming, context flags, ARM64 types)
- Bug detection (CDK circular deps, missing RemovalPolicy, overly permissive SGs)
- Code quality (Blue/Green duplication, missing CfnOutputs, jest coverage)

## Step 3: Score and Filter

Rate each issue 0-100. Only report issues with confidence >= 75.

## Step 4: Output

Present findings in structured format with file paths, line numbers, and fix suggestions.
If no high-confidence issues, confirm code meets standards.

## Error Recovery

### If no changes found (Step 1)
No diff output means nothing to review. Inform the user:
- Check if changes are committed: `git log -1 --oneline`
- Check if on the right branch: `git branch --show-current`
- Suggest specifying files directly: `/review lib/compute-stack.ts`

### If diff is too large (>500 lines)
Focus on high-risk files first:
1. Files touching ALB weights or security groups (security-sensitive)
2. Files with CDK construct changes (infrastructure risk)
3. Demo script changes (lower priority)

---
description: Execute the full test suite and report results
allowed-tools: Read, Bash(npm test:*), Bash(npm run test:*), Glob
---

# Test All

Execute the full test suite for this project.

## Step 1: Detect Test Framework

This project uses jest via `npm test` (see `package.json` scripts and `jest.config.js`).

## Step 2: Run Tests

```bash
# Run all CDK stack synthesis tests
npm test

# Run a specific stack test
npm test -- test/network-stack.test.ts

# Run Express app unit tests
cd app && node --test test/server.test.js
```

## Step 3: Report

Present:
- Total tests run, passed, failed, skipped
- Failed test details with file paths and error messages
- Suggest fixes for failing tests if the cause is apparent

## Error Recovery

### If test runner itself fails
```bash
bash -n test/*.test.ts           # Check syntax (not applicable for TS, use tsc)
npx tsc --noEmit                 # TypeScript type check only
ls -la test/                     # Verify test files exist
```

### Common failure categories and fixes

| Failure Pattern | Likely Cause | Fix |
|---|---|---|
| "Snapshot mismatch" | CDK construct changed | Update snapshot with `npm test -- -u` |
| "Cannot find module" | Missing npm deps | `npm install` |
| "Type error" | TypeScript strict mode | Fix types, no `any` |
| "CIDR not found" | Context flag missing in test | Check `cdk.context.json` or test setup |
| "Stack not defined" | Missing stack in bin/app.ts | Wire stack with context guard |

### If many tests fail at once
Likely a structural change broke multiple assumptions:
1. `git log -1` — what was the last change?
2. `git diff HEAD~1 lib/` — which stack changed?
3. Fix the root cause, not individual test snapshots

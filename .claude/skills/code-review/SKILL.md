# Code Review Skill

Review changed code with confidence-based scoring to filter false positives.

## Review Scope

By default, review unstaged changes from `git diff`. The user may specify different files or scope.

## Review Criteria

### Project Guidelines Compliance
- CDK stack naming: `BgTest<Name>Stack` prefix
- Context flag usage: `includeSecondaryCidr`, `includeGreen`, `includeRolling` as string "true"
- No `any` types in TypeScript; explicit return types on public methods
- ALB weights as single source of truth — no `activeColor` or similar state flags
- ARM64 awareness: instance types must be Graviton (m7g, c7g, t4g, r7g families)

### Bug Detection
- Logic errors and null/undefined handling
- CDK circular dependencies between stacks
- Missing `.node.addDependency()` where cross-stack references exist
- Security group ingress rules that are overly permissive
- Missing `RemovalPolicy` on stateful resources (Aurora, Redis, ECR)

### Code Quality
- Code duplication across Blue/Green stack twins
- Missing context validation (use `validateRollingContext` pattern from `lib/rolling-context.ts`)
- Incomplete CfnOutputs for cross-stack DNS/ARN lookups
- Missing jest assertions for new CDK constructs

## Confidence Scoring

Rate each issue 0-100:
- **0-24**: Likely false positive or pre-existing issue. Do not report.
- **25-49**: Might be real but possibly a nitpick. Do not report.
- **50-74**: Real issue but minor. Report only if critical.
- **75-89**: Verified real issue, important. Report with fix suggestion.
- **90-100**: Confirmed critical issue. Must report.

**Only report issues with confidence >= 75.**

## Output Format

For each issue:
### [CRITICAL|IMPORTANT] <issue title> (confidence: XX)
**File:** `path/to/file.ext:line`
**Issue:** Clear description of the problem
**Guideline:** Reference to CLAUDE.md rule or security standard
**Fix:** Concrete code suggestion

If no high-confidence issues found, confirm code meets standards with brief summary.

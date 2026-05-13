# Refactor Skill

Refactor existing code to improve quality without changing behavior.

## Principles
- Improve structure without changing behavior
- Single Responsibility Principle (SRP)
- Remove duplicate code (DRY) — especially between Blue/Green stack twins
- Small, incremental steps with verification

## Process

### 1. Analysis
- Identify the target code and its tests
- Map all callers and dependencies (cross-stack Fn.importValue, CfnOutputs)
- Confirm jest test coverage exists (suggest adding tests first if not)

### 2. Plan
Present the refactoring plan to the user:
- What will change
- What will NOT change (behavior preservation)
- Risk assessment (low/medium/high)
- CDK impact: will CloudFormation detect resource replacement?

### 3. Execute
- Make changes in small, verifiable steps
- Run `npm test` after each step
- Keep commits atomic (one logical change per commit)

### 4. Verify
- Confirm all existing tests pass: `npm test`
- Run `npx cdk diff` to verify no unintended resource changes
- Check that the refactoring achieved its goal

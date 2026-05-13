# Release Skill

Automate the release process with validation checks.

## Procedure

### 1. Pre-release Checks
- Verify working tree is clean: `git status`
- Verify all tests pass: `npm test`
- Check for uncommitted changes

### 2. Determine Version
- Review changes since last tag: `git log $(git describe --tags --abbrev=0 2>/dev/null || echo HEAD)..HEAD --oneline`
- Apply semver rules:
  - MAJOR: Breaking CDK API changes, stack renames requiring destroy/recreate
  - MINOR: New CDK stacks, new demo scenarios, new app endpoints
  - PATCH: Bug fixes, script improvements, doc updates

### 3. Update Changelog
- Group changes by type (Added, Changed, Fixed, Removed)
- Include commit references
- Add date and version header
- Apply to both English and Korean sections in `CHANGELOG.md`

### 4. Create Release
- Update `version` in `package.json`
- Create git tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
- Generate release notes

### 5. Summary
- Display version bump
- List key changes
- Show next steps (push tag, update README badges)

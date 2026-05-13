#!/bin/bash
# Project structure integrity tests.
# Validates manifests, file existence, command frontmatter, and CLAUDE.md sections.

# --- Manifest validation ---
assert_json_valid "package.json is valid JSON" "package.json"
assert_json_valid "cdk.json is valid JSON" "cdk.json"
assert_json_valid "tsconfig.json is valid JSON" "tsconfig.json"
assert_json_valid ".claude/settings.json is valid JSON" ".claude/settings.json"
assert_json_valid ".mcp.json is valid JSON" ".mcp.json"

# --- Key file existence ---
assert_file_exists "Root CLAUDE.md" "CLAUDE.md"
assert_file_exists "docs/architecture.md" "docs/architecture.md"
assert_file_exists "docs/onboarding.md" "docs/onboarding.md"
assert_file_exists "docs/api-reference.md" "docs/api-reference.md"
assert_file_exists "docs/decisions/.template.md" "docs/decisions/.template.md"
assert_file_exists "docs/runbooks/.template.md" "docs/runbooks/.template.md"
assert_file_exists "CHANGELOG.md" "CHANGELOG.md"
assert_file_exists ".env.example" ".env.example"
assert_file_exists ".editorconfig" ".editorconfig"

# --- Module CLAUDE.md files ---
for mod in lib app bin demos scripts test; do
    assert_file_exists "$mod/CLAUDE.md exists" "$mod/CLAUDE.md"
done

# --- Script validation ---
assert_file_executable "scripts/setup.sh is executable" "scripts/setup.sh"
assert_file_executable "scripts/install-hooks.sh is executable" "scripts/install-hooks.sh"
assert_bash_syntax "scripts/setup.sh valid bash" "scripts/setup.sh"
assert_bash_syntax "scripts/install-hooks.sh valid bash" "scripts/install-hooks.sh"

# --- Command frontmatter ---
for cmd in review test-all deploy; do
    CMD_CONTENT=$(cat ".claude/commands/$cmd.md")
    assert_contains "Command $cmd: has frontmatter description" "$CMD_CONTENT" "description:"
    assert_contains "Command $cmd: has allowed-tools" "$CMD_CONTENT" "allowed-tools:"
done

# --- CLAUDE.md required sections ---
SECTIONS=("Overview" "Tech Stack" "Project Structure" "Conventions" "Key Commands" "Auto-Sync Rules")
for section in "${SECTIONS[@]}"; do
    grep -qF "## $section" CLAUDE.md && pass "CLAUDE.md: has $section" || fail "CLAUDE.md: has $section" "not found"
done

# --- Skills files ---
for skill in code-review refactor release sync-docs; do
    assert_file_exists ".claude/skills/$skill/SKILL.md exists" ".claude/skills/$skill/SKILL.md"
done

# --- Agent files ---
for agent in code-reviewer security-auditor; do
    assert_file_exists ".claude/agents/$agent.yml exists" ".claude/agents/$agent.yml"
done

# --- Git hook installed ---
assert_file_exists ".git/hooks/commit-msg installed" ".git/hooks/commit-msg"
assert_file_executable ".git/hooks/commit-msg executable" ".git/hooks/commit-msg"

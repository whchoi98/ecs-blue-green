#!/bin/bash
# Tests for .claude/hooks/*.sh

# --- Existence and permissions ---
HOOKS=(check-doc-sync secret-scan session-context notify)
for hook in "${HOOKS[@]}"; do
    assert_file_exists "$hook.sh exists" ".claude/hooks/$hook.sh"
    assert_file_executable "$hook.sh is executable" ".claude/hooks/$hook.sh"
    assert_bash_syntax "$hook.sh valid bash" ".claude/hooks/$hook.sh"
done

# --- settings.json hook registration ---
assert_file_exists "settings.json exists" ".claude/settings.json"
assert_json_valid "settings.json is valid JSON" ".claude/settings.json"

SETTINGS=$(cat .claude/settings.json)
assert_contains "SessionStart hook registered" "$SETTINGS" "session-context.sh"
assert_contains "PreToolUse hook registered" "$SETTINGS" "secret-scan.sh"
assert_contains "PostToolUse hook registered" "$SETTINGS" "check-doc-sync.sh"
assert_contains "PostToolUse matcher is Write|Edit" "$SETTINGS" "Write|Edit"
assert_contains "Notification hook registered" "$SETTINGS" "notify.sh"

# --- Behavior tests ---
# check-doc-sync: empty path should produce no output
OUTPUT=$(bash .claude/hooks/check-doc-sync.sh "" 2>&1)
assert_eq "check-doc-sync: empty path produces no output" "" "$OUTPUT"

# check-doc-sync: lib/ path triggers doc check (no CLAUDE.md missing since we created it)
OUTPUT=$(bash .claude/hooks/check-doc-sync.sh "lib/network-stack.ts" 2>&1)
# Should NOT warn about CLAUDE.md since lib/CLAUDE.md exists
echo "$OUTPUT" | grep -q "CLAUDE.md is missing" && fail "check-doc-sync: false CLAUDE.md warning for lib/" "CLAUDE.md exists but warning triggered" || pass "check-doc-sync: no false CLAUDE.md warning for lib/"

# session-context: should output project info
OUTPUT=$(bash .claude/hooks/session-context.sh 2>&1)
assert_contains "session-context: shows project header" "$OUTPUT" "Project Context"
assert_contains "session-context: shows ecs-blue-green" "$OUTPUT" "ecs-blue-green"

# notify: no webhook URL should exit silently
OUTPUT=$(CLAUDE_NOTIFY_WEBHOOK="" bash .claude/hooks/notify.sh "test" "msg" 2>&1)
assert_eq "notify.sh: no webhook URL produces no output" "" "$OUTPUT"

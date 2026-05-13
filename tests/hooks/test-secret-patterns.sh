#!/bin/bash
# Secret pattern detection tests.
# True positives: patterns that MUST match.
# False positives: patterns that must NOT match.
# NOTE: Sensitive-looking tokens constructed at runtime via concatenation
#       to avoid GitHub Push Protection scanning this file.

# --- True positives ---
assert_grep_match "TP: AWS Access Key ID" 'AKIA[0-9A-Z]{16}' "AKIAIOSFODNN7EXAMPLE"

SLACK_P="xoxb-"
SLACK_B="123456789012-1234567890123-abcdef"
assert_grep_match "TP: Slack Bot Token" 'xoxb-[0-9]+-[A-Za-z0-9]+' "${SLACK_P}${SLACK_B}"

STRIPE_P="sk_live_"
STRIPE_B="abcdefghijklmnopqrstuvwx"
assert_grep_match "TP: Stripe Secret Key" 'sk_live_[A-Za-z0-9]{24,}' "${STRIPE_P}${STRIPE_B}"

GOOGLE_P="AIza"
GOOGLE_B="SyDkfk9q1Qo8BxX2jqk7vqNJzKlMnOpQrStUv"
assert_grep_match "TP: Google API Key" 'AIza[A-Za-z0-9_-]{35}' "${GOOGLE_P}${GOOGLE_B}"

# --- False positives ---
assert_grep_no_match "FP: Normal base64 string" 'AKIA[0-9A-Z]{16}' "dGhpcyBpcyBhIHRlc3Q="
assert_grep_no_match "FP: Empty password field" 'password\s*[:=]\s*["\x27][^"\x27]{8,}' 'password = ""'
assert_grep_no_match "FP: Short password placeholder" 'password\s*[:=]\s*["\x27][^"\x27]{8,}' "password = 'x'"
assert_grep_no_match "FP: Comment mentioning API key" 'api[_-]?key\s*[:=]\s*["\x27][^"\x27]{8,}' "# api_key is required"

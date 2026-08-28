#!/usr/bin/env bash
#
# Protect main, and set the repository up so agents can merge their own work
# once the checks are green.
#
# Idempotent: run it as often as you like. Requires the GitHub CLI, logged in
# as someone with admin on the repository.
#
#   ./scripts/protect-main.sh              # act on the current repo's origin
#   ./scripts/protect-main.sh owner/repo   # act on a specific repository

set -euo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
BRANCH=main

echo "Repository: $REPO"
echo "Branch:     $BRANCH"
echo

# The status checks that have to pass. These are job names from
# .github/workflows/ci.yml — keep the two in step. "agent review" is
# deliberately absent: its verdict is advisory, and it cannot run on a fork.
read -r -d '' PROTECTION <<'JSON' || true
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["quality", "test", "schema", "build"]
  },
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "enforce_admins": false,
  "restrictions": null,
  "required_linear_history": true,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false
}
JSON

echo "→ Protecting $BRANCH"
# Approvals are required zero times on purpose: no human reads these pull
# requests, so the checks are the review. The human veto is
# required_conversation_resolution — one unresolved comment blocks the merge.
# enforce_admins stays false so a maintainer can still push when it matters.
printf '%s' "$PROTECTION" |
  gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" \
    -H 'Accept: application/vnd.github+json' --input - >/dev/null
echo "  done"

echo "→ Merge settings"
# Squash only, because required_linear_history rejects merge commits.
#
# Auto-merge is off on purpose. Green checks are necessary to merge but not
# sufficient: a human presses the button, because merging is where the
# dictating happens. Nothing reaches main without someone choosing it.
gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F allow_auto_merge=false \
  -F delete_branch_on_merge=true >/dev/null
echo "  done"

echo
echo "Current protection:"
gh api "repos/$REPO/branches/$BRANCH/protection" --jq '{
  checks: .required_status_checks.contexts,
  strict: .required_status_checks.strict,
  approvals_required: .required_pull_request_reviews.required_approving_review_count,
  conversation_resolution: .required_conversation_resolution.enabled,
  linear_history: .required_linear_history.enabled,
  force_pushes: .allow_force_pushes.enabled,
  deletions: .allow_deletions.enabled,
  admins_enforced: .enforce_admins.enabled
}'

echo
echo "Still to do by hand (they need values, not settings):"
echo "  1. Create a 'production' environment and add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to it."
echo "  2. Optional: add an ANTHROPIC_API_KEY repository secret to turn on the agent reviewer."

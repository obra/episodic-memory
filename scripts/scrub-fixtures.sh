#!/bin/bash
# Scrub PII and project info from test fixtures

set -e

FIXTURES_DIR="test/fixtures"

echo "Scrubbing test fixtures..."

for file in "$FIXTURES_DIR"/*.jsonl; do
  echo "Processing $(basename "$file")..."

  # Create backup
  cp "$file" "$file.bak"

  # Scrub project-specific paths and names
  sed -i '' \
    -e 's|/Users/jesse/|/Users/testuser/|g' \
    -e 's|/projects/dev\.repeatably\.com|/projects/example-project|g' \
    -e 's|/newco/scenario-testing-agent|/example-org/example-project|g' \
    -e 's|\.clank/worktrees/conversation-search|.worktrees/example-feature|g' \
    -e 's|"gitBranch":"streaming"|"gitBranch":"feature-branch"|g' \
    -e 's|"gitBranch":"conversation-search"|"gitBranch":"feature-branch"|g' \
    -e 's|repeatably|example|g' \
    -e 's|Repeatably|Example|g' \
    -e 's|secret-journal|private-journal|g' \
    -e 's|"name": "Jesse"|"name": "Test User"|g' \
    -e 's|"author".*"name": "Jesse Vincent"|"author": {"name": "Test User"|g' \
    -e 's|"email": "jesse@fsck\.com"|"email": "test@example.com"|g' \
    -e 's|Looking at your instructions, Jesse|Looking at your instructions|g' \
    -e 's|Jesse'\''s right|You'\''re right|g' \
    -e 's|Jesse values|The user values|g' \
    "$file"
done

echo "Done! Backups saved as *.jsonl.bak"
echo "Review changes with: git diff test/fixtures/"

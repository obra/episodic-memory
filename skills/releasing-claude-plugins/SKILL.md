---
name: releasing-claude-plugins
description: Use when releasing a new version of a Claude Code plugin - handles version bumping, changelog updates, marketplace sync, git tagging, and publishing workflow
---

# Releasing Claude Code Plugins

Complete release engineering workflow for Claude Code plugins published to superpowers-marketplace.

## When to Use This Skill

Use this skill when:
- Ready to release a new version of a Claude Code plugin
- Need to publish bug fixes, new features, or breaking changes
- Updating plugin versions in marketplace

## Version Management

Follow semantic versioning (semver):
- **MAJOR.MINOR.PATCH** (e.g., 1.2.3)
- **MAJOR**: Breaking changes to plugin API or behavior
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes, backward compatible

## Release Process Checklist

### 1. Pre-Release Testing

- [ ] Test plugin functionality locally
- [ ] Verify all hooks/scripts work with current Claude Code version
- [ ] Run test suite if present (`npm test`)
- [ ] Validate all JSON files (plugin.json, marketplace.json, hooks.json)
- [ ] Ensure README is up to date
- [ ] Test local installation

### 2. Update CHANGELOG.md

Add entry to top of `CHANGELOG.md` following Keep a Changelog format:

```markdown
## [X.X.X] - YYYY-MM-DD

### Added
- New features

### Changed
- Modified behavior

### Fixed
- Bug fixes
```

### 3. Version Bump

Update version number in ALL these files (must match exactly):

1. **`.claude-plugin/plugin.json`** - `"version"` field
2. **`.claude-plugin/marketplace.json`** - plugin entry version (if present)
3. **`../superpowers-marketplace/.claude-plugin/marketplace.json`** - plugin version in marketplace
4. **`package.json`** - version field (if npm package)

**Critical**: All version numbers MUST be identical across files.

### 4. Commit and Tag

```bash
# Add all version changes
git add .
git commit -m "Release vX.X.X: <brief description>"

# Create annotated tag
git tag -a vX.X.X -m "Release vX.X.X"

# Push commits and tags
git push origin main
git push origin vX.X.X
```

### 5. Update Superpowers Marketplace

```bash
# Commit and push marketplace changes
cd ../superpowers-marketplace
git add .claude-plugin/marketplace.json
git commit -m "Update <plugin-name> to vX.X.X"
git push
```

### 6. Verify Release

- [ ] Check GitHub tag exists
- [ ] Verify marketplace.json updated in superpowers-marketplace
- [ ] Test installation from marketplace: `/plugin install <plugin-name>@superpowers-marketplace`

## File Checklist

Before release, verify these files are correct:

### Core Plugin Files
- [ ] `.claude-plugin/plugin.json` - version, description, paths
- [ ] `.claude-plugin/marketplace.json` - version matches (if present)
- [ ] `hooks/hooks.json` - hook configuration (if applicable)
- [ ] `README.md` - installation instructions, features
- [ ] `LICENSE` - correct license
- [ ] `CHANGELOG.md` - updated with new version

### External Files
- [ ] `../superpowers-marketplace/.claude-plugin/marketplace.json` - version matches

## Release Type Guide

### Patch Release (Bug Fix)
- Increment PATCH: `1.0.11 → 1.0.12`
- CHANGELOG: Use "### Fixed" section
- For: Bug fixes, typos, minor improvements

### Minor Release (New Feature)
- Increment MINOR, reset PATCH: `1.0.11 → 1.1.0`
- CHANGELOG: Use "### Added" and/or "### Changed"
- For: New features, enhancements (backward compatible)

### Major Release (Breaking Change)
- Increment MAJOR, reset MINOR/PATCH: `1.0.11 → 2.0.0`
- CHANGELOG: Document breaking changes clearly
- Consider: Migration guide in README
- For: API changes, removed features, behavioral changes

## Important Notes

**Never skip these steps:**
- Always update ALL version files - mismatches confuse users
- Always create annotated tags: `git tag -a` not `git tag`
- Always test locally before releasing
- Always update superpowers-marketplace - users need this to get updates

**Git tag format:**
- Use `vX.X.X` format (with 'v' prefix)
- Use annotated tags, not lightweight tags
- Never delete or force-push tags

**Marketplace updates:**
- Changes are immediately visible to all users
- Double-check version numbers before pushing
- Marketplace repo is separate from plugin repo

## Emergency Hotfix Procedure

For critical bugs requiring immediate release:

1. Fix the bug in current codebase
2. Increment PATCH version
3. Update CHANGELOG with "### Fixed"
4. Follow full release process (don't skip steps!)
5. Communicate urgency in commit message

## Rollback Procedure

If a release has critical issues:

1. **Immediate**: Update `../superpowers-marketplace/.claude-plugin/marketplace.json` to previous version
2. **Fix**: Create new commit fixing the issue
3. **Release**: Create new patch version with fix
4. **Don't**: Delete tags or rewrite history - transparency over perfection

## Common Pitfalls

- ❌ Forgetting to update marketplace.json in superpowers-marketplace
- ❌ Version mismatch between plugin.json and marketplace.json
- ❌ Using lightweight tags instead of annotated tags
- ❌ Forgetting to push tags: `git push origin vX.X.X`
- ❌ Not testing installation from marketplace before announcing
- ❌ Skipping CHANGELOG update

## Workflow Summary

```
1. Test locally
2. Update CHANGELOG.md
3. Bump version in ALL files
4. git commit -m "Release vX.X.X: description"
5. git tag -a vX.X.X -m "Release vX.X.X"
6. git push origin main && git push origin vX.X.X
7. cd ../superpowers-marketplace
8. Update marketplace.json
9. git commit && git push
10. Verify installation works
```

## Reference

- Semantic Versioning: https://semver.org/
- Keep a Changelog: https://keepachangelog.com/

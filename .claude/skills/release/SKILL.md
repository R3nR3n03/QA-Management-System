---
name: release
description: Cut a QAMS release — version bump, CHANGELOG entry, the bump commit, and the branch and tag that must point at it. Use when asked to cut, tag, or publish a release, bump the version, or write a CHANGELOG entry for one.
---

# Cutting a release

`CHANGELOG.md` is the release history. **Every release adds an entry, in the same commit as the version bump** — it is the only human-readable record of what a version contains, and reconstructing one afterwards from git means reading tag messages that may not exist (see its "Notes on this history").

1. Merge the work to `main` — a PR merge, or `--no-ff` locally; the history is merge commits.
2. `npm version X.Y.Z --no-git-tag-version`, so `package-lock.json` moves too.
3. Add the `X.Y.Z` entry at the top of `CHANGELOG.md`: what changed **for someone using the system**, not which files moved. Policy lives in `docs/` — record when it took effect, never restate what it says.
4. Commit both on `main` as `chore: bump version to X.Y.Z`.
5. `git branch X.Y.Z` — **bare version number, not `release/X.Y.Z`** — and `git tag -a vX.Y.Z`. Branch, tag and `main` all point at that one bump commit.
6. Push `main`, the branch, and the tag.

Verify typecheck, lint, tests and a production build **on the bump commit itself** before pushing. `main` on `origin` requires a pull request, so the bump commit's direct push reports `Bypassed rule violations` — expected for this procedure, but say so rather than letting it pass unremarked.

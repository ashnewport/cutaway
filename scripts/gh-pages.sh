#!/usr/bin/env bash
#
# Builds the app and publishes dist to the gh-pages branch.
#
#   pnpm gh-pages             Test, build, commit and push
#   pnpm gh-pages --no-push   Same, but leave the commit on the local branch
#
# The commit is made directly from dist, so nothing is checked out and the
# working tree is untouched. It never force pushes: if the local and remote
# branches have diverged, it stops and leaves both alone.

set -euo pipefail

remote=origin
branch=gh-pages
push=true

case "${1:-}" in
	'') ;;
	--no-push) push=false ;;
	*)
		echo "Usage: $0 [--no-push]" >&2
		exit 2
		;;
esac

fail() {
	echo "gh-pages: $1" >&2
	exit 1
}

cd "$(git rev-parse --show-toplevel)"

[ "$(git branch --show-current)" != "$branch" ] || fail "switch off $branch first."
[ -z "$(git status --porcelain)" ] || fail "commit or stash your changes first, so the build matches a commit."

source_sha=$(git rev-parse --short HEAD)

# Work out what to build on before spending time on a build.
local_tip=$(git rev-parse --quiet --verify "refs/heads/$branch" || true)
remote_tip=$(git ls-remote --heads "$remote" "refs/heads/$branch" | cut -f1)
parent=$local_tip

if [ -n "$remote_tip" ]; then
	git fetch --quiet "$remote" "refs/heads/$branch"
	if [ -z "$local_tip" ] || git merge-base --is-ancestor "$local_tip" "$remote_tip"; then
		parent=$remote_tip
	elif ! git merge-base --is-ancestor "$remote_tip" "$local_tip"; then
		fail "local $branch and $remote/$branch have diverged. Resolve that by hand."
	fi
fi

pnpm test
pnpm build

# Stops GitHub Pages running Jekyll, which would drop files starting with _.
touch dist/.nojekyll

index=$(mktemp)
rm -f "$index"
trap 'rm -f "$index"' EXIT

GIT_INDEX_FILE=$index git --work-tree=dist add --all --force
tree=$(GIT_INDEX_FILE=$index git write-tree)

if [ -n "$parent" ] && [ "$tree" = "$(git rev-parse "$parent^{tree}")" ]; then
	echo "gh-pages: the build has not changed since the last publish."
	commit=$parent
else
	message="chore(pages): publish $source_sha"
	if [ -n "$parent" ]; then
		commit=$(git commit-tree "$tree" -p "$parent" -m "$message")
	else
		commit=$(git commit-tree "$tree" -m "$message")
	fi
	echo "gh-pages: committed $(git rev-parse --short "$commit") from $source_sha."
fi

git update-ref "refs/heads/$branch" "$commit"

if [ "$push" = true ]; then
	git push "$remote" "refs/heads/$branch:refs/heads/$branch"
	echo "gh-pages: pushed to $remote/$branch."
else
	echo "gh-pages: not pushed. Run this when ready: git push $remote $branch"
fi

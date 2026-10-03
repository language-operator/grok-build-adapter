#!/bin/sh
# What tmux runs. The base already starts tmux in the working directory (the
# cloned repo when the agent sets spec.repository, else /workspace), so grok
# opens straight into the project. Its config — the gateway models, MCP
# servers and standing rules — is under $GROK_HOME, written by
# `coding-runtime seed`.
#
# Sessions live on the workspace PVC, under $GROK_HOME/sessions, which outlives
# the pod. Sleeping an agent destroys the pod and waking it makes a new one, and
# this exec is the only moment a resume decision can be made — tmux is started
# with `new-session -A`, so on a reconnect to a live pod the launcher is never
# re-run. Without --continue a woken agent always opens blank.
#
# But `grok --continue` exits 1 ("No session found for current directory") when
# there is nothing to resume, which would close the terminal on a brand-new
# agent. Grok keys sessions by the URL-encoded working directory, and only a
# session that has had a conversation holds updates.jsonl — merely opening the
# TUI creates a directory that --continue still refuses. If the test is wrong in
# either direction the cost is small: a stale yes falls through to a fresh
# session below, a stale no opens blank.
set -eu

grok_home="${GROK_HOME:-$HOME/.grok}"
cwd_key="$(node -e 'process.stdout.write(encodeURIComponent(process.cwd()))')"

if ls "$grok_home/sessions/$cwd_key"/*/updates.jsonl >/dev/null 2>&1; then
    grok --continue "$@" && exit 0
fi

exec grok "$@"

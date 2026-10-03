#!/bin/sh
# What a task-mode run executes (runtime.json `task.exec`). The base runs it in
# the working directory with the HTTP server up, and the exit code becomes the
# run's phase: grok exits 0 on success and 1 on a model, gateway or runtime
# error; SIGTERM from activeDeadlineSeconds is forwarded and reports 143.
#
# The task is the agent's instructions, which `coding-runtime seed` wrote to
# $GROK_HOME/task.md. Nobody is watching to approve tool calls, so they are
# approved automatically; deny rules and hooks still apply.
set -eu

task="${GROK_HOME:-$HOME/.grok}/task.md"
if [ ! -s "$task" ]; then
    echo "launch-grok-build-task: $task is missing or empty; a task agent needs spec instructions" >&2
    exit 1
fi

exec grok -p "$(cat "$task")" --always-approve

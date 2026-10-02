#!/bin/sh
# What tmux runs. The base already starts tmux in the working directory (the
# cloned repo when the agent sets spec.repository, else /workspace), so grok
# opens straight into the project.
#
# Grok Build keeps its config and state under $GROK_HOME, which runtime.json
# points at the workspace volume. Provider config, the no-login path and
# resuming a slept agent's conversation are issue #1.
set -eu

exec grok "$@"

#!/usr/bin/env bash
# Starts the local card helper on http://127.0.0.1:8765. Leave it running while you take notes;
# the model sleeps (and frees its RAM) after a few idle minutes and wakes on the next request.
HOME_DIR="${JIVVY_NPU_HOME:-$HOME/.local/share/jivvy-npu}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export JIVVY_NPU_MODEL="${JIVVY_NPU_MODEL:-$HOME_DIR/models/qwen3-1.7b-int4-sym}"
exec nice -n 10 "$HOME_DIR/venv/bin/python" -I "$HERE/server.py"

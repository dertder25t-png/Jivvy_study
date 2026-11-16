#!/usr/bin/env bash
# One-time setup for the local card helper (Intel NPU, Linux).
# Puts everything in ~/.local/share/jivvy-npu — its own Python env, so it can't disturb any other
# AI project on this laptop. Needs the Intel NPU driver (the intel_vpu kernel module + Level Zero).
set -euo pipefail
HOME_DIR="${JIVVY_NPU_HOME:-$HOME/.local/share/jivvy-npu}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MODEL="$HOME_DIR/models/qwen3-1.7b-int4-sym"
SRC="$HOME_DIR/models/qwen3-1.7b-fp16"

mkdir -p "$HOME_DIR"
[ -x "$HOME_DIR/venv/bin/python" ] || python3 -m venv "$HOME_DIR/venv"
"$HOME_DIR/venv/bin/pip" install -q "openvino-genai==2026.4.1.0" nncf huggingface_hub

if [ ! -f "$MODEL/openvino_model.xml" ]; then
  # The NPU needs symmetric 4-bit weights, so start from full precision and compress here.
  "$HOME_DIR/venv/bin/hf" download OpenVINO/Qwen3-1.7B-fp16-ov --local-dir "$SRC"
  "$HOME_DIR/venv/bin/python" -I "$HERE/convert.py" "$SRC" "$MODEL"
  rm -rf "$SRC"  # only the ~1 GB NPU copy is kept
fi
echo "Ready. Start it with: $HERE/start.sh"

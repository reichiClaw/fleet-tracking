#!/usr/bin/env bash
set -euo pipefail

umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
OUTPUT="${PYTHON_LOCK_OUTPUT:-$ROOT_DIR/deploy/requirements/backend-py313.lock}"
PIP_TOOLS_VERSION=7.5.3

version="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
[ "$version" = 3.13 ] || {
  echo "Python 3.13 is required to regenerate the production dependency lock (found $version)." >&2
  exit 1
}

mkdir -p "$(dirname "$OUTPUT")"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

"$PYTHON_BIN" -m venv "$work_dir/venv"
"$work_dir/venv/bin/python" -m pip install --quiet "pip-tools==$PIP_TOOLS_VERSION"
"$work_dir/venv/bin/pip-compile" \
  --generate-hashes \
  --resolver=backtracking \
  --strip-extras \
  --allow-unsafe \
  --output-file "$OUTPUT" \
  "$ROOT_DIR/backend/requirements.txt"
chmod 644 "$OUTPUT"

echo "Generated $OUTPUT with pip-tools $PIP_TOOLS_VERSION on Python $version."
echo "The backend image must be updated to install this lock before it becomes the runtime source of truth."

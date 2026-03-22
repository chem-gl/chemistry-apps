#!/usr/bin/env bash
set -euo pipefail

# Run AMBIT SyntheticAccessibilityCli using portable Java 8
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

JAVA_BIN="$ROOT_DIR/tools/java/jre8/bin/java"
JAR_PATH="$ROOT_DIR/tools/external/ambitSA/SyntheticAccessibilityCli.jar"

# Check if Java portable exists
if [[ ! -x "$JAVA_BIN" ]]; then
  echo "ERROR: Java 8 portable not found at $JAVA_BIN" >&2
  echo "Run: scripts/download_java_runtimes.sh" >&2
  exit 1
fi

# Check if JAR exists
if [[ ! -f "$JAR_PATH" ]]; then
  echo "ERROR: SyntheticAccessibilityCli.jar not found at $JAR_PATH" >&2
  echo "Run: scripts/download_external_tools.sh" >&2
  exit 1
fi

exec "$JAVA_BIN" -jar "$JAR_PATH" "$@"

#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

host_port="${1:-8123}"
if [[ ! "$host_port" =~ ^[0-9]+$ ]] || (( host_port < 1 || host_port > 65535 )); then
  echo "Usage: $0 [port between 1 and 65535]" >&2
  exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required to serve the Host page." >&2
  exit 1
fi

exec python3 host_server.py "$host_port"

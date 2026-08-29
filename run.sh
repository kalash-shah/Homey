#!/usr/bin/env bash
# Startup script for Homey mobile app server
set -e

PORT=${1:-8080}
cd "$(dirname "$0")"

echo "======================================================"
echo "           🏠 Starting Homey (HomeVault App)          "
echo "======================================================"

python3 server.py --port "$PORT"

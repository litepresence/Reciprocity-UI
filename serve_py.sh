#!/bin/bash
# Start all three servers for the Python demo stack
# Usage: ./serve_py.sh [UI_PORT] [FLOAT_PORT] [INT_PORT]
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$DIR")"

UI_PORT="${1:-3905}"
FLOAT_PORT="${2:-3906}"
INT_PORT="${3:-3907}"

echo "Starting Reciprocity UI at http://localhost:$UI_PORT"
echo "Starting Python Float server at http://localhost:$FLOAT_PORT"
echo "Starting Python Integer server at http://localhost:$INT_PORT"
echo ""
echo "Open http://localhost:$UI_PORT in your browser."
echo ""

# Reciprocity UI (static files)
python3 -m http.server "$UI_PORT" --directory "$DIR" &

# Python demo servers
python3 "$ROOT/demonstrations/python-server/server.py" --mode float --port "$FLOAT_PORT" &
python3 "$ROOT/demonstrations/python-server/server.py" --mode integer --port "$INT_PORT" &

echo "Press Ctrl+C to stop all servers"

trap 'kill 0' EXIT
wait

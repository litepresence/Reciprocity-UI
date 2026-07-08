#!/bin/bash
# Start a local HTTP server for the multi-chain UI
# MetaMask requires the page to be served via HTTP (not file://)
PORT="${1:-3905}"
DIR="$(dirname "$0")"
echo "Serving Reciprocity Multi-Chain UI at http://localhost:$PORT"
echo "Open with: http://localhost:$PORT/?chain=evm"
echo "Connect MetaMask (Sepolia network) to use the EVM wrapper."
python3 -m http.server "$PORT" --directory "$DIR"

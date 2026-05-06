#!/bin/bash
# Double-click in Finder to start moggednyc (Mac).
cd "$(dirname "$0")"
echo "Starting server… then opening your browser."
node server.mjs &
PID=$!
sleep 2
open "http://localhost:8080" 2>/dev/null || true
echo "Server running. Press Ctrl+C in this window to stop."
wait $PID

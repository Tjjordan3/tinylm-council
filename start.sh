#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "Starting AI Council backend..."
if command -v uv >/dev/null 2>&1; then
  uv run python -m backend.main &
else
  python -m backend.main &
fi
BACKEND_PID=$!

echo "Starting AI Council frontend..."
cd frontend && npm run dev &
FRONTEND_PID=$!

echo ""
echo "AI Council is starting:"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8001"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait

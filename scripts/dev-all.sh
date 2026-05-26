#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -x ".venv/bin/uvicorn" ]; then
  echo "Backend virtualenv is missing dependencies. Run: python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt"
  exit 1
fi

cleanup() {
  if [ -n "${API_PID:-}" ]; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [ -n "${WEB_PID:-}" ]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting FastAPI on http://127.0.0.1:8000"
.venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 &
API_PID=$!

echo "Starting Vite on http://127.0.0.1:5173"
npm --prefix frontend run dev &
WEB_PID=$!

wait "$API_PID" "$WEB_PID"

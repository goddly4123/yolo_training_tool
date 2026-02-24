#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "===================================="
echo "  YOLOv12 Annotation Tool 시작"
echo "===================================="

# 필요한 디렉토리 자동 생성
for dir in \
  "$SCRIPT_DIR/to_annotate/images" \
  "$SCRIPT_DIR/to_annotate/labels" \
  "$SCRIPT_DIR/to_annotate/.trash/images" \
  "$SCRIPT_DIR/to_annotate/.trash/labels" \
  "$SCRIPT_DIR/BASE_data" \
  "$SCRIPT_DIR/DATA/images/train" \
  "$SCRIPT_DIR/DATA/images/val" \
  "$SCRIPT_DIR/DATA/labels/train" \
  "$SCRIPT_DIR/DATA/labels/val"
do
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
    echo "  폴더 생성: ${dir#$SCRIPT_DIR/}"
  fi
done

# Flask backend
echo "[1/2] Flask 서버 시작 (port 5001)..."
cd "$SCRIPT_DIR"
uv run python annotation/app.py &
FLASK_PID=$!

# Wait for Flask to be ready
sleep 1

# React frontend
echo "[2/2] React 개발 서버 시작 (port 3000)..."
cd "$SCRIPT_DIR/annotation/frontend"

if [ ! -d "node_modules" ]; then
  echo "  npm 패키지 설치 중..."
  npm install
fi

npm run dev &
REACT_PID=$!

LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "your-ip")

echo ""
echo "===================================="
echo "  로컬:  http://localhost:3000"
echo "  네트워크: http://$LOCAL_IP:3000"
echo "  종료: Ctrl+C"
echo "===================================="

cleanup() {
  echo ""
  echo "종료 중..."
  kill $FLASK_PID $REACT_PID 2>/dev/null || true
  exit 0
}

trap cleanup INT TERM
wait

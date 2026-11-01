# ── Stage 1: Build frontend ──
# Static files work on any platform, so build once on the builder's own
# platform instead of under emulation (Next.js crashes under arm64 emulation)
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
# Produces /app/out/ with static HTML/CSS/JS

# ── Stage 2: Production ──
FROM python:3.11-slim

WORKDIR /app

# System deps (numpy/pandas, HEIC support)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libheif-dev && \
    rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Copy frontend build output
COPY --from=frontend /app/out /app/static

# Create data directory
RUN mkdir -p /data/fastf1-cache

EXPOSE 8000

ENV PORT=8000
ENV STATIC_DIR=/app/static
CMD sh -c "cp -n /app/data/pit_loss.json /data/pit_loss.json 2>/dev/null; uvicorn main:app --host 0.0.0.0 --port $PORT"

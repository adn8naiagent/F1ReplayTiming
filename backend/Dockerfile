FROM python:3.11-slim

WORKDIR /app

# Install system deps for numpy/pandas and libheif for HEIC support
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libheif-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create cache directory
RUN mkdir -p /data/fastf1-cache

EXPOSE 8000

ENV PORT=8000
CMD sh -c "uvicorn main:app --host 0.0.0.0 --port $PORT"

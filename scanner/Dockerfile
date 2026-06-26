FROM python:3.11-slim

WORKDIR /app

# Install system deps (curl for healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy scanner code
COPY . .

# Default command: run Celery worker. Beat is a separate container (see Plan 5).
CMD ["celery", "-A", "scanner.celery_app:celery_app", "worker", "--loglevel=info", "--pool=solo"]

FROM python:3.13-slim

# System libraries required by WeasyPrint (libpango, libcairo, libgobject, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libcairo-gobject2 \
    libgdk-pixbuf-2.0-0 \
    libglib2.0-0 \
    libharfbuzz0b \
    libffi-dev \
    libxml2 \
    libxslt1.1 \
    shared-mime-info \
    fonts-dejavu-core \
    fonts-noto \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 8080
CMD ["sh", "-c", "gunicorn server:app -k uvicorn.workers.UvicornWorker --workers ${WEB_CONCURRENCY:-2} --worker-connections 1000 --backlog 2048 --timeout 120 --keep-alive 5 --bind 0.0.0.0:${PORT:-8080}"]

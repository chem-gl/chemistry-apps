# backend/Dockerfile: Imagenes Docker para desarrollo y produccion del backend Django.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        libxrender1 \
        libxext6 \
        libx11-6 \
        libexpat1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --upgrade pip \
    && pip install -r /tmp/requirements.txt

COPY . /app

EXPOSE 8000

FROM base AS dev
CMD ["python", "manage.py", "up", "--without-celery", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS prod
CMD ["sh", "-c", "attempt=1; max_attempts=20; until python manage.py migrate --noinput; do if [ \"$attempt\" -ge \"$max_attempts\" ]; then echo 'Migrations failed after retries'; exit 1; fi; echo \"Migration attempt $attempt/$max_attempts failed, retrying in 5s...\"; attempt=$((attempt+1)); sleep 5; done; exec daphne -b 0.0.0.0 -p 8000 config.asgi:application"]

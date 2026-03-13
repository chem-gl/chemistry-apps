# backend/Dockerfile: Imagenes Docker para desarrollo y produccion del backend Django.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --upgrade pip \
    && pip install -r /tmp/requirements.txt

COPY . /app

EXPOSE 8000

FROM base AS dev
CMD ["python", "manage.py", "up", "--without-celery", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS prod
CMD ["sh", "-c", "python manage.py migrate --noinput && exec daphne -b 0.0.0.0 -p 8000 config.asgi:application"]

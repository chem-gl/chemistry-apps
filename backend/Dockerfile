# backend/Dockerfile: Imagenes Docker para produccion del backend Django.

# Python 3.12 (LTS estable, versión con soporte a largo plazo disponible en Docker Hub).
# Se prefiere sobre 3.14.0 que podría no estar disponible en todos los registros.
FROM python:3.12 AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    # Variables necesarias para evitar el crash de getpass.getuser() cuando
    # el UID del host no tiene entrada en /etc/passwd del contenedor.
    # torch._inductor y matplotlib las leen antes de llamar a pwd.getpwuid().
    USER=appuser \
    LOGNAME=appuser \
    HOME=/app \
    POETRY_HOME=/opt/poetry \
    POETRY_VERSION=2.3.3 \
    POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_IN_PROJECT=true \
    MPLCONFIGDIR=/tmp/matplotlib-cache \
    TORCHINDUCTOR_CACHE_DIR=/tmp/torchinductor-cache

# /app/.venv/bin va primero para que 'python' apunte al entorno virtual,
# incluso cuando el contenedor corre con un UID arbitrario sin activar el venv.
ENV PATH="/app/.venv/bin:${POETRY_HOME}/bin:${PATH}"

WORKDIR /app

# Crear directorios de caché con permisos globales para que cualquier UID pueda escribir
RUN mkdir -p /tmp/matplotlib-cache /tmp/torchinductor-cache \
    && chmod 1777 /tmp/matplotlib-cache /tmp/torchinductor-cache \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        libxrender1 \
        libxext6 \
        libx11-6 \
        libexpat1 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --upgrade pip \
    && pip install "poetry==${POETRY_VERSION}"

COPY pyproject.toml poetry.lock* /app/

FROM base AS deps-prod
RUN poetry install --only main --no-root --no-ansi

FROM base AS deps-dev
RUN poetry install --with dev --no-root --no-ansi

FROM deps-dev AS dev

COPY . /app

EXPOSE 8000
CMD ["poetry", "run", "python", "manage.py", "up", "--without-celery", "--host", "0.0.0.0", "--port", "8000"]

FROM deps-prod AS prod
COPY . /app
# Permisos world-readable+executable para que cualquier UID (HOST_UID en compose)
# pueda usar el venv sin que Poetry intente recrearlo con permisos de root.
RUN chmod -R a+rX /app/.venv
CMD ["python", "config/startup_production.py"]

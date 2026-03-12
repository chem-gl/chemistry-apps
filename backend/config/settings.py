"""settings.py: Configuración central de Django para el backend científico.

Objetivo del archivo:
- Definir configuración única de entorno para apps, base de datos, REST,
    OpenAPI, Channels, Celery y políticas operativas del runtime.

Cómo se usa:
- Se carga automáticamente al ejecutar `manage.py`, `celery` y servidores
    ASGI/WSGI mediante `DJANGO_SETTINGS_MODULE=config.settings`.
- La prioridad de valores es: entorno del sistema -> `.env` local -> defaults.
"""

import os
import sys
from importlib.util import find_spec
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured


def _load_dotenv_file(env_file_path: Path) -> None:
    """Carga variables desde un archivo .env local sin sobreescribir entorno existente."""
    if not env_file_path.exists():
        return

    for raw_line in env_file_path.read_text(encoding="utf-8").splitlines():
        line_value: str = raw_line.strip()

        if line_value == "" or line_value.startswith("#"):
            continue

        if "=" not in line_value:
            continue

        key_name, raw_env_value = line_value.split("=", 1)
        normalized_key: str = key_name.strip()
        normalized_value: str = raw_env_value.strip().strip('"').strip("'")

        if normalized_key == "":
            continue

        os.environ.setdefault(normalized_key, normalized_value)


_load_dotenv_file(Path(__file__).resolve().parent.parent / ".env")


def _get_env_bool(variable_name: str, default_value: bool) -> bool:
    """Convierte una variable de entorno textual a booleano de forma segura."""
    raw_value: str = os.getenv(variable_name, str(default_value))
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def _get_env_list(variable_name: str, default_value: list[str]) -> list[str]:
    """Convierte una variable CSV del entorno en lista limpia de strings."""
    raw_value: str = os.getenv(variable_name, "")
    if raw_value.strip() == "":
        return default_value

    parsed_values: list[str] = [
        item.strip() for item in raw_value.split(",") if item.strip() != ""
    ]
    return parsed_values


def _merge_unique_values(
    primary_values: list[str],
    secondary_values: list[str],
) -> list[str]:
    """Une listas preservando orden y removiendo duplicados vacíos."""
    merged_values: list[str] = []

    for candidate_value in [*primary_values, *secondary_values]:
        normalized_candidate: str = candidate_value.strip()
        if normalized_candidate == "":
            continue
        if normalized_candidate in merged_values:
            continue
        merged_values.append(normalized_candidate)

    return merged_values


def _build_openapi_servers(server_urls: list[str]) -> list[dict[str, str]]:
    """Genera definición de servers para OpenAPI a partir de URLs configuradas."""
    servers: list[dict[str, str]] = []

    for raw_url in server_urls:
        normalized_url: str = raw_url.strip()
        if normalized_url == "":
            continue

        description_value: str = "Servidor configurado por entorno"
        if "localhost" in normalized_url:
            description_value = "Entorno local por hostname"
        elif "127.0.0.1" in normalized_url:
            description_value = "Entorno local por loopback"
        elif "0.0.0.0" in normalized_url:
            description_value = "Binding local para pruebas en red"

        servers.append(
            {
                "url": normalized_url,
                "description": description_value,
            }
        )

    return servers


def _get_env_int(variable_name: str, default_value: int) -> int:
    """Convierte una variable de entorno textual a entero seguro."""
    raw_value: str = os.getenv(variable_name, str(default_value)).strip()
    try:
        return int(raw_value)
    except ValueError:
        return default_value


# Construye rutas internas del proyecto desde BASE_DIR.
BASE_DIR = Path(__file__).resolve().parent.parent

# Advertencia de seguridad: en producción usar variables de entorno seguras.
SECRET_KEY = os.getenv(
    "DJANGO_SECRET_KEY",
    "django-insecure-2b^*ofb$##@bx3lg!g=_%%b_r^oy7y5z5p@%$&yatoyufa4=()",
)

# Advertencia de seguridad: desactivar DEBUG en producción.
DEBUG = _get_env_bool("DJANGO_DEBUG", True)

DEFAULT_ALLOWED_HOSTS: list[str] = ["127.0.0.1", "localhost", "0.0.0.0", "[::1]"]
DJANGO_DEBUG_ALLOW_ALL_HOSTS: bool = _get_env_bool(
    "DJANGO_DEBUG_ALLOW_ALL_HOSTS",
    True,
)

ALLOWED_HOSTS: list[str] = _get_env_list(
    "DJANGO_ALLOWED_HOSTS",
    DEFAULT_ALLOWED_HOSTS,
)

if DEBUG and DJANGO_DEBUG_ALLOW_ALL_HOSTS and "*" not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append("*")

ENABLE_CORS = _get_env_bool("ENABLE_CORS", False)
CORS_PACKAGE_INSTALLED = find_spec("corsheaders") is not None

if ENABLE_CORS and not CORS_PACKAGE_INSTALLED:
    raise ImproperlyConfigured(
        "ENABLE_CORS=true requiere instalar el paquete 'django-cors-headers'."
    )


# Definición de aplicaciones instaladas.

INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "channels",
    "rest_framework",
    "drf_spectacular",
    "apps.core",
    "apps.calculator.apps.CalculatorConfig",
    "apps.random_numbers.apps.RandomNumbersConfig",
    "apps.molar_fractions.apps.MolarFractionsConfig",
    "apps.tunnel.apps.TunnelConfig",
    "apps.easy_rate.apps.EasyRateConfig",
    "apps.marcus.apps.MarcusConfig",
]

if ENABLE_CORS:
    INSTALLED_APPS.insert(0, "corsheaders")

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

DEFAULT_OPENAPI_SERVER_URLS: list[str] = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
OPENAPI_SERVER_URLS: list[str] = _get_env_list(
    "OPENAPI_SERVER_URLS",
    DEFAULT_OPENAPI_SERVER_URLS,
)

OPENAPI_TITLE: str = os.getenv(
    "OPENAPI_TITLE",
    "Chemistry Apps API",
)
OPENAPI_VERSION: str = os.getenv("OPENAPI_VERSION", "1.0.0")
OPENAPI_DESCRIPTION: str = os.getenv(
    "OPENAPI_DESCRIPTION",
    (
        "API de plataforma científica modular para ejecutar jobs asíncronos "
        "por plugins (calculator, random-numbers y molar-fractions), con observabilidad de progreso "
        "y logs en tiempo real, cache por hash y recuperación activa automática."
    ),
)
OPENAPI_CONTACT_NAME: str = os.getenv("OPENAPI_CONTACT_NAME", "Chemistry Apps Team")
OPENAPI_CONTACT_URL: str = os.getenv(
    "OPENAPI_CONTACT_URL",
    "https://github.com/chem-gl/chemistry-apps",
)
OPENAPI_LICENSE_NAME: str = os.getenv("OPENAPI_LICENSE_NAME", "MIT")
OPENAPI_LICENSE_URL: str = os.getenv(
    "OPENAPI_LICENSE_URL",
    "https://opensource.org/license/mit/",
)

SPECTACULAR_SETTINGS = {
    "TITLE": OPENAPI_TITLE,
    "DESCRIPTION": OPENAPI_DESCRIPTION,
    "VERSION": OPENAPI_VERSION,
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SORT_OPERATIONS": True,
    "SCHEMA_PATH_PREFIX": r"/api",
    "SERVERS": _build_openapi_servers(OPENAPI_SERVER_URLS),
    "TAGS": [
        {
            "name": "Jobs",
            "description": "Operaciones genéricas para consulta, progreso, eventos SSE y logs de jobs.",
        },
        {
            "name": "Calculator",
            "description": "Endpoints de ejecución para operaciones matemáticas de calculadora científica.",
        },
        {
            "name": "RandomNumbers",
            "description": "Endpoints de generación por lotes de números aleatorios con semilla externa.",
        },
        {
            "name": "MolarFractions",
            "description": "Endpoints para cálculo asíncrono de fracciones molares en equilibrio ácido-base.",
        },
        {
            "name": "Tunnel",
            "description": (
                "Endpoints para cálculo del efecto túnel con teoría de Eckart "
                "asimétrica y trazabilidad de cambios de entrada."
            ),
        },
        {
            "name": "EasyRate",
            "description": (
                "Endpoints para cinética Easy-rate con carga de archivos Gaussian "
                "y persistencia de entradas para reproducibilidad."
            ),
        },
        {
            "name": "Marcus",
            "description": (
                "Endpoints para cinética por modelo Marcus con carga multipart "
                "y persistencia de entradas reproducibles."
            ),
        },
    ],
    "CONTACT": {
        "name": OPENAPI_CONTACT_NAME,
        "url": OPENAPI_CONTACT_URL,
    },
    "LICENSE": {
        "name": OPENAPI_LICENSE_NAME,
        "url": OPENAPI_LICENSE_URL,
    },
    "ENUM_NAME_OVERRIDES": {
        "CalculatorOperationEnum": [
            ("add", "add"),
            ("sub", "sub"),
            ("mul", "mul"),
            ("div", "div"),
            ("pow", "pow"),
            ("factorial", "factorial"),
        ],
        "JobStatusEnum": [
            ("pending", "Pending"),
            ("running", "Running"),
            ("paused", "Paused"),
            ("completed", "Completed"),
            ("failed", "Failed"),
        ],
        "JobProgressStageEnum": [
            ("pending", "pending"),
            ("queued", "queued"),
            ("running", "running"),
            ("paused", "paused"),
            ("recovering", "recovering"),
            ("caching", "caching"),
            ("completed", "completed"),
            ("failed", "failed"),
        ],
        "LevelEnum": [
            ("debug", "debug"),
            ("info", "info"),
            ("warning", "warning"),
            ("error", "error"),
        ],
    },
}

# Opciones de configuración de Celery.
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.getenv(
    "CELERY_RESULT_BACKEND",
    "redis://localhost:6379/0",
)

JOB_RECOVERY_ENABLED = _get_env_bool("JOB_RECOVERY_ENABLED", True)
JOB_RECOVERY_STALE_SECONDS = max(5, _get_env_int("JOB_RECOVERY_STALE_SECONDS", 60))
JOB_RECOVERY_MAX_ATTEMPTS = max(1, _get_env_int("JOB_RECOVERY_MAX_ATTEMPTS", 5))
JOB_RECOVERY_INCLUDE_PENDING = _get_env_bool("JOB_RECOVERY_INCLUDE_PENDING", True)


MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

if ENABLE_CORS:
    MIDDLEWARE.insert(1, "corsheaders.middleware.CorsMiddleware")

ROOT_URLCONF = "config.urls"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


CHANNEL_LAYERS_REDIS_URL = os.getenv(
    "CHANNEL_LAYERS_REDIS_URL",
    CELERY_BROKER_URL,
)
USE_INMEMORY_CHANNEL_LAYER = _get_env_bool(
    "USE_INMEMORY_CHANNEL_LAYER",
    "test" in sys.argv,
)

if USE_INMEMORY_CHANNEL_LAYER:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        }
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [CHANNEL_LAYERS_REDIS_URL],
            },
        }
    }


# Base de datos configurable por entorno, con fallback a SQLite para local.

database_engine: str = os.getenv("DB_ENGINE", "sqlite").strip().lower()

if database_engine in {"postgres", "postgresql"}:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("DB_NAME", "chemistry_db"),
            "USER": os.getenv("DB_USER", "postgres"),
            "PASSWORD": os.getenv("DB_PASSWORD", "postgres"),
            "HOST": os.getenv("DB_HOST", "127.0.0.1"),
            "PORT": os.getenv("DB_PORT", "5432"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

# Configuración CORS para frontends permitidos.
CORS_ALLOW_ALL_ORIGINS = _get_env_bool("CORS_ALLOW_ALL_ORIGINS", False)
CORS_ALLOW_CREDENTIALS = _get_env_bool("CORS_ALLOW_CREDENTIALS", True)

DEFAULT_CORS_ALLOWED_ORIGINS: list[str] = [
    "http://localhost:4200",
    "http://127.0.0.1:4200",
    "http://0.0.0.0:4200",
]

CORS_ALLOWED_ORIGINS: list[str] = _get_env_list(
    "CORS_ALLOWED_ORIGINS",
    DEFAULT_CORS_ALLOWED_ORIGINS,
)

CORS_ALLOWED_ORIGIN_REGEXES: list[str] = _get_env_list(
    "CORS_ALLOWED_ORIGIN_REGEXES",
    [r"^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?$"],
)

CSRF_TRUSTED_ORIGINS: list[str] = _merge_unique_values(
    _get_env_list(
        "CSRF_TRUSTED_ORIGINS",
        ["http://localhost:4200", "http://127.0.0.1:4200", "http://0.0.0.0:4200"],
    ),
    CORS_ALLOWED_ORIGINS,
)


# Validadores de contraseña.

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


# Internacionalización.

LANGUAGE_CODE = "en-us"

TIME_ZONE = "UTC"

USE_I18N = True

USE_TZ = True


# Archivos estáticos.

STATIC_URL = "static/"

# Archivos de medios.
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# Estructura persistente de almacenamiento para jobs científicos.
JOBS_STORAGE_DIRS = {
    "inputs": MEDIA_ROOT / "inputs",
    "outputs": MEDIA_ROOT / "outputs",
    "cache": MEDIA_ROOT / "cache",
    "temporary": MEDIA_ROOT / "temporary",
}

for _, storage_dir in JOBS_STORAGE_DIRS.items():
    storage_dir.mkdir(parents=True, exist_ok=True)

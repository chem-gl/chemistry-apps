"""settings.py: Configuración central de Django para el backend científico."""

import os
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


# Construye rutas internas del proyecto desde BASE_DIR.
BASE_DIR = Path(__file__).resolve().parent.parent

# Advertencia de seguridad: en producción usar variables de entorno seguras.
SECRET_KEY = os.getenv(
    "DJANGO_SECRET_KEY",
    "django-insecure-2b^*ofb$##@bx3lg!g=_%%b_r^oy7y5z5p@%$&yatoyufa4=()",
)

# Advertencia de seguridad: desactivar DEBUG en producción.
DEBUG = _get_env_bool("DJANGO_DEBUG", True)

ALLOWED_HOSTS = _get_env_list(
    "DJANGO_ALLOWED_HOSTS",
    ["127.0.0.1", "localhost"],
)

ENABLE_CORS = _get_env_bool("ENABLE_CORS", False)
CORS_PACKAGE_INSTALLED = find_spec("corsheaders") is not None

if ENABLE_CORS and not CORS_PACKAGE_INSTALLED:
    raise ImproperlyConfigured(
        "ENABLE_CORS=true requiere instalar el paquete 'django-cors-headers'."
    )


# Definición de aplicaciones instaladas.

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "apps.core",
    "apps.calculator.apps.CalculatorConfig",
]

if ENABLE_CORS:
    INSTALLED_APPS.insert(0, "corsheaders")

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Plataforma Científica Modular API",
    "DESCRIPTION": "API para plataforma científica ejecutable estructurada a través de plugins.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
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
            ("completed", "Completed"),
            ("failed", "Failed"),
        ],
        "JobProgressStageEnum": [
            ("pending", "pending"),
            ("queued", "queued"),
            ("running", "running"),
            ("caching", "caching"),
            ("completed", "completed"),
            ("failed", "failed"),
        ],
    },
}

# Opciones de configuración de Celery.
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.getenv(
    "CELERY_RESULT_BACKEND",
    "redis://localhost:6379/0",
)


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
CORS_ALLOWED_ORIGINS = _get_env_list(
    "CORS_ALLOWED_ORIGINS",
    ["http://localhost:4200", "http://127.0.0.1:4200"],
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

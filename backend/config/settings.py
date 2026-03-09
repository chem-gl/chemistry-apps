"""settings.py: Configuración central de Django para el backend científico."""

from pathlib import Path

# Construye rutas internas del proyecto desde BASE_DIR.
BASE_DIR = Path(__file__).resolve().parent.parent

# Advertencia de seguridad: en producción usar variables de entorno seguras.
SECRET_KEY = "django-insecure-2b^*ofb$##@bx3lg!g=_%%b_r^oy7y5z5p@%$&yatoyufa4=()"

# Advertencia de seguridad: desactivar DEBUG en producción.
DEBUG = True

ALLOWED_HOSTS = []


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
        ]
    },
}

# Opciones de configuración de Celery.
CELERY_BROKER_URL = "redis://localhost:6379/0"
CELERY_RESULT_BACKEND = "redis://localhost:6379/0"


MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

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


# Base de datos para entorno local de desarrollo.

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}


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

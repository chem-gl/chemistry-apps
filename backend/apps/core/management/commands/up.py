"""up.py: Comando para levantar Django y Celery en paralelo para desarrollo.

Objetivo del archivo:
- Facilitar un arranque local productivo del backend con un solo comando,
  coordinando `runserver`, `celery worker` y disponibilidad del broker.

Cómo se usa:
- Flujo completo: `python manage.py up`.
- Solo API HTTP: `python manage.py up --without-celery`.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
from pathlib import Path
from time import sleep
from urllib.parse import urlparse

from django.core.management.base import BaseCommand, CommandError, CommandParser


class Command(BaseCommand):
    """Inicia servicios locales necesarios para desarrollo del backend."""

    help = "Levanta runserver y celery worker juntos usando el mismo entorno Python."

    def add_arguments(self, parser: CommandParser) -> None:
        """Define opciones del comando para host, puerto y worker."""
        parser.add_argument(
            "--host",
            default="0.0.0.0",
            help="Host para runserver (default: 0.0.0.0)",
        )
        parser.add_argument(
            "--port",
            default="8000",
            help="Puerto para runserver (default: 8000)",
        )
        parser.add_argument(
            "--celery-loglevel",
            default="info",
            help="Nivel de logs para celery worker (default: info)",
        )
        parser.add_argument(
            "--without-celery",
            action="store_true",
            help="Levanta solo Django runserver sin iniciar worker Celery.",
        )

    def handle(self, *args, **options) -> None:
        """Orquesta inicio y cierre coordinado de runserver y celery."""
        backend_root_path: Path = self._resolve_backend_root_path()
        python_executable_path: str = sys.executable

        host_value: str = str(options["host"])
        port_value: str = str(options["port"])
        celery_loglevel_value: str = str(options["celery_loglevel"])
        run_without_celery: bool = bool(options["without_celery"])

        runserver_command: list[str] = [
            python_executable_path,
            "manage.py",
            "runserver",
            f"{host_value}:{port_value}",
        ]

        redis_process: subprocess.Popen[bytes] | None = None
        celery_process: subprocess.Popen[bytes] | None = None
        runserver_process: subprocess.Popen[bytes] | None = None

        try:
            if not run_without_celery:
                broker_url: str = self._get_celery_broker_url()
                if not self._is_broker_reachable(broker_url):
                    if not self._is_redis_broker_url(broker_url):
                        raise CommandError(
                            "El broker de Celery no está disponible y no es Redis. "
                            "Configura un broker accesible o usa --without-celery."
                        )

                    self.stdout.write(
                        self.style.WARNING(
                            "Broker Redis no disponible. Intentando iniciar "
                            "redis-server automáticamente..."
                        )
                    )
                    redis_process = self._start_redis_server(backend_root_path)

                    broker_is_ready: bool = self._wait_for_broker_reachable(
                        broker_url,
                        timeout_seconds=8.0,
                    )
                    if not broker_is_ready:
                        raise CommandError(
                            "Redis fue iniciado pero no estuvo disponible a tiempo. "
                            "Revisa el puerto/configuración y vuelve a intentar."
                        )

                    self.stdout.write(
                        self.style.SUCCESS("Redis server iniciado correctamente.")
                    )

            if not run_without_celery:
                celery_command: list[str] = [
                    python_executable_path,
                    "-m",
                    "celery",
                    "-A",
                    "config",
                    "worker",
                    "-l",
                    celery_loglevel_value,
                ]
                celery_process = subprocess.Popen(
                    celery_command,
                    cwd=backend_root_path,
                )
                sleep(0.8)

                celery_return_code: int | None = celery_process.poll()
                if celery_return_code is not None:
                    raise CommandError(
                        "Celery worker terminó inmediatamente. "
                        "Revisa que Redis esté activo y dependencias instaladas."
                    )

                self.stdout.write(
                    self.style.SUCCESS(
                        "Celery worker iniciado. "
                        "Presiona Ctrl+C para detener ambos procesos."
                    )
                )

            runserver_process = subprocess.Popen(
                runserver_command,
                cwd=backend_root_path,
            )
            public_url: str = self._build_public_runserver_url(host_value, port_value)
            self.stdout.write(self.style.SUCCESS(f"Runserver iniciado en {public_url}"))

            runserver_return_code: int = runserver_process.wait()
            if runserver_return_code != 0:
                raise CommandError(
                    f"Runserver finalizó con código {runserver_return_code}."
                )
        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("Deteniendo servicios..."))
        finally:
            self._stop_process(runserver_process, process_name="runserver")
            self._stop_process(celery_process, process_name="celery worker")
            self._stop_process(redis_process, process_name="redis server")

    def _resolve_backend_root_path(self) -> Path:
        """Resuelve la raíz backend detectando manage.py de forma robusta."""
        current_file_path: Path = Path(__file__).resolve()

        for parent_path in current_file_path.parents:
            manage_file_path: Path = parent_path / "manage.py"
            config_directory_path: Path = parent_path / "config"
            if manage_file_path.exists() and config_directory_path.is_dir():
                return parent_path

        raise CommandError(
            "No se pudo resolver la raíz del backend para ejecutar runserver/celery."
        )

    def _get_celery_broker_url(self) -> str:
        """Obtiene URL del broker desde entorno con valor por defecto local."""
        return os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")

    def _is_redis_broker_url(self, broker_url: str) -> bool:
        """Indica si la URL del broker usa esquema Redis/Rediss."""
        parsed_broker_url = urlparse(broker_url)
        return parsed_broker_url.scheme in {"redis", "rediss"}

    def _is_broker_reachable(self, broker_url: str) -> bool:
        """Verifica conectividad TCP básica al host/puerto del broker."""
        parsed_broker_url = urlparse(broker_url)
        broker_host: str | None = parsed_broker_url.hostname
        broker_port: int | None = parsed_broker_url.port

        if broker_host is None:
            return False

        resolved_port: int = broker_port if broker_port is not None else 6379

        try:
            with socket.create_connection((broker_host, resolved_port), timeout=1.0):
                return True
        except OSError:
            return False

    def _wait_for_broker_reachable(
        self,
        broker_url: str,
        timeout_seconds: float,
    ) -> bool:
        """Espera hasta que el broker esté disponible o venza el timeout."""
        poll_interval_seconds: float = 0.5
        retries_count: int = int(timeout_seconds / poll_interval_seconds)

        for _ in range(retries_count):
            if self._is_broker_reachable(broker_url):
                return True
            sleep(poll_interval_seconds)

        return self._is_broker_reachable(broker_url)

    def _start_redis_server(self, backend_root_path: Path) -> subprocess.Popen[bytes]:
        """Inicia redis-server/valkey-server local para entorno de desarrollo."""
        redis_process: subprocess.Popen[bytes] | None = None
        last_not_found_error: FileNotFoundError | None = None

        for candidate_command in self._redis_server_command_candidates():
            try:
                redis_process = subprocess.Popen(
                    [candidate_command],
                    cwd=backend_root_path,
                )
                break
            except FileNotFoundError as command_not_found_error:
                last_not_found_error = command_not_found_error

        if redis_process is None:
            raise CommandError(
                "No se encontró ni 'redis-server' ni 'valkey-server'. "
                "Instala Redis/Valkey o usa --without-celery."
            ) from last_not_found_error

        sleep(0.4)
        redis_return_code: int | None = redis_process.poll()
        if redis_return_code is not None:
            raise CommandError(
                "redis-server terminó inmediatamente. Revisa su instalación "
                "o conflictos de puerto."
            )

        return redis_process

    def _redis_server_command_candidates(self) -> tuple[str, ...]:
        """Comandos candidatos para levantar un servidor compatible Redis."""
        return ("redis-server", "valkey-server")

    def _build_public_runserver_url(self, host_value: str, port_value: str) -> str:
        """Construye URL de acceso amigable para localhost o binding abierto."""
        if host_value == "0.0.0.0":
            return f"http://localhost:{port_value}/ (bind 0.0.0.0)"
        return f"http://{host_value}:{port_value}/"

    def _stop_process(
        self,
        process: subprocess.Popen[bytes] | None,
        process_name: str,
    ) -> None:
        """Detiene de forma segura un proceso hijo si sigue activo."""
        if process is None:
            return

        return_code: int | None = process.poll()
        if return_code is not None:
            return

        process.terminate()
        try:
            process.wait(timeout=10)
            self.stdout.write(self.style.WARNING(f"{process_name} detenido."))
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
            self.stdout.write(
                self.style.WARNING(
                    f"{process_name} no respondió y fue terminado forzosamente."
                )
            )

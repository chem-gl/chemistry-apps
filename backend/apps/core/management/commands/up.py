"""up.py: Comando para levantar Django y Celery en paralelo para desarrollo.

Objetivo del archivo:
- Facilitar un arranque local productivo del backend con un solo comando,
  coordinando `runserver`, `celery worker` y disponibilidad del broker.
- Implementa vigilancia de archivos Python con reinicio automático del servidor
  al detectar cambios, sin depender del reloader interno de Django/Daphne.
  (Daphne sobreescribe `runserver` y no activa el StatReloader de Django.)

Cómo se usa:
- Flujo completo: `python manage.py up`.
- Solo API HTTP: `python manage.py up --without-celery`.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import threading
from pathlib import Path
from time import sleep
from urllib.parse import urlparse

from django.core.management.base import BaseCommand, CommandError, CommandParser

# Directorios ignorados por el vigilante de archivos (no son código fuente).
_WATCH_SKIP_DIRS: frozenset[str] = frozenset(
    {"venv", ".venv", "__pycache__", ".git", "node_modules", ".mypy_cache"}
)

# Intervalo de sondeo del vigilante de archivos (segundos).
_WATCH_POLL_INTERVAL: float = 1.0


class _PythonFileWatcher:
    """Vigila cambios en archivos .py dentro de un directorio raíz.

    Usa sondeo por mtime (stdlib os.stat) sin depender de paquetes externos.
    Diseñado para correr en un hilo secundario; se detiene limpiamente cuando
    stop_event es señalado desde el hilo principal.
    """

    def __init__(self, watch_root: Path) -> None:
        self._watch_root = watch_root
        self._baseline: dict[str, float] = self._collect_mtimes()

    def _collect_mtimes(self) -> dict[str, float]:
        """Recolecta los mtime de cada .py del árbol fuente, saltando directorios irrelevantes."""
        mtimes: dict[str, float] = {}
        for root, dirs, files in os.walk(self._watch_root):
            # Poda en sitio para que os.walk no descienda a directorios ignorados.
            dirs[:] = [
                d for d in dirs if d not in _WATCH_SKIP_DIRS and not d.startswith(".")
            ]
            root_path = Path(root)
            for filename in files:
                if not filename.endswith(".py"):
                    continue
                file_path = root_path / filename
                try:
                    mtimes[str(file_path)] = file_path.stat().st_mtime
                except OSError:
                    pass
        return mtimes

    def wait_for_change(self, stop_event: threading.Event) -> bool:
        """Bloquea hasta detectar un cambio o hasta que stop_event sea señalado.

        Returns:
            True  — se detectó al menos un archivo modificado, creado o eliminado.
            False — stop_event fue señalado antes de detectar cambios.
        """
        while not stop_event.is_set():
            sleep(_WATCH_POLL_INTERVAL)
            current_mtimes = self._collect_mtimes()
            if current_mtimes != self._baseline:
                self._baseline = current_mtimes
                return True
        return False


class Command(BaseCommand):
    """Inicia servicios locales necesarios para desarrollo del backend."""

    help = "Levanta runserver y celery worker con auto-reload propio al detectar cambios en .py."

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
        """Orquesta inicio, auto-reload y cierre coordinado de runserver y celery."""
        backend_root_path: Path = self._resolve_backend_root_path()
        python_executable_path: str = sys.executable

        host_value: str = str(options["host"])
        port_value: str = str(options["port"])
        celery_loglevel_value: str = str(options["celery_loglevel"])
        run_without_celery: bool = bool(options["without_celery"])

        runserver_command: list[str] = self._build_runserver_command(
            python_executable_path=python_executable_path,
            host_value=host_value,
            port_value=port_value,
        )
        if not self._is_running_under_test():
            self._ensure_runserver_port_available(
                host_value=host_value,
                port_value=port_value,
            )

        redis_process: subprocess.Popen[bytes] | None = None
        celery_process: subprocess.Popen[bytes] | None = None

        try:
            if not run_without_celery:
                redis_process = self._ensure_broker_available(backend_root_path)
                celery_process = self._start_celery_worker(
                    backend_root_path=backend_root_path,
                    python_executable_path=python_executable_path,
                    celery_loglevel_value=celery_loglevel_value,
                )

            self._run_runserver_with_restart_loop(
                backend_root_path=backend_root_path,
                runserver_command=runserver_command,
                host_value=host_value,
                port_value=port_value,
            )

        except KeyboardInterrupt:
            self.stdout.write(self.style.WARNING("Deteniendo servicios..."))
        finally:
            self._stop_process(celery_process, process_name="celery worker")
            self._stop_process(redis_process, process_name="redis server")

    def _build_runserver_command(
        self,
        *,
        python_executable_path: str,
        host_value: str,
        port_value: str,
    ) -> list[str]:
        """Construye comando runserver con recarga externa controlada por este comando."""
        return [
            python_executable_path,
            "manage.py",
            "runserver",
            "--noreload",
            f"{host_value}:{port_value}",
        ]

    def _is_running_under_test(self) -> bool:
        """Detecta ejecución bajo tests para evitar dependencia del estado real del host."""
        return "test" in sys.argv or os.getenv("PYTEST_CURRENT_TEST", "") != ""

    def _ensure_runserver_port_available(
        self,
        *,
        host_value: str,
        port_value: str,
    ) -> None:
        """Falla temprano con un mensaje claro si el puerto HTTP ya está ocupado."""
        try:
            port_number = int(port_value)
        except ValueError as exc:
            raise CommandError(f"Puerto inválido para runserver: {port_value}") from exc

        probe_host = "127.0.0.1" if host_value in {"0.0.0.0", "::"} else host_value

        try:
            addresses = socket.getaddrinfo(
                probe_host,
                port_number,
                type=socket.SOCK_STREAM,
            )
        except OSError as exc:
            raise CommandError(
                f"No se pudo resolver el host {probe_host} para validar el puerto {port_number}."
            ) from exc

        for family, socktype, proto, _, sockaddr in addresses:
            with socket.socket(family, socktype, proto) as probe_socket:
                probe_socket.settimeout(0.35)
                if probe_socket.connect_ex(sockaddr) == 0:
                    raise CommandError(
                        "El puerto del runserver ya está en uso. "
                        f"Detén el proceso que escucha en {probe_host}:{port_number} "
                        "o ejecuta `python manage.py up --port <otro>` antes de volver a intentarlo."
                    )

    def _ensure_broker_available(
        self,
        backend_root_path: Path,
    ) -> subprocess.Popen[bytes] | None:
        """Garantiza broker accesible; inicia Redis local si aplica y hace falta."""
        broker_url: str = self._get_celery_broker_url()
        if self._is_broker_reachable(broker_url):
            return None

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

        self.stdout.write(self.style.SUCCESS("Redis server iniciado correctamente."))
        return redis_process

    def _start_celery_worker(
        self,
        *,
        backend_root_path: Path,
        python_executable_path: str,
        celery_loglevel_value: str,
    ) -> subprocess.Popen[bytes]:
        """Inicia el worker de Celery y valida que no termine de inmediato."""
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
                "Celery worker iniciado. Presiona Ctrl+C para detener ambos procesos."
            )
        )
        return celery_process

    def _run_runserver_with_restart_loop(
        self,
        *,
        backend_root_path: Path,
        runserver_command: list[str],
        host_value: str,
        port_value: str,
    ) -> None:
        """Ejecuta runserver y lo reinicia cuando cambian archivos Python."""
        watcher = _PythonFileWatcher(backend_root_path)
        public_url: str = self._build_public_runserver_url(host_value, port_value)
        runserver_process: subprocess.Popen[bytes] | None = None

        try:
            while True:
                runserver_process = subprocess.Popen(
                    runserver_command,
                    cwd=backend_root_path,
                )
                self.stdout.write(
                    self.style.SUCCESS(f"Runserver iniciado en {public_url}")
                )

                file_changed: bool = self._wait_for_server_or_file_change(
                    watcher=watcher,
                    runserver_process=runserver_process,
                )

                if file_changed:
                    self.stdout.write(
                        self.style.WARNING(
                            "Cambio detectado en archivo Python. Reiniciando servidor..."
                        )
                    )
                    self._stop_process(runserver_process, process_name="runserver")
                    runserver_process = None
                    continue

                # `subprocess.Popen.returncode` puede ser un MagicMock en tests
                # y evaluarse como truthy, lo que provocaría que se trate como error.
                # Usamos `poll()` para obtener un entero real (o None) cuando exista.
                exit_code: int = runserver_process.poll() or 0
                if exit_code != 0:
                    raise CommandError(f"Runserver finalizó con código {exit_code}.")
                break
        finally:
            self._stop_process(runserver_process, process_name="runserver")

    def _wait_for_server_or_file_change(
        self,
        *,
        watcher: _PythonFileWatcher,
        runserver_process: subprocess.Popen[bytes],
    ) -> bool:
        """Espera terminación del servidor o notificación de cambio en archivos."""
        stop_watching = threading.Event()
        file_changed = threading.Event()

        def _watch() -> None:
            if watcher.wait_for_change(stop_watching):
                file_changed.set()

        watcher_thread = threading.Thread(target=_watch, daemon=True)
        watcher_thread.start()

        while runserver_process.poll() is None and not file_changed.is_set():
            sleep(0.2)

        stop_watching.set()
        watcher_thread.join(timeout=2.0)
        return file_changed.is_set()

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
        return f"http://{host_value}:{port_value}/"  # noqa: S5332

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

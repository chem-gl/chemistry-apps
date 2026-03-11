"""declarative_api_usage_examples.py: Ejemplos de uso de DeclarativeJobAPI.

Este archivo documenta cómo consumir la API declarativa desde diferentes contextos:
- Routers HTTP
- Management commands
- Workers (Celery tasks)
- Scripts externos
"""

from __future__ import annotations

from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.types import DomainError

# ========== EJEMPLO 1: Router HTTP (Consumo mediante HTTP) ==========
# Ubicación: apps/calculator/routers.py o similar

def example_router_usage() -> None:
    """
    Router HTTP usando DeclarativeJobAPI (opcional).
    
    IMPORTANTE: Los routers HTTP actuales usan JobService directamente.
    Esto es un ejemplo de cómo podrían usar la API declarativa.
    """
    from rest_framework.decorators import api_view
    from rest_framework.response import Response

    @api_view(["POST"])
    def submit_calculation_job(request) -> Response:
        """Endpoint POST para enviar job de calculadora."""
        api = DeclarativeJobAPI()
        plugin_name = "calculator"
        parameters = request.data.get("parameters", {})
        version = "1.0"

        # Crear task (evaluación perezosa)
        task = api.submit_job(plugin_name, parameters, version)

        # Ejecutar task (realmente enviar a Celery)
        result = task.run()

        # Usar fold para procesar resultado uniformemente
        def on_success(handle) -> dict:
            return {
                "job_id": handle.job_id,
                "status": handle.status,
                "message": "Job submitted successfully",
            }

        def on_failure(error: DomainError) -> dict:
            return {
                "error": str(error.__class__.__name__),
                "message": str(error),
                "details": getattr(error, "details", {}),
            }

        response_data = result.fold(
            on_failure=on_failure,
            on_success=on_success,
        )
        return Response(response_data)

    @api_view(["POST"])
    def submit_and_wait_calculation(request) -> Response:
        """Endpoint POST para enviar y esperar resultado."""
        api = DeclarativeJobAPI()
        plugin_name = "calculator"
        parameters = request.data.get("parameters", {})
        timeout_seconds = int(request.data.get("timeout", 30))

        # Crear task de espera sincrónica
        task = api.submit_and_wait(plugin_name, parameters, timeout_seconds)

        # Ejecutar (bloquea hasta que job termine o timeout)
        result = task.run()

        # Procesar resultado
        if result.is_success():
            output = result.get_or_else({})
            return Response(
                {"result": output, "status": "completed"},
                status=200,
            )
        else:
            # Obtener error (usando acceso a atributo privado como fallback)
            return Response(
                {"error": "Job failed or timed out"},
                status=400,
            )

    print("✓ Router examples defined (not executed)")


# ========== EJEMPLO 2: Management Command ==========
# Ubicación: apps/core/management/commands/run_job.py

def example_management_command() -> None:
    """Management command para ejecutar jobs desde CLI."""
    from django.core.management.base import BaseCommand
    from apps.core.declarative_api import DeclarativeJobAPI
    import json

    class Command(BaseCommand):
        """Ejecutar scientific job desde línea de comandos."""

        help = "Ejecutar un job scientific mediante DeclarativeJobAPI"

        def add_arguments(self, parser) -> None:
            parser.add_argument("plugin", type=str, help="Nombre del plugin")
            parser.add_argument(
                "--parameters",
                type=str,
                default="{}",
                help="JSON con parámetros",
            )
            parser.add_argument(
                "--timeout",
                type=int,
                default=60,
                help="Timeout en segundos (para wait)",
            )
            parser.add_argument(
                "--wait",
                action="store_true",
                help="Esperar resultado sincrónico",
            )

        def handle(self, *args, **options) -> None:
            api = DeclarativeJobAPI()
            plugin_name = options["plugin"]
            parameters = json.loads(options["parameters"])
            timeout_seconds = options["timeout"]
            wait_result = options["wait"]

            self.stdout.write(f"Ejecutando {plugin_name}...")

            if wait_result:
                # Esperar resultado
                task = api.submit_and_wait(
                    plugin_name,
                    parameters,
                    timeout_seconds,
                )
                result = task.run()

                if result.is_success():
                    output = result.get_or_else({})
                    self.stdout.write(self.style.SUCCESS(f"✓ Resultado: {output}"))
                else:
                    self.stdout.write(self.style.ERROR("✗ Job falló"))
            else:
                # No esperar
                task = api.submit_job(plugin_name, parameters, "1.0")
                result = task.run()

                if result.is_success():
                    handle = result.get_or_else(None)
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"✓ Job enviado: {handle.job_id} ({handle.status})"
                        )
                    )
                else:
                    self.stdout.write(self.style.ERROR("✗ Error al enviar job"))

    print("✓ Management command example defined")


# ========== EJEMPLO 3: Consumidor Externo (e.g., cliente de otro sistema) ==========
# Ubicación: scripts externos, servicios remotos, etc.

def example_external_consumption() -> None:
    """
    Consumidor externo que interactúa con la API declarativa.
    
    Esto puede ser:
    - Un script Python separado
    - Un servicio remoto
    - Un worker de otro dominio
    """

    def fetch_job_handle_and_wait(job_id: int) -> dict:
        """Obtener handle y esperar resultado."""
        from apps.core.declarative_api import DeclarativeJobAPI
        from apps.core.types import JobTimeoutError

        api = DeclarativeJobAPI()

        # Obtener handle del job
        handle_result = api.get_job_handle(job_id)

        # Validar que el handle existe
        if handle_result.is_failure():
            return {
                "success": False,
                "error": "Job not found",
            }

        handle = handle_result.get_or_else(None)

        # Esperar resultado con timeout
        result = handle.wait_for_terminal(timeout_seconds=120)

        # Procesar resultado uniformemente
        return result.fold(
            on_failure=lambda err: {
                "success": False,
                "error": f"{err.__class__.__name__}: {str(err)}",
            },
            on_success=lambda output: {
                "success": True,
                "result": output,
            },
        )

    def list_running_jobs(plugin_name: str) -> dict:
        """Listar todos los jobs en ejecución de un plugin."""
        from apps.core.declarative_api import DeclarativeJobAPI

        api = DeclarativeJobAPI()

        result = api.list_jobs(plugin_name=plugin_name, status="RUNNING")

        return result.fold(
            on_failure=lambda err: {"success": False, "error": str(err)},
            on_success=lambda data: {
                "success": True,
                "running_jobs": data.get("items", []),
            },
        )

    print("✓ External consumption examples defined")


# ========== EJEMPLO 4: Composición Funcional de Tasks ==========
# Ubicación: Cualquier consumidor que quiera componer múltiples operaciones

def example_functional_composition() -> None:
    """
    Demostración de composición funcional de Tasks.
    
    Esto es útil para workflows complejos donde se encadenan operaciones.
    """

    def workflow_sequential_jobs() -> None:
        from apps.core.declarative_api import DeclarativeJobAPI
        from apps.core.types import Task

        api = DeclarativeJobAPI()

        # Definir tareas
        def create_calculator_task() -> Task:
            return api.submit_job("calculator", {"op": "add", "a": 2, "b": 3}, "1.0")

        def create_random_task() -> Task:
            return api.submit_job(
                "random_numbers",
                {"count": 10, "min": 1, "max": 100},
                "1.0",
            )

        # Componer tasks (evaluación perezosa)
        # Nota: Task.flat_map permite encadenar sin ejecutar hasta .run()
        def workflow() -> Task:
            # Enviar calculator, obtener handle, y luego enviar random_numbers
            return create_calculator_task().flat_map(
                lambda handle1: (
                    api.submit_job(
                        "random_numbers",
                        {"count": handle1.get_progress()["status"]},
                        "1.0",
                    )
                    if "COMPLETED" in handle1.status
                    else api.submit_job("random_numbers", {"count": 5}, "1.0")
                )
            )

        # Ejecutar workflow
        result = workflow().run()

        print(f"Workflow result: {result.fold(on_failure=lambda e: str(e), on_success=lambda r: r.job_id)}")

    print("✓ Functional composition example defined")


# ========== EJEMPLO 5: Patrón de Recuperación y Retry ==========
# Ubicación: Consumidores que necesitan manejo robusto de errores

def example_resilient_consumption() -> None:
    """
    Patrón para consumidores que usan recover() y retry lógico.
    """

    def resilient_submit_with_retry(
        plugin: str,
        parameters: dict,
        max_retries: int = 3,
    ) -> dict:
        from apps.core.declarative_api import DeclarativeJobAPI
        from apps.core.types import DomainError

        api = DeclarativeJobAPI()

        for attempt in range(max_retries):
            task = api.submit_job(plugin, parameters, "1.0")
            result = task.run()

            # Usar recover para transformar error a valor default
            recovered = result.recover(lambda err: None)

            if recovered.is_success():
                handle = recovered.get_or_else(None)
                return {
                    "success": True,
                    "job_id": handle.job_id if handle else None,
                    "attempt": attempt + 1,
                }

            # Si falla, loguear y reintentar
            print(f"Attempt {attempt + 1} failed, retrying...")

        return {
            "success": False,
            "error": "Max retries reached",
            "attempts": max_retries,
        }

    print("✓ Resilient consumption example defined")


# ========== EJECUCIÓN DE EJEMPLOS ==========

if __name__ == "__main__":
    example_router_usage()
    example_management_command()
    example_external_consumption()
    example_functional_composition()
    example_resilient_consumption()
    print("\n✓ Todos los ejemplos de uso documentados correctamente")

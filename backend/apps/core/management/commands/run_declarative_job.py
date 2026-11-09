"""run_declarative_job.py: Comando CLI para consumir DeclarativeJobAPI.

Objetivo del archivo:
- Permitir ejecutar plugins científicos desde terminal sin pasar por HTTP,
  ideal para pruebas operativas, debugging y automatizaciones.

Cómo se usa:
- Submit simple: `python manage.py run_declarative_job molar-fractions --parameters '{...}'`.
- Plugins disponibles: se derivan en tiempo de ayuda del `ScientificAppRegistry`
  (`python manage.py run_declarative_job --help`); no hay lista fija aquí.
- Versión de algoritmo: si se omite `--algorithm-version` se usa la que cada app
  publicó como `DEFAULT_ALGORITHM_VERSION` en su definición registrada.
- Submit + wait: agregar `--wait --timeout <segundos>`. Con `--wait`, un job que
  quede pausado se reporta como error (`JobPausedTimeoutError`), no como éxito.
"""

from __future__ import annotations

import json
from typing import cast

from django.core.management.base import BaseCommand, CommandError, CommandParser

from apps.core.app_registry import ScientificAppDefinition, ScientificAppRegistry
from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.types import JSONMap


class Command(BaseCommand):
    """Ejecuta jobs científicos por plugin usando la API declarativa protegida."""

    help = (
        "Encola un job por plugin usando DeclarativeJobAPI y opcionalmente espera "
        "su finalización con timeout."
    )

    def add_arguments(self, parser: CommandParser) -> None:
        """Define argumentos del comando para plugin, parámetros y modo de espera."""
        parser.add_argument(
            "plugin",
            type=str,
            help=(
                "Nombre del plugin registrado en el ScientificAppRegistry "
                f"(uno de: {self._registered_plugin_names()})."
            ),
        )
        parser.add_argument(
            "--algorithm-version",
            dest="version",
            type=str,
            default=None,
            help=(
                "Versión del algoritmo a ejecutar. Si se omite, se usa la versión "
                "por defecto que el plugin publicó en el registro "
                "(DEFAULT_ALGORITHM_VERSION de la app), no un 1.0 genérico."
            ),
        )
        parser.add_argument(
            "--parameters",
            type=str,
            default="{}",
            help="Parámetros del plugin en formato JSON.",
        )
        parser.add_argument(
            "--wait",
            action="store_true",
            help="Espera hasta estado terminal y devuelve resultado final.",
        )
        parser.add_argument(
            "--timeout",
            type=int,
            default=60,
            help="Timeout de espera en segundos cuando se usa --wait (default: 60).",
        )

    def handle(self, *args: object, **options: object) -> None:
        """Orquesta submit o submit+wait según los argumentos recibidos."""
        del args

        plugin_name: str = str(options["plugin"])
        requested_version: str = str(options["version"] or "").strip()
        version_value: str = self._resolve_algorithm_version(
            plugin_name=plugin_name, requested_version=requested_version
        )
        wait_for_terminal: bool = bool(options["wait"])
        timeout_seconds: int = int(options["timeout"])
        parameters_raw: str = str(options["parameters"])

        parameters_payload: JSONMap = self._parse_parameters(parameters_raw)

        api = DeclarativeJobAPI()

        if wait_for_terminal:
            self._execute_submit_and_wait(
                api=api,
                plugin_name=plugin_name,
                version_value=version_value,
                parameters_payload=parameters_payload,
                timeout_seconds=timeout_seconds,
            )
            return

        self._execute_submit_only(
            api=api,
            plugin_name=plugin_name,
            version_value=version_value,
            parameters_payload=parameters_payload,
        )

    @staticmethod
    def _registered_plugin_names() -> str:
        """Nombres de plugin registrados, ordenados, para el `--help` del CLI.

        Se leen del `ScientificAppRegistry` en tiempo de ayuda: así el listado
        nunca queda desactualizado cuando se agrega o quita una app científica
        (antes estaba escrito a mano y omitía `server-calc`).
        """
        registered_names: list[str] = sorted(
            definition.plugin_name
            for definition in ScientificAppRegistry.list_definitions()
        )
        if len(registered_names) == 0:
            return "ninguno disponible (apps científicas sin registrar)"
        return ", ".join(registered_names)

    def _resolve_algorithm_version(
        self, *, plugin_name: str, requested_version: str
    ) -> str:
        """Resuelve la versión de algoritmo sin importar apps científicas.

        Prioriza `--algorithm-version`; si viene vacía usa la versión por defecto
        que la app publicó en su `ScientificAppDefinition` al registrarse.
        """
        app_definition: ScientificAppDefinition | None = (
            ScientificAppRegistry.get_definition_by_plugin(plugin_name)
        )
        if app_definition is None:
            raise CommandError(
                f"Plugin '{plugin_name}' no está registrado. "
                f"Disponibles: {self._registered_plugin_names()}."
            )
        if requested_version:
            return requested_version
        return app_definition.default_algorithm_version

    def _parse_parameters(self, raw_parameters: str) -> JSONMap:
        """Convierte el string JSON de parámetros a JSONMap tipado."""
        try:
            decoded_parameters = json.loads(raw_parameters)
        except json.JSONDecodeError as decode_error:
            raise CommandError(
                "El valor de --parameters no es JSON válido."
            ) from decode_error

        if not isinstance(decoded_parameters, dict):
            raise CommandError("El valor de --parameters debe ser un objeto JSON.")

        return cast(JSONMap, decoded_parameters)

    def _execute_submit_only(
        self,
        *,
        api: DeclarativeJobAPI,
        plugin_name: str,
        version_value: str,
        parameters_payload: JSONMap,
    ) -> None:
        """Encola un job y devuelve identificador/estado sin esperar resultado."""
        submit_result = api.submit_job(
            plugin=plugin_name,
            version=version_value,
            parameters=parameters_payload,
        ).run()

        if submit_result.is_failure():
            error_message: str = submit_result.fold(
                on_failure=lambda error_value: str(error_value),
                on_success=lambda _: "Error desconocido al encolar el job.",
            )
            raise CommandError(error_message)

        job_handle = submit_result.get_or_else(None)
        if job_handle is None:
            raise CommandError("No fue posible obtener el handle del job encolado.")

        output_data: dict[str, str] = {
            "job_id": job_handle.job_id,
            "status": job_handle.status,
        }
        self.stdout.write(json.dumps(output_data, ensure_ascii=False))

    def _execute_submit_and_wait(
        self,
        *,
        api: DeclarativeJobAPI,
        plugin_name: str,
        version_value: str,
        parameters_payload: JSONMap,
        timeout_seconds: int,
    ) -> None:
        """Encola job y espera estado terminal devolviendo resultado final."""
        wait_result = api.submit_and_wait(
            plugin=plugin_name,
            version=version_value,
            parameters=parameters_payload,
            timeout_seconds=timeout_seconds,
        ).run()

        if wait_result.is_failure():
            error_message: str = wait_result.fold(
                on_failure=lambda error_value: str(error_value),
                on_success=lambda _: "Error desconocido durante la espera del job.",
            )
            raise CommandError(error_message)

        output_payload = wait_result.get_or_else({})
        self.stdout.write(json.dumps(output_payload, ensure_ascii=False))

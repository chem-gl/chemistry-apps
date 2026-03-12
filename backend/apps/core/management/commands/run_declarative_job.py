"""run_declarative_job.py: Comando CLI para consumir DeclarativeJobAPI.

Objetivo del archivo:
- Permitir ejecutar plugins científicos desde terminal sin pasar por HTTP,
  ideal para pruebas operativas, debugging y automatizaciones.

Cómo se usa:
- Submit simple: `python manage.py run_declarative_job calculator --parameters '{...}'`.
- Submit + wait: agregar `--wait --timeout <segundos>`.
"""

from __future__ import annotations

import json
from typing import cast

from apps.core.declarative_api import DeclarativeJobAPI
from apps.core.types import JSONMap
from django.core.management.base import BaseCommand, CommandError, CommandParser


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
            help="Nombre del plugin registrado, por ejemplo: calculator o random_numbers.",
        )
        parser.add_argument(
            "--version",
            type=str,
            default="1.0",
            help="Versión del algoritmo a ejecutar (default: 1.0).",
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
        version_value: str = str(options["version"])
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

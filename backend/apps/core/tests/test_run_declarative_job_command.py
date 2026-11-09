"""test_run_declarative_job_command.py: Pruebas del CLI `run_declarative_job`.

Valida que el comando resuelve la versión de algoritmo desde el
`ScientificAppRegistry` (en lugar de un "1.0" genérico), que respeta
`--algorithm-version` explícito, que rechaza plugins inexistentes y que la ayuda
derive los nombres de plugin del registro en tiempo de ejecución.
"""

from __future__ import annotations

import io
from types import SimpleNamespace
from typing import cast
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from apps.core.management.commands.run_declarative_job import Command

from ..models import ScientificJob


class RunDeclarativeJobVersionTests(TestCase):
    """El comando toma la versión por defecto de la app registrada."""

    def _pending_job(self, plugin_name: str = "server-calc") -> ScientificJob:
        return ScientificJob.objects.create(
            job_hash="hash-run-declarative-job",
            plugin_name=plugin_name,
            algorithm_version="1.2.0",
            parameters={"a": 1.0, "op": "+", "b": 2.0},
        )

    @patch("apps.core.declarative_api.dispatch_scientific_job", return_value=True)
    @patch("apps.core.declarative_api.JobService.register_dispatch_result")
    @patch("apps.core.declarative_api.JobService.create_job")
    def test_omite_flag_usa_version_publicada_por_la_app(
        self,
        mocked_create_job: object,
        _mocked_register_dispatch: object,
        _mocked_dispatch: object,
    ) -> None:
        """Sin `--algorithm-version`, server-calc se crea con su 1.2.0, no con 1.0."""
        mocked_create_job.return_value = self._pending_job()
        stdout = io.StringIO()

        call_command(
            "run_declarative_job",
            "server-calc",
            "--parameters",
            '{"a": 1.0, "op": "+", "b": 2.0}',
            stdout=stdout,
        )

        create_kwargs: dict[str, object] = cast(
            dict[str, object], mocked_create_job.call_args.kwargs
        )
        self.assertEqual(create_kwargs["version"], "1.2.0")
        self.assertIn("job_id", stdout.getvalue())

    @patch("apps.core.declarative_api.dispatch_scientific_job", return_value=True)
    @patch("apps.core.declarative_api.JobService.register_dispatch_result")
    @patch("apps.core.declarative_api.JobService.create_job")
    def test_flag_explícito_tiene_prioridad_sobre_el_registro(
        self,
        mocked_create_job: object,
        _mocked_register_dispatch: object,
        _mocked_dispatch: object,
    ) -> None:
        """`--algorithm-version` pasado por CLI se respeta tal cual."""
        mocked_create_job.return_value = self._pending_job()

        call_command(
            "run_declarative_job",
            "server-calc",
            "--algorithm-version",
            "9.9.9",
            stdout=io.StringIO(),
        )

        create_kwargs: dict[str, object] = cast(
            dict[str, object], mocked_create_job.call_args.kwargs
        )
        self.assertEqual(create_kwargs["version"], "9.9.9")

    def test_plugin_no_registrado_falla_con_lista_disponible(self) -> None:
        """Un plugin inexistente aborta con CommandError y lista los válidos."""
        with self.assertRaises(CommandError) as error_context:
            call_command("run_declarative_job", "plugin-fantasma", stdout=io.StringIO())

        self.assertIn("plugin-fantasma", str(error_context.exception))
        self.assertIn("server-calc", str(error_context.exception))

    def test_parametros_invalidos_fallan_antes_de_encolar(self) -> None:
        """JSON mal formado o no-objeto aborta el comando."""
        with self.assertRaises(CommandError):
            call_command(
                "run_declarative_job",
                "server-calc",
                "--parameters",
                "{no-es-json",
                stdout=io.StringIO(),
            )

        with self.assertRaises(CommandError):
            call_command(
                "run_declarative_job",
                "server-calc",
                "--parameters",
                "[1, 2]",
                stdout=io.StringIO(),
            )

    def test_help_lista_plugins_derivados_del_registro(self) -> None:
        """La ayuda no mantiene una lista fija: sale del ScientificAppRegistry."""
        registered_names: str = Command._registered_plugin_names()
        self.assertIn("server-calc", registered_names)
        self.assertIn("molar-fractions", registered_names)

        parser = Command().create_parser("manage.py", "run_declarative_job")
        help_text: str = parser.format_help()
        self.assertIn("ScientificAppRegistry", help_text)

    @patch("apps.core.declarative_api.dispatch_scientific_job", return_value=True)
    @patch("apps.core.declarative_api.JobService.register_dispatch_result")
    @patch("apps.core.declarative_api.JobService.create_job")
    def test_modo_wait_reporta_falha_si_el_job_queda_pausado(
        self,
        mocked_create_job: object,
        _mocked_register_dispatch: object,
        _mocked_dispatch: object,
    ) -> None:
        """`--wait` sobre un job pausado termina en error, no en éxito silencioso."""
        paused_job = self._pending_job()
        paused_job.status = "paused"
        paused_job.supports_pause_resume = True
        paused_job.save(update_fields=["status", "supports_pause_resume"])
        mocked_create_job.return_value = paused_job

        # Reloj falso acotado al módulo: NUNCA parchear `time.time`/`time.sleep`
        # vía `apps.core.declarative_api.time.*` — ese path resuelve al módulo
        # stdlib global compartido por todo el proceso, y un `side_effect` finito
        # lo consumen llamadas ajenas (logging, sqlite, hilos) en la suite
        # completa, provocando StopIteration intermitente.
        # start=0.0, elapsed(1er ciclo)=0.0 -> observa `paused` y "duerme";
        # elapsed(2º ciclo)=100.0 > timeout -> JobPausedTimeoutError.
        fake_ticks = [0.0, 0.0, 100.0]
        fake_clock = SimpleNamespace(
            time=lambda: fake_ticks.pop(0) if fake_ticks else 100.0,
            sleep=lambda _seconds: None,
        )

        with patch("apps.core.declarative_api.time", fake_clock):
            with self.assertRaises(CommandError) as error_context:
                call_command(
                    "run_declarative_job",
                    "server-calc",
                    "--wait",
                    "--timeout",
                    "10",
                    stdout=io.StringIO(),
                )

        self.assertIn("pausado", str(error_context.exception))

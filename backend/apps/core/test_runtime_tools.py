"""test_runtime_tools.py: Pruebas unitarias para validación de runtime tools.

Objetivo del archivo:
- Verificar que la detección de artefactos faltantes funcione con rutas
  configurables y validaciones de ejecutables/JAR.
- Proteger contra regresiones en la capa de bootstrap de dependencias externas.

Cómo se usa:
- Ejecutar con `python manage.py test apps.core.test_runtime_tools`.
- También forma parte de `python manage.py test apps.core`.
"""

from __future__ import annotations

import stat
from pathlib import Path
from tempfile import TemporaryDirectory

from django.test import SimpleTestCase

from apps.core.runtime_tools import (
    RuntimeToolsError,
    assert_runtime_tools_ready,
    get_missing_runtime_files,
)


class RuntimeToolsValidationTests(SimpleTestCase):
    """Valida reglas de presencia/formato para herramientas externas."""

    def test_missing_runtime_files_reports_all_required_entries(self) -> None:
        with TemporaryDirectory(prefix="runtime_tools_missing_") as temporary_directory:
            root_path: Path = Path(temporary_directory)

            missing_messages = get_missing_runtime_files(root_path)

            self.assertGreaterEqual(len(missing_messages), 4)
            self.assertTrue(any("java8" in message for message in missing_messages))
            self.assertTrue(any("java17" in message for message in missing_messages))
            self.assertTrue(any("java21" in message for message in missing_messages))
            self.assertTrue(any("ambit_jar" in message for message in missing_messages))

    def test_assert_runtime_tools_ready_accepts_valid_structure(self) -> None:
        with TemporaryDirectory(prefix="runtime_tools_valid_") as temporary_directory:
            root_path: Path = Path(temporary_directory)

            self._create_fake_executable(root_path / "java/jre8/bin/java")
            self._create_fake_executable(root_path / "java/jre17/bin/java")
            self._create_fake_executable(root_path / "java/jre21/bin/java")
            self._create_fake_jar(
                root_path / "external/ambitSA/SyntheticAccessibilityCli.jar"
            )

            # No debe lanzar excepción cuando todos los artefactos requeridos existen.
            assert_runtime_tools_ready(root_path)

    def test_assert_runtime_tools_ready_fails_when_jar_is_invalid(self) -> None:
        with TemporaryDirectory(
            prefix="runtime_tools_invalid_jar_"
        ) as temporary_directory:
            root_path: Path = Path(temporary_directory)

            self._create_fake_executable(root_path / "java/jre8/bin/java")
            self._create_fake_executable(root_path / "java/jre17/bin/java")
            self._create_fake_executable(root_path / "java/jre21/bin/java")

            self._create_fake_jar(
                root_path / "external/ambitSA/SyntheticAccessibilityCli.jar"
            )
            invalid_ambit_path: Path = (
                root_path / "external/ambitSA/SyntheticAccessibilityCli.jar"
            )
            invalid_ambit_path.write_text("not-a-real-jar", encoding="utf-8")

            with self.assertRaises(RuntimeToolsError) as context:
                assert_runtime_tools_ready(root_path)

            self.assertIn("ambit_jar", str(context.exception))

    @staticmethod
    def _create_fake_executable(executable_path: Path) -> None:
        """Crea un archivo ejecutable mínimo para simular binario java."""
        executable_path.parent.mkdir(parents=True, exist_ok=True)
        executable_path.write_text(
            "#!/usr/bin/env sh\necho runtime\n", encoding="utf-8"
        )

        current_mode: int = executable_path.stat().st_mode
        executable_path.chmod(current_mode | stat.S_IXUSR)

    @staticmethod
    def _create_fake_jar(jar_path: Path) -> None:
        """Crea un JAR/ZIP mínimo para pruebas de validación estructural."""
        jar_path.parent.mkdir(parents=True, exist_ok=True)

        import zipfile

        with zipfile.ZipFile(jar_path, mode="w") as archive_file:
            archive_file.writestr("META-INF/MANIFEST.MF", "Manifest-Version: 1.0\n")

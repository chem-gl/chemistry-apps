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

import os
import stat
import tarfile
import urllib.error
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.core.runtime_tools import (
    DEFAULT_AMBIT_JAR_DOWNLOAD_URL,
    DEFAULT_DOWNLOAD_MAX_ATTEMPTS,
    DEFAULT_DOWNLOAD_TIMEOUT_SECONDS,
    DEFAULT_MAX_ARCHIVE_COMPRESSION_RATIO,
    RuntimeToolRequirement,
    RuntimeToolsError,
    _download_file_with_retry,
    _extract_tarfile_safely,
    _get_env_positive_int,
    _is_executable_file,
    _is_valid_zip_file,
    _prepare_external_artifacts,
    _resolve_requirement_path,
    _validate_tar_archive_compression_ratio,
    _validate_tar_entry_file_size,
    _validate_tar_entry_path,
    assert_runtime_tools_ready,
    get_ambit_jar_download_url,
    get_download_max_attempts,
    get_download_timeout_seconds,
    get_missing_runtime_files,
    get_runtime_tools_root,
    is_runtime_tools_strict_check_enabled,
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

    def test_assert_runtime_tools_ready_ignores_optional_jar_when_non_strict(
        self,
    ) -> None:
        with TemporaryDirectory(
            prefix="runtime_tools_non_strict_"
        ) as temporary_directory:
            root_path: Path = Path(temporary_directory)

            self._create_fake_executable(root_path / "java/jre8/bin/java")
            self._create_fake_executable(root_path / "java/jre17/bin/java")
            self._create_fake_executable(root_path / "java/jre21/bin/java")

            assert_runtime_tools_ready(root_path, strict_check=False)

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


class RuntimeToolsHelpersTests(SimpleTestCase):
    """Cubre helpers internos y rutas de error controladas en runtime tools."""

    def test_is_runtime_tools_strict_check_enabled_defaults_to_true(self) -> None:
        """Sin variable explícita, el comando usa validación estricta por defecto."""
        env_without_strict_flag = {
            key: value
            for key, value in os.environ.items()
            if key != "RUNTIME_TOOLS_STRICT_CHECK"
        }

        with patch.dict(os.environ, env_without_strict_flag, clear=True):
            self.assertTrue(is_runtime_tools_strict_check_enabled())

    def test_is_runtime_tools_strict_check_enabled_reads_false_values(self) -> None:
        """El valor false debe desactivar el modo bloqueante para startup."""
        with patch.dict(
            os.environ,
            {"RUNTIME_TOOLS_STRICT_CHECK": "false"},
            clear=False,
        ):
            self.assertFalse(is_runtime_tools_strict_check_enabled())

    def test_get_ambit_jar_download_url_returns_none_when_unset(self) -> None:
        """Sin variable configurada debe usar el mirror HTTP histórico permitido."""
        env_without_download_url = {
            key: value
            for key, value in os.environ.items()
            if key != "AMBIT_JAR_DOWNLOAD_URL"
        }

        with patch.dict(os.environ, env_without_download_url, clear=True):
            self.assertEqual(
                get_ambit_jar_download_url(),
                DEFAULT_AMBIT_JAR_DOWNLOAD_URL,
            )

    def test_get_ambit_jar_download_url_rejects_non_https_urls(self) -> None:
        """Solo el mirror HTTP permitido puede saltarse la exigencia de HTTPS."""
        unsafe_download_url = "http://example.test/ambit.jar"  # NOSONAR
        with patch.dict(
            os.environ,
            {"AMBIT_JAR_DOWNLOAD_URL": unsafe_download_url},
            clear=False,
        ):
            with self.assertRaises(RuntimeToolsError):
                get_ambit_jar_download_url()

    def test_get_ambit_jar_download_url_accepts_allowed_http_mirror(self) -> None:
        """El mirror HTTP legado de Uni Plovdiv sigue permitido por compatibilidad."""
        with patch.dict(
            os.environ,
            {"AMBIT_JAR_DOWNLOAD_URL": DEFAULT_AMBIT_JAR_DOWNLOAD_URL},
            clear=False,
        ):
            self.assertEqual(
                get_ambit_jar_download_url(),
                DEFAULT_AMBIT_JAR_DOWNLOAD_URL,
            )

    def test_get_ambit_jar_download_url_accepts_https_urls(self) -> None:
        """Una URL HTTPS válida debe propagarse sin alteraciones."""
        with patch.dict(
            os.environ,
            {"AMBIT_JAR_DOWNLOAD_URL": "https://example.test/ambit.jar"},
            clear=False,
        ):
            self.assertEqual(
                get_ambit_jar_download_url(),
                "https://example.test/ambit.jar",
            )

    def test_get_env_positive_int_uses_default_for_invalid_values(self) -> None:
        with patch.dict(os.environ, {"RUNTIME_TEST_INT": "-5"}, clear=False):
            self.assertEqual(_get_env_positive_int("RUNTIME_TEST_INT", 8), 8)

        with patch.dict(os.environ, {"RUNTIME_TEST_INT": "abc"}, clear=False):
            self.assertEqual(_get_env_positive_int("RUNTIME_TEST_INT", 9), 9)

        with patch.dict(os.environ, {"RUNTIME_TEST_INT": "12"}, clear=False):
            self.assertEqual(_get_env_positive_int("RUNTIME_TEST_INT", 7), 12)

    def test_get_runtime_tools_root_prefers_environment_variable(self) -> None:
        with patch.dict(
            os.environ,
            {"RUNTIME_TOOLS_DIR": "/opt/custom-runtime-tools"},
            clear=False,
        ):
            resolved_root = get_runtime_tools_root()

        self.assertEqual(resolved_root.as_posix(), "/opt/custom-runtime-tools")

    def test_resolve_requirement_path_combines_root_and_relative_path(self) -> None:
        root_path = Path("/opt/runtime")
        requirement = RuntimeToolRequirement(
            key="java8", relative_path="java/jre8/bin/java"
        )
        resolved_path = _resolve_requirement_path(requirement, root_path)
        self.assertEqual(resolved_path.as_posix(), "/opt/runtime/java/jre8/bin/java")

    def test_is_valid_zip_file_detects_valid_and_invalid_paths(self) -> None:
        with TemporaryDirectory(
            prefix="runtime_zip_test_"
        ) as temporary_directory:  # NOSONAR
            root_path = Path(temporary_directory)
            valid_zip_path = root_path / "valid.jar"
            invalid_zip_path = root_path / "invalid.jar"

            RuntimeToolsValidationTests._create_fake_jar(valid_zip_path)
            invalid_zip_path.write_text("invalid", encoding="utf-8")

            self.assertTrue(_is_valid_zip_file(valid_zip_path))
            self.assertFalse(_is_valid_zip_file(invalid_zip_path))
            self.assertFalse(_is_valid_zip_file(root_path / "missing.jar"))

    def test_extract_tarfile_safely_rejects_path_traversal(self) -> None:
        with TemporaryDirectory(
            prefix="runtime_tar_safe_"
        ) as temporary_directory:  # NOSONAR
            destination_dir = Path(temporary_directory)
            tar_path = destination_dir / "unsafe.tar"

            with tarfile.open(tar_path, mode="w") as archive_file:  # NOSONAR
                tar_member = tarfile.TarInfo(name="../outside.txt")
                payload = b"unsafe"
                tar_member.size = len(payload)
                archive_file.addfile(tar_member, BytesIO(payload))

            with tarfile.open(tar_path, mode="r") as archive_file:  # NOSONAR
                with self.assertRaises(RuntimeToolsError):
                    _extract_tarfile_safely(archive_file, destination_dir)

    def test_download_file_with_retry_raises_runtime_error_after_failures(self) -> None:
        with TemporaryDirectory(prefix="runtime_download_fail_") as temporary_directory:
            destination_path = Path(temporary_directory) / "downloaded.file"

            with patch(
                "apps.core.runtime_tools._download.urllib.request.urlopen",
                side_effect=urllib.error.URLError("network down"),
            ):
                with self.assertRaises(RuntimeToolsError):
                    _download_file_with_retry(
                        "https://example.test/file.tar.gz",
                        destination_path,
                        max_attempts=1,
                        timeout_seconds=1,
                    )

    def test_prepare_external_artifacts_downloads_when_jar_invalid(self) -> None:
        with TemporaryDirectory(
            prefix="runtime_external_artifacts_"
        ) as temporary_directory:
            root_path = Path(temporary_directory)

            with (
                patch.dict(
                    os.environ,
                    {"AMBIT_JAR_DOWNLOAD_URL": "https://example.test/ambit.jar"},
                    clear=False,
                ),
                patch(
                    "apps.core.runtime_tools._provisioning._download_file_with_retry",
                    return_value=None,
                ) as mocked_download,
            ):
                _prepare_external_artifacts(root_path)

            mocked_download.assert_called_once()

    def test_prepare_external_artifacts_raises_without_secure_download_url(
        self,
    ) -> None:
        """Si el mirror configurado es inválido, debe fallar explícitamente."""
        with TemporaryDirectory(
            prefix="runtime_external_artifacts_missing_url_"
        ) as temporary_directory:
            root_path = Path(temporary_directory)
            invalid_http_mirror = "http://example.test/ambit.jar"  # NOSONAR
            with patch.dict(
                os.environ,
                {"AMBIT_JAR_DOWNLOAD_URL": invalid_http_mirror},
                clear=True,
            ):
                with self.assertRaises(RuntimeToolsError):
                    _prepare_external_artifacts(root_path)

    def test_prepare_external_artifacts_skips_missing_jar_when_non_strict(self) -> None:
        """En modo no estricto el arranque no debe abortar por ausencia de AMBIT."""
        with TemporaryDirectory(
            prefix="runtime_external_artifacts_non_strict_"
        ) as temporary_directory:
            root_path = Path(temporary_directory)
            env_without_download_url = {
                key: value
                for key, value in os.environ.items()
                if key not in {"AMBIT_JAR_DOWNLOAD_URL", "RUNTIME_TOOLS_STRICT_CHECK"}
            }

            with patch.dict(
                os.environ,
                {
                    **env_without_download_url,
                    "RUNTIME_TOOLS_STRICT_CHECK": "false",
                },
                clear=True,
            ):
                _prepare_external_artifacts(root_path)


class GetDownloadConfigTests(SimpleTestCase):
    """Pruebas de lectura de configuración de descarga desde entorno."""

    def test_get_download_max_attempts_returns_default_when_unset(self) -> None:
        """Sin variable de entorno se usa DEFAULT_DOWNLOAD_MAX_ATTEMPTS."""
        env_clean = {
            k: v
            for k, v in os.environ.items()
            if k != "RUNTIME_TOOLS_DOWNLOAD_MAX_ATTEMPTS"
        }
        with patch.dict(os.environ, env_clean, clear=True):
            result = get_download_max_attempts()
        self.assertEqual(result, DEFAULT_DOWNLOAD_MAX_ATTEMPTS)

    def test_get_download_max_attempts_reads_custom_value(self) -> None:
        """Con variable configurada se usa el valor del entorno."""
        with patch.dict(
            os.environ,
            {"RUNTIME_TOOLS_DOWNLOAD_MAX_ATTEMPTS": "12"},
            clear=False,
        ):
            result = get_download_max_attempts()
        self.assertEqual(result, 12)

    def test_get_download_timeout_seconds_returns_default_when_unset(self) -> None:
        """Sin variable de entorno se usa DEFAULT_DOWNLOAD_TIMEOUT_SECONDS."""
        env_clean = {
            k: v
            for k, v in os.environ.items()
            if k != "RUNTIME_TOOLS_DOWNLOAD_TIMEOUT_SECONDS"
        }
        with patch.dict(os.environ, env_clean, clear=True):
            result = get_download_timeout_seconds()
        self.assertEqual(result, DEFAULT_DOWNLOAD_TIMEOUT_SECONDS)

    def test_get_download_timeout_seconds_reads_custom_value(self) -> None:
        """Con variable configurada se usa el valor del entorno."""
        with patch.dict(
            os.environ,
            {"RUNTIME_TOOLS_DOWNLOAD_TIMEOUT_SECONDS": "600"},
            clear=False,
        ):
            result = get_download_timeout_seconds()
        self.assertEqual(result, 600)


class IsExecutableFileTests(SimpleTestCase):
    """Pruebas de verificación de archivos ejecutables."""

    def test_returns_true_for_executable_file(self) -> None:
        """Un archivo con permiso de ejecución debe retornar True."""
        with TemporaryDirectory(prefix="runtime_exec_") as temp_dir_raw:
            exec_path = Path(temp_dir_raw) / "binary"
            exec_path.write_text("#!/bin/sh\n", encoding="utf-8")
            current_mode = exec_path.stat().st_mode
            exec_path.chmod(current_mode | stat.S_IXUSR)
            self.assertTrue(_is_executable_file(exec_path))

    def test_returns_false_for_non_executable_file(self) -> None:
        """Un archivo sin permiso de ejecución debe retornar False."""
        with TemporaryDirectory(prefix="runtime_noexec_") as temp_dir_raw:
            noexec_path = Path(temp_dir_raw) / "data.txt"
            noexec_path.write_text("data\n", encoding="utf-8")
            noexec_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
            self.assertFalse(_is_executable_file(noexec_path))

    def test_returns_false_for_missing_file(self) -> None:
        """Una ruta inexistente retorna False."""
        self.assertFalse(_is_executable_file(Path("/nonexistent/missing_binary")))

    def test_returns_false_for_directory(self) -> None:
        """Un directorio no es un archivo ejecutable."""
        with TemporaryDirectory(prefix="runtime_dir_") as temp_dir_raw:
            self.assertFalse(_is_executable_file(Path(temp_dir_raw)))


class ValidateTarEntryPathTests(SimpleTestCase):
    """Pruebas de protección contra path traversal en entradas tar."""

    def test_raises_on_path_traversal_outside_dest(self) -> None:
        """Una entrada que sale del directorio destino debe lanzar RuntimeToolsError."""
        with TemporaryDirectory(prefix="tar_path_test_") as temp_dir_raw:
            dest_dir = Path(temp_dir_raw) / "extract"
            dest_dir.mkdir()
            dest_dir_resolved = dest_dir.resolve()

            member = tarfile.TarInfo(name="../outside.txt")
            with self.assertRaises(RuntimeToolsError):
                _validate_tar_entry_path(member, dest_dir, dest_dir_resolved)

    def test_accepts_valid_nested_path_inside_dest(self) -> None:
        """Una entrada dentro del directorio destino no debe lanzar excepción."""
        with TemporaryDirectory(prefix="tar_path_ok_") as temp_dir_raw:
            dest_dir = Path(temp_dir_raw) / "extract"
            dest_dir.mkdir()
            dest_dir_resolved = dest_dir.resolve()

            member = tarfile.TarInfo(name="subdir/file.txt")
            # No debe lanzar excepción
            _validate_tar_entry_path(member, dest_dir, dest_dir_resolved)


class ValidateTarEntryFileSizeTests(SimpleTestCase):
    """Pruebas de límites de tamaño y ratio de compresión en entradas tar."""

    def test_returns_updated_total_size(self) -> None:
        """El total acumulado debe incrementarse con el tamaño descomprimido."""
        member = tarfile.TarInfo(name="file.txt")
        member.size = 1000

        new_total = _validate_tar_entry_file_size(
            member,
            total_size_bytes=500,
            max_total_size_bytes=10 * 1024 * 1024 * 1024,
            max_compression_ratio=50.0,
        )
        self.assertEqual(new_total, 1500)

    def test_raises_when_total_exceeds_max_size(self) -> None:
        """Superar el límite de tamaño total debe lanzar RuntimeToolsError."""
        member = tarfile.TarInfo(name="huge_file.txt")
        member.size = 5 * 1024 * 1024 * 1024  # 5 GB

        with self.assertRaises(RuntimeToolsError):
            _validate_tar_entry_file_size(
                member,
                total_size_bytes=0,
                max_total_size_bytes=2 * 1024 * 1024 * 1024,  # 2 GB límite
                max_compression_ratio=50.0,
            )


class ValidateTarArchiveCompressionRatioTests(SimpleTestCase):
    """Pruebas del control de ratio global comprimido/descomprimido para tarballs."""

    def test_accepts_reasonable_archive_ratio(self) -> None:
        """Un tarball con ratio normal no debe bloquearse."""
        member = tarfile.TarInfo(name="runtime/bin/java")
        member.size = 1_024

        _validate_tar_archive_compression_ratio(
            archive_members=[member],
            compressed_archive_size_bytes=512,
            max_total_size_bytes=2 * 1024 * 1024 * 1024,
            max_compression_ratio=DEFAULT_MAX_ARCHIVE_COMPRESSION_RATIO,
        )

    def test_raises_when_archive_ratio_is_suspicious(self) -> None:
        """Un ratio global excesivo debe tratarse como zip bomb potencial."""
        member = tarfile.TarInfo(name="runtime/bin/java")
        member.size = 5_000

        with self.assertRaises(RuntimeToolsError):
            _validate_tar_archive_compression_ratio(
                archive_members=[member],
                compressed_archive_size_bytes=10,
                max_total_size_bytes=2 * 1024 * 1024 * 1024,
                max_compression_ratio=DEFAULT_MAX_ARCHIVE_COMPRESSION_RATIO,
            )

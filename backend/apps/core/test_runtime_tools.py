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
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.core.runtime_tools import (
    DEFAULT_DOWNLOAD_MAX_ATTEMPTS,
    DEFAULT_DOWNLOAD_TIMEOUT_SECONDS,
    JavaRuntimeDownloadSpec,
    RuntimeToolRequirement,
    RuntimeToolsError,
    _download_file_with_retry,
    _extract_tarfile_safely,
    _get_env_positive_int,
    _is_executable_file,
    _is_valid_zip_file,
    _prepare_external_artifacts,
    _prepare_java_runtime,
    _resolve_requirement_path,
    _validate_tar_entry_file_size,
    _validate_tar_entry_path,
    assert_runtime_tools_ready,
    ensure_runtime_tools_ready,
    get_download_max_attempts,
    get_download_timeout_seconds,
    get_missing_runtime_files,
    get_runtime_tools_root,
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


class RuntimeToolsHelpersTests(SimpleTestCase):
    """Cubre helpers internos y rutas de error controladas en runtime tools."""

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
            {"RUNTIME_TOOLS_DIR": "/tmp/custom-runtime-tools"},
            clear=False,
        ):
            resolved_root = get_runtime_tools_root()

        self.assertEqual(resolved_root.as_posix(), "/tmp/custom-runtime-tools")

    def test_resolve_requirement_path_combines_root_and_relative_path(self) -> None:
        root_path = Path("/tmp/runtime")
        requirement = RuntimeToolRequirement(
            key="java8", relative_path="java/jre8/bin/java"
        )
        resolved_path = _resolve_requirement_path(requirement, root_path)
        self.assertEqual(resolved_path.as_posix(), "/tmp/runtime/java/jre8/bin/java")

    def test_is_valid_zip_file_detects_valid_and_invalid_paths(self) -> None:
        with TemporaryDirectory(prefix="runtime_zip_test_") as temporary_directory:
            root_path = Path(temporary_directory)
            valid_zip_path = root_path / "valid.jar"
            invalid_zip_path = root_path / "invalid.jar"

            RuntimeToolsValidationTests._create_fake_jar(valid_zip_path)
            invalid_zip_path.write_text("invalid", encoding="utf-8")

            self.assertTrue(_is_valid_zip_file(valid_zip_path))
            self.assertFalse(_is_valid_zip_file(invalid_zip_path))
            self.assertFalse(_is_valid_zip_file(root_path / "missing.jar"))

    def test_extract_tarfile_safely_rejects_path_traversal(self) -> None:
        with TemporaryDirectory(prefix="runtime_tar_safe_") as temporary_directory:
            destination_dir = Path(temporary_directory)
            tar_path = destination_dir / "unsafe.tar"

            with tarfile.open(tar_path, mode="w") as archive_file:
                tar_member = tarfile.TarInfo(name="../outside.txt")
                payload = b"unsafe"
                tar_member.size = len(payload)
                archive_file.addfile(tar_member, BytesIO(payload))

            with tarfile.open(tar_path, mode="r") as archive_file:
                with self.assertRaises(RuntimeToolsError):
                    _extract_tarfile_safely(archive_file, destination_dir)

    def test_download_file_with_retry_raises_runtime_error_after_failures(self) -> None:
        with TemporaryDirectory(prefix="runtime_download_fail_") as temporary_directory:
            destination_path = Path(temporary_directory) / "downloaded.file"

            with patch(
                "apps.core.runtime_tools.urllib.request.urlopen",
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

            with patch(
                "apps.core.runtime_tools._download_file_with_retry",
                return_value=None,
            ) as mocked_download:
                _prepare_external_artifacts(root_path)

            mocked_download.assert_called_once()


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


class DownloadAndExtractionTests(SimpleTestCase):
    """Pruebas de descarga y extracción segura de runtime tools."""

    def test_download_file_with_retry_writes_downloaded_bytes(self) -> None:
        """Una descarga exitosa debe persistir el contenido en disco."""
        with TemporaryDirectory(prefix="runtime_download_ok_") as temp_dir_raw:
            destination_path = Path(temp_dir_raw) / "downloaded.jar"
            response_stream = BytesIO(b"downloaded-content")
            mocked_urlopen = MagicMock()
            mocked_urlopen.return_value.__enter__.return_value = response_stream
            mocked_urlopen.return_value.__exit__.return_value = False

            with patch(
                "apps.core.runtime_tools.urllib.request.urlopen", mocked_urlopen
            ):
                _download_file_with_retry(
                    "https://example.test/runtime.jar",
                    destination_path,
                    max_attempts=1,
                    timeout_seconds=1,
                )

            self.assertEqual(destination_path.read_bytes(), b"downloaded-content")

    def test_extract_tarfile_safely_allows_valid_archive(self) -> None:
        """Un tar válido debe extraerse sin bloquearse por la protección de seguridad."""
        with TemporaryDirectory(prefix="runtime_tar_ok_") as temp_dir_raw:
            destination_dir = Path(temp_dir_raw) / "extract"
            destination_dir.mkdir()
            tar_path = destination_dir / "runtime.tar"

            with tarfile.open(tar_path, mode="w") as archive_file:
                member = tarfile.TarInfo(name="bin/java")
                payload = b"#!/bin/sh\necho ok\n"
                member.size = len(payload)
                archive_file.addfile(member, BytesIO(payload))

            with tarfile.open(tar_path, mode="r") as archive_file:
                _extract_tarfile_safely(archive_file, destination_dir)

            self.assertTrue((destination_dir / "bin" / "java").exists())

    def test_extract_tarfile_safely_rejects_too_many_entries(self) -> None:
        """Más de 10.000 entradas debe cortarse como protección contra zip bomb."""
        archive_file = MagicMock()
        archive_file.getmembers.return_value = [
            tarfile.TarInfo(name=f"file_{index}.txt") for index in range(10_001)
        ]

        with TemporaryDirectory(prefix="runtime_tar_limit_") as temp_dir_raw:
            destination_dir = Path(temp_dir_raw) / "extract"
            destination_dir.mkdir()

            with self.assertRaises(RuntimeToolsError):
                _extract_tarfile_safely(archive_file, destination_dir)


class GetRuntimeToolsRootFallbackTests(SimpleTestCase):
    """Pruebas de resolución de la raíz de herramientas según entorno y filesystem."""

    def test_uses_repo_tools_dir_when_env_var_not_set(self) -> None:
        """Sin env var, debe detectar el directorio tools del repositorio si existe."""
        # Parcha os.environ para que no haya RUNTIME_TOOLS_DIR
        env_without_rt = {
            k: v for k, v in os.environ.items() if k != "RUNTIME_TOOLS_DIR"
        }
        with patch.dict(os.environ, env_without_rt, clear=True):
            # Fuerza que la carpeta tools exista desde el punto de vista del Path
            with patch("pathlib.Path.exists", return_value=True):
                result = get_runtime_tools_root()
        # Puede ser cualquier ruta excepto el fallback del contenedor
        self.assertNotEqual(result.as_posix(), "/app/media/runtime-tools")

    def test_uses_container_fallback_when_tools_dir_not_found(self) -> None:
        """Sin env var Y sin directorio tools, cae al fallback /app/media/runtime-tools."""
        env_without_rt = {
            k: v for k, v in os.environ.items() if k != "RUNTIME_TOOLS_DIR"
        }
        with patch.dict(os.environ, env_without_rt, clear=True):
            with patch("pathlib.Path.exists", return_value=False):
                result = get_runtime_tools_root()
        self.assertEqual(result.as_posix(), "/app/media/runtime-tools")


class GetMissingRuntimeFilesNonExecutableTests(SimpleTestCase):
    """Pruebas para archivos existentes pero no ejecutables en get_missing_runtime_files."""

    def test_reports_non_executable_file_as_missing(self) -> None:
        """Un archivo que existe pero no es ejecutable debe aparecer en la lista de faltantes."""
        with TemporaryDirectory(prefix="rt_noexec_") as tmpdir:
            root = Path(tmpdir)
            fake_java = root / "java/jre_test/bin/java"
            fake_java.parent.mkdir(parents=True)
            # Escribe el archivo SIN permiso de ejecución
            fake_java.write_text("not-a-real-binary", encoding="utf-8")
            fake_java.chmod(stat.S_IRUSR | stat.S_IWUSR)

            requirement = RuntimeToolRequirement(
                key="java_test",
                relative_path="java/jre_test/bin/java",
                must_be_executable=True,
            )

            with patch(
                "apps.core.runtime_tools.REQUIRED_RUNTIME_TOOLS", (requirement,)
            ):
                missing = get_missing_runtime_files(root)

        self.assertEqual(len(missing), 1)
        self.assertIn("java_test", missing[0])
        self.assertIn("no es ejecutable", missing[0])


class PrepareJavaRuntimeTests(SimpleTestCase):
    """Pruebas para la función de descarga e instalación de JRE portables."""

    def _create_fake_jre_tar(self, tar_path: Path, runtime_name: str) -> None:
        """Crea un tar.gz mínimo que simula la estructura de una JRE extraída."""
        tar_path.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(tar_path, "w:gz") as tar_archive:
            # Directorio raíz de la JRE
            dir_info = tarfile.TarInfo(name=runtime_name)
            dir_info.type = tarfile.DIRTYPE
            tar_archive.addfile(dir_info)

            # Subdirectorio bin/
            bin_dir = tarfile.TarInfo(name=f"{runtime_name}/bin")
            bin_dir.type = tarfile.DIRTYPE
            tar_archive.addfile(bin_dir)

            # Binario java
            java_data = b"#!/bin/sh\necho java\n"
            java_info = tarfile.TarInfo(name=f"{runtime_name}/bin/java")
            java_info.size = len(java_data)
            java_info.mode = 0o755
            tar_archive.addfile(java_info, BytesIO(java_data))

    def test_skips_download_when_java_binary_already_present(self) -> None:
        """Si el binario java ya existe y es ejecutable, no se descarga ni extrae nada."""
        spec = JavaRuntimeDownloadSpec(
            runtime_name="jre_skip",
            target_subdir="java/jre_skip",
            download_url="https://test.example/jre_skip.tar.gz",
        )
        with TemporaryDirectory(prefix="prepare_java_skip_") as tmpdir:
            root = Path(tmpdir)
            java_path = root / "java/jre_skip/bin/java"
            java_path.parent.mkdir(parents=True)
            java_path.write_text("#!/bin/sh\n", encoding="utf-8")
            java_path.chmod(java_path.stat().st_mode | stat.S_IXUSR)

            with patch("apps.core.runtime_tools._download_file_with_retry") as mock_dl:
                _prepare_java_runtime(root, spec)

        # Al ya estar presente, no debe intentar ninguna descarga
        mock_dl.assert_not_called()

    def test_downloads_and_installs_runtime_when_missing(self) -> None:
        """Cuando el binario no existe, se descarga, extrae e instala correctamente."""
        spec = JavaRuntimeDownloadSpec(
            runtime_name="jre_dl_test",
            target_subdir="java/jre_dl_test",
            download_url="https://test.example/jre_dl_test.tar.gz",
        )

        def fake_download(url: str, path: Path, **kwargs: object) -> None:
            """Escribe un tar.gz mínimo en la ruta esperada."""
            self._create_fake_jre_tar(path, "jre_dl_test")

        with TemporaryDirectory(prefix="prepare_java_dl_") as tmpdir:
            root = Path(tmpdir)

            with patch(
                "apps.core.runtime_tools._download_file_with_retry",
                side_effect=fake_download,
            ):
                # Mockea la verificación final de ejecutable para evitar permisos del OS
                with patch(
                    "apps.core.runtime_tools._is_executable_file",
                    side_effect=[False, True],
                ):
                    _prepare_java_runtime(root, spec)

    def test_raises_when_tar_has_no_extracted_directory(self) -> None:
        """Si el tar se extrae pero no contiene ningún directorio raíz, lanza error."""
        spec = JavaRuntimeDownloadSpec(
            runtime_name="jre_empty",
            target_subdir="java/jre_empty",
            download_url="https://test.example/jre_empty.tar.gz",
        )

        def fake_download_empty(url: str, path: Path, **kwargs: object) -> None:
            """Tar vacío sin directorios."""
            path.parent.mkdir(parents=True, exist_ok=True)
            with tarfile.open(path, "w:gz"):
                pass  # Tar completamente vacío

        with TemporaryDirectory(prefix="prepare_java_empty_") as tmpdir:
            root = Path(tmpdir)

            with patch(
                "apps.core.runtime_tools._download_file_with_retry",
                side_effect=fake_download_empty,
            ):
                with patch(
                    "apps.core.runtime_tools._is_executable_file",
                    return_value=False,
                ):
                    with self.assertRaises(RuntimeToolsError) as ctx:
                        _prepare_java_runtime(root, spec)

        self.assertIn("jre_empty", str(ctx.exception))


class EnsureRuntimeToolsReadyTests(SimpleTestCase):
    """Prueba el orquestador principal que garantiza runtimes disponibles."""

    def test_calls_prepare_for_each_runtime_and_asserts(self) -> None:
        """Verifica que se invoca _prepare_java_runtime por cada JRE y assert al final."""
        with TemporaryDirectory(prefix="ensure_ready_") as tmpdir:
            root = Path(tmpdir)

            with (
                patch("apps.core.runtime_tools._prepare_java_runtime") as mock_prepare,
                patch(
                    "apps.core.runtime_tools._prepare_external_artifacts"
                ) as mock_artifacts,
                patch(
                    "apps.core.runtime_tools.assert_runtime_tools_ready"
                ) as mock_assert,
            ):
                ensure_runtime_tools_ready(root)

        # Debe llamarse una vez por cada JRE (jre8, jre17, jre21)
        self.assertEqual(mock_prepare.call_count, 3)
        mock_artifacts.assert_called_once_with(root)
        mock_assert.assert_called_once_with(root)

    def test_creates_root_dir_if_not_exists(self) -> None:
        """El directorio raíz se crea automáticamente si no existe."""
        with TemporaryDirectory(prefix="ensure_ready_mkdir_") as tmpdir:
            new_root = Path(tmpdir) / "new_runtime_root"

            with (
                patch("apps.core.runtime_tools._prepare_java_runtime"),
                patch("apps.core.runtime_tools._prepare_external_artifacts"),
                patch("apps.core.runtime_tools.assert_runtime_tools_ready"),
            ):
                ensure_runtime_tools_ready(new_root)

            # La aserción debe estar dentro del bloque para que el temp dir exista
            self.assertTrue(new_root.exists())

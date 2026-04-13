"""test_runtime_tools_execution.py: Pruebas de descarga, extracción e instalación de runtimes.

Cubre: descarga con reintentos, extracción segura de tarballs, resolución de raíz,
preparación de JREs y orquestación del bootstrap de herramientas externas.
"""

from __future__ import annotations

import os
import stat
import tarfile
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.core.runtime_tools import (
    JavaRuntimeDownloadSpec,
    RuntimeToolRequirement,
    RuntimeToolsError,
    _download_file_with_retry,
    _extract_tarfile_safely,
    _prepare_java_runtime,
    ensure_runtime_tools_ready,
    get_missing_runtime_files,
    get_runtime_tools_root,
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
                "apps.core.runtime_tools._download.urllib.request.urlopen",
                mocked_urlopen,
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
        with TemporaryDirectory(prefix="runtime_tar_ok_") as temp_dir_raw:  # NOSONAR
            destination_dir = Path(temp_dir_raw) / "extract"
            destination_dir.mkdir()
            tar_path = destination_dir / "runtime.tar"

            with tarfile.open(tar_path, mode="w") as archive_file:  # NOSONAR
                member = tarfile.TarInfo(name="bin/java")
                payload = b"#!/bin/sh\necho ok\n"
                member.size = len(payload)
                archive_file.addfile(member, BytesIO(payload))

            compressed_archive_size_bytes = tar_path.stat().st_size
            with tarfile.open(tar_path, mode="r") as archive_file:  # NOSONAR
                _extract_tarfile_safely(
                    archive_file,
                    destination_dir,
                    compressed_archive_size_bytes=compressed_archive_size_bytes,
                )

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

    def test_extract_tarfile_safely_rejects_suspicious_archive_ratio(self) -> None:
        """Un tarball con ratio comprimido/descomprimido extremo debe rechazarse."""
        archive_file = MagicMock()
        oversized_member = tarfile.TarInfo(name="file.txt")
        oversized_member.size = 5_000
        archive_file.getmembers.return_value = [oversized_member]

        with TemporaryDirectory(prefix="runtime_tar_ratio_") as temp_dir_raw:
            destination_dir = Path(temp_dir_raw) / "extract"
            destination_dir.mkdir()

            with patch("apps.core.runtime_tools._download._extract_tar_member_safely"):
                with self.assertRaises(RuntimeToolsError):
                    _extract_tarfile_safely(
                        archive_file,
                        destination_dir,
                        compressed_archive_size_bytes=10,
                    )


class GetRuntimeToolsRootFallbackTests(SimpleTestCase):
    """Pruebas de resolución de la raíz de herramientas según entorno y filesystem."""

    def test_uses_repo_tools_dir_when_env_var_not_set(self) -> None:
        """Sin env var, debe detectar el directorio tools del repositorio si existe."""
        env_without_rt = {
            k: v for k, v in os.environ.items() if k != "RUNTIME_TOOLS_DIR"
        }
        with patch.dict(os.environ, env_without_rt, clear=True):
            with patch("pathlib.Path.exists", return_value=True):
                result = get_runtime_tools_root()
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
            fake_java.write_text("not-a-real-binary", encoding="utf-8")
            fake_java.chmod(stat.S_IRUSR | stat.S_IWUSR)

            requirement = RuntimeToolRequirement(
                key="java_test",
                relative_path="java/jre_test/bin/java",
                must_be_executable=True,
            )

            with patch(
                "apps.core.runtime_tools._validation.REQUIRED_RUNTIME_TOOLS",
                (requirement,),
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
        with tarfile.open(tar_path, "w:gz") as tar_archive:  # NOSONAR
            dir_info = tarfile.TarInfo(name=runtime_name)
            dir_info.type = tarfile.DIRTYPE
            tar_archive.addfile(dir_info)

            bin_dir = tarfile.TarInfo(name=f"{runtime_name}/bin")
            bin_dir.type = tarfile.DIRTYPE
            tar_archive.addfile(bin_dir)

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

            with patch(
                "apps.core.runtime_tools._provisioning._download_file_with_retry"
            ) as mock_dl:
                _prepare_java_runtime(root, spec)

        mock_dl.assert_not_called()

    def test_downloads_and_installs_runtime_when_missing(self) -> None:
        """Cuando el binario no existe, se descarga, extrae e instala correctamente."""
        spec = JavaRuntimeDownloadSpec(
            runtime_name="jre_dl_test",
            target_subdir="java/jre_dl_test",
            download_url="https://test.example/jre_dl_test.tar.gz",
        )

        def fake_download(url: str, path: Path, **kwargs: object) -> None:
            self._create_fake_jre_tar(path, "jre_dl_test")

        with TemporaryDirectory(prefix="prepare_java_dl_") as tmpdir:
            root = Path(tmpdir)

            with patch(
                "apps.core.runtime_tools._provisioning._download_file_with_retry",
                side_effect=fake_download,
            ):
                with patch(
                    "apps.core.runtime_tools._provisioning._is_executable_file",
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
            path.parent.mkdir(parents=True, exist_ok=True)
            with tarfile.open(path, "w:gz"):  # NOSONAR
                pass

        with TemporaryDirectory(prefix="prepare_java_empty_") as tmpdir:
            root = Path(tmpdir)

            with patch(
                "apps.core.runtime_tools._provisioning._download_file_with_retry",
                side_effect=fake_download_empty,
            ):
                with patch(
                    "apps.core.runtime_tools._provisioning._is_executable_file",
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
                patch(
                    "apps.core.runtime_tools._provisioning._prepare_java_runtime"
                ) as mock_prepare,
                patch(
                    "apps.core.runtime_tools._provisioning._prepare_external_artifacts"
                ) as mock_artifacts,
                patch(
                    "apps.core.runtime_tools._provisioning.assert_runtime_tools_ready"
                ) as mock_assert,
            ):
                ensure_runtime_tools_ready(root)

        self.assertEqual(mock_prepare.call_count, 3)
        mock_artifacts.assert_called_once_with(root, strict_check=True)
        mock_assert.assert_called_once_with(root, strict_check=True)

    def test_creates_root_dir_if_not_exists(self) -> None:
        """El directorio raíz se crea automáticamente si no existe."""
        with TemporaryDirectory(prefix="ensure_ready_mkdir_") as tmpdir:
            new_root = Path(tmpdir) / "new_runtime_root"

            with (
                patch("apps.core.runtime_tools._provisioning._prepare_java_runtime"),
                patch(
                    "apps.core.runtime_tools._provisioning._prepare_external_artifacts"
                ),
                patch(
                    "apps.core.runtime_tools._provisioning.assert_runtime_tools_ready"
                ),
            ):
                ensure_runtime_tools_ready(new_root)

            self.assertTrue(new_root.exists())

    def test_non_strict_mode_skips_optional_external_artifacts(self) -> None:
        """El bootstrap no estricto debe permitir arrancar aunque AMBIT falte."""
        with TemporaryDirectory(prefix="ensure_ready_non_strict_") as tmpdir:
            root = Path(tmpdir)

            with (
                patch(
                    "apps.core.runtime_tools._provisioning._prepare_java_runtime"
                ) as mock_prepare,
                patch(
                    "apps.core.runtime_tools._provisioning._prepare_external_artifacts"
                ) as mock_artifacts,
                patch(
                    "apps.core.runtime_tools._provisioning.assert_runtime_tools_ready"
                ) as mock_assert,
            ):
                ensure_runtime_tools_ready(root, strict_check=False)

        self.assertEqual(mock_prepare.call_count, 3)
        mock_artifacts.assert_called_once_with(root, strict_check=False)
        mock_assert.assert_called_once_with(root, strict_check=False)

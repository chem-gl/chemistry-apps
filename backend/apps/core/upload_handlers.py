"""upload_handlers.py: Handler de subida con corte temprano por rol.

Objetivo del archivo:
- Impedir que un cliente escriba archivos enormes en disco/tmp antes de que la
  validación de aplicación los rechace.

Por qué existe:
- ``DATA_UPLOAD_MAX_MEMORY_SIZE`` excluye los datos de archivos, así que no
  limita el tamaño de una subida multipart. La comprobación en
  ``ScientificInputArtifactStorageService`` ocurre con el archivo ya recibido.
- Este handler se ejecuta **durante** la recepción de cada parte del multipart y
  lanza ``RequestDataTooBig`` en cuanto se supera el tope del rol, de modo que
  Django invoca ``upload_interrupted()`` y elimina los temporales.

Cómo se usa:
- Registrado en ``FILE_UPLOAD_HANDLERS`` (después de ``MemoryFileUploadHandler``,
  que se ocupa de los archivos pequeños en memoria).
"""

from __future__ import annotations

from django.core.exceptions import RequestDataTooBig
from django.core.files.uploadhandler import TemporaryFileUploadHandler

from .upload_limits import format_megabytes, resolve_max_upload_bytes_for_user


class SizeLimitedTemporaryFileUploadHandler(TemporaryFileUploadHandler):
    """Sube a disco respetando el tope por archivo del rol de la petición."""

    max_bytes: int
    received_bytes: int

    def new_file(self, *args: object, **kwargs: object) -> None:
        """Resuelve el tope aplicable al inicio de cada archivo."""
        super().new_file(*args, **kwargs)
        self.max_bytes = resolve_max_upload_bytes_for_user(
            getattr(self.request, "user", None)
        )
        self.received_bytes = 0

    def receive_data_chunk(self, raw_data: bytes, start: int) -> bytes | None:
        """Acumula bytes recibidos y corta en cuanto se supera el tope."""
        self.received_bytes += len(raw_data)
        if self.received_bytes > self.max_bytes:
            raise RequestDataTooBig(
                "El archivo supera el máximo permitido de "
                f"{format_megabytes(self.max_bytes)}."
            )

        return super().receive_data_chunk(raw_data, start)

"""__init__.py: Marca el paquete de migraciones de `apps.core`.

Objetivo del archivo:
- Permitir que Django detecte este directorio como paquete Python válido para
        ejecutar `makemigrations`, `migrate` y `showmigrations`.

Uso:
- No se importa manualmente desde lógica de negocio.
- Django lo utiliza automáticamente durante operaciones de esquema.
"""

"""normalize_i18n_placeholders.py: normaliza los espacios internos de los placeholders i18n.

Problema que resuelve:
- Transloco interpola `{{name}}`, pero en `frontend/public/i18n/*.json` conviven
  `{{ name }}` y `{{name}}` para la misma clave según el idioma (p. ej.
  `login.developers.visitProfile` usa `{{ name }}` en los ocho idiomas, mientras
  `smileit.substLib.openDetail` usa `{{name}}`).
- La convención del proyecto es la forma compacta `{{name}}`.

Qué hace:
- Reescribe SOLO el interior de las llaves de los valores string: `{{ x }}` ->
  `{{x}}`. No toca claves, orden de miembros, indentación (2), codificación
  UTF-8 (sin ASCII escapado) ni el byte final del archivo.
- Con `--check` no escribe: verifica invariantes (estructura de claves, recuento
  de hojas, que el único cambio sea el interior de las llaves) y cruza que dos
  idiomas no declaren placeholders distintos para la misma clave.

Uso:
    python3 scripts/normalize_i18n_placeholders.py --check
    python3 scripts/normalize_i18n_placeholders.py
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

PLACEHOLDER_RE = re.compile(r"\{\{([^{}]*)\}\}")
SPACED_EXAMPLE = "`{{ x }}`"
DEFAULT_DIR = Path(__file__).resolve().parents[1] / "frontend" / "public" / "i18n"


def normalize_text(text: str) -> str:
    """Devuelve `text` con el interior de cada `{{ ... }}` sin espacios."""
    return PLACEHOLDER_RE.sub(lambda m: "{{" + m.group(1).strip() + "}}", text)


def iter_strings(node: Any, path: str = "") -> Iterator[tuple[str, str]]:
    """Recorre el JSON en orden de archivo y emite (ruta, valor) de cada hoja."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield from iter_strings(value, f"{path}.{key}" if path else key)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from iter_strings(value, f"{path}[{index}]")
    else:
        yield path, node


def key_shape(node: Any) -> Any:
    """Estructura comparable de claves/posiciones (sin valores) del documento."""
    if isinstance(node, dict):
        return [(key, key_shape(value)) for key, value in node.items()]
    if isinstance(node, list):
        return [key_shape(value) for value in node]
    return type(node).__name__


def placeholders_of(value: str) -> tuple[str, ...]:
    """Nombres declarados en un valor, en orden de aparición."""
    return tuple(m.group(1).strip() for m in PLACEHOLDER_RE.finditer(value))


def load(path: Path) -> Any:
    """Lee y parsea un archivo i18n en UTF-8."""
    return json.loads(path.read_text(encoding="utf-8"))


def leaves_of(document: Any) -> dict[str, str]:
    """Mapa ruta -> valor de las hojas del documento."""
    return dict(iter_strings(document))


def iter_keys(node: Any, path: str = "") -> Iterator[tuple[str, str]]:
    """Emite (nombre_de_clave, ruta) de todas las claves del documento."""
    if isinstance(node, dict):
        for key, value in node.items():
            child = f"{path}.{key}" if path else key
            yield key, child
            yield from iter_keys(value, child)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from iter_keys(value, f"{path}[{index}]")


def check_keys_have_no_placeholders(document: Any, name: str) -> list[str]:
    """Detecta claves con `{{` (harían insegura la sustitución a nivel de texto)."""
    return [
        f"{name}: la clave {route} contiene llaves de interpolación"
        for key, route in iter_keys(document)
        if "{{" in key or "}}" in key
    ]


def check_invariants(before: str, after: str, name: str) -> list[str]:
    """Verifica que `after` sólo difiere de `before` en el interior de las llaves."""
    problems: list[str] = []
    doc_before = json.loads(before)
    doc_after = json.loads(after)

    if key_shape(doc_before) != key_shape(doc_after):
        problems.append(f"{name}: cambió la estructura de claves")

    problems.extend(check_keys_have_no_placeholders(doc_before, name))

    if normalize_text(before) != after:
        problems.append(
            f"{name}: el texto reescrito no coincide con la normalización esperada"
        )

    leaves_before = leaves_of(doc_before)
    leaves_after = leaves_of(doc_after)
    if list(leaves_before) != list(leaves_after):
        problems.append(f"{name}: cambió el conjunto de claves")
    else:
        problems.extend(
            f"{name}: {route} no quedó normalizado"
            for route, value in leaves_before.items()
            if leaves_after[route] != normalize_text(value)
        )

    if len(leaves_after) != len(leaves_before):
        problems.append(
            f"{name}: cambió el recuento de hojas ({len(leaves_before)} -> {len(leaves_after)})"
        )

    raw_hits = len(PLACEHOLDER_RE.findall(after))
    value_hits = sum(
        len(PLACEHOLDER_RE.findall(value)) for value in leaves_after.values()
    )
    if raw_hits != value_hits:
        problems.append(
            f"{name}: {raw_hits} placeholders en texto crudo vs {value_hits} en valores"
        )

    if before.endswith("\n") != after.endswith("\n"):
        problems.append(f"{name}: cambió el byte final del archivo")
    return problems


def changed_lines(before: str, after: str) -> list[tuple[int, str, str]]:
    """Diferencia línea a línea (número, antes, después)."""
    old_lines = before.splitlines()
    new_lines = after.splitlines()
    if len(old_lines) != len(new_lines):
        return [(-1, f"<{len(old_lines)} líneas>", f"<{len(new_lines)} líneas>")]
    return [
        (index + 1, old_line, new_line)
        for index, (old_line, new_line) in enumerate(zip(old_lines, new_lines))
        if old_line != new_line
    ]


def check_cross_language(documents: dict[str, Any]) -> list[str]:
    """Ningún placeholder declarado en un valor puede diferir entre idiomas."""
    problems: list[str] = []
    routes = {route for document in documents.values() for route in leaves_of(document)}
    for route in sorted(routes):
        declared = {
            name: placeholders_of(leaves_of(document).get(route, ""))
            for name, document in documents.items()
        }
        reported = {values for values in declared.values() if values}
        # La ausencia también es incoherencia: un idioma sin el placeholder no interpola.
        shapes = {(bool(values), values) for values in declared.values()}
        if len(reported) > 1 or len(shapes) > 1:
            detail = ", ".join(
                f"{name}={list(values) if values else 'sin placeholder'}"
                for name, values in sorted(declared.items())
            )
            problems.append(f"{route}: placeholders inconsistentes -> {detail}")
    return problems


def run(directory: Path, *, apply: bool) -> int:
    """Ejecuta la verificación y, si `apply`, reescribe los archivos."""
    files = sorted(directory.glob("*.json"))
    if not files:
        print(f"No hay archivos i18n en {directory}", file=sys.stderr)
        return 2

    problems: list[str] = []
    documents: dict[str, Any] = {}
    total_lines = 0

    for path in files:
        before = path.read_text(encoding="utf-8")
        after = normalize_text(before)
        diffs = changed_lines(before, after)
        total_lines += len(diffs)
        print(f"{path.name}: {len(diffs)} líneas con placeholders espaciosos")
        for number, old_line, new_line in diffs:
            print(
                f"  {path.name}:{number}\n    - {old_line.strip()}\n    + {new_line.strip()}"
            )
        problems.extend(check_invariants(before, after, path.name))
        documents[path.name] = json.loads(after)
        if apply and before != after:
            path.write_text(after, encoding="utf-8")

    problems.extend(check_cross_language(documents))

    # Paridad de recuento derivada: en.json manda, no un literal hardcodeado.
    reference_name = "en.json"
    if reference_name in documents:
        reference_count = len(leaves_of(documents[reference_name]))
        for name, document in sorted(documents.items()):
            count = len(leaves_of(document))
            if count != reference_count:
                problems.append(
                    f"{name}: {count} hojas frente a {reference_count} de {reference_name}"
                )
        print(f"{reference_name}: {reference_count} hojas (referencia).")

    if problems:
        print("\nPROBLEMAS:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    if not apply and total_lines:
        print(
            f"\n--check: quedan {total_lines} líneas con el estilo {SPACED_EXAMPLE};"
            " ejecuta el script sin --check",
            file=sys.stderr,
        )
        return 1

    verb = "normalizados" if apply else "comprobados (sin escribir)"
    print(f"\n{len(files)} archivos {verb}: {total_lines} líneas tocadas, 0 problemas")
    return 0


def main(argv: list[str] | None = None) -> int:
    """Punto de entrada del script."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "directory",
        nargs="?",
        type=Path,
        default=DEFAULT_DIR,
        help=f"directorio con los JSON de i18n (por defecto {DEFAULT_DIR})",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="sólo verifica invariantes y consistencia entre idiomas",
    )
    args = parser.parse_args(argv)
    return run(args.directory, apply=not args.check)


if __name__ == "__main__":
    raise SystemExit(main())

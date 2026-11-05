"""Genera miniaturas WebP de iconos y fotos de equipo.

Los iconos PNG (715KB-1052KB) se muestran a 80px en el hub; el script crea
derivados WebP pequenos sin tocar el frontend ni su configuracion.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    from PIL import Image, features
except ImportError:  # pragma: no cover
    sys.exit("error: Pillow no esta instalado; instalalo con `pip install Pillow`.")

if not features.check("webp"):  # pragma: no cover
    sys.exit("error: tu Pillow se compilo sin soporte WebP; reinstala Pillow (>=10).")


ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT / "frontend" / "public" / "assets"
ICONS_DIR = ASSETS_DIR / "thumbnails" / "icons"
TEAM_DIR = ASSETS_DIR / "team"
TEAM_THUMBS_DIR = TEAM_DIR / "thumbs"

ICON_GLOBS = ("*_app_icon.png", "cadmapy_v3_noboxes.png")
TEAM_SUFFIXES = frozenset({".png", ".jpg", ".jpeg"})
DEFAULT_ICON_WIDTHS = (80, 160)
DEFAULT_TEAM_WIDTHS = (160, 320)
DEFAULT_QUALITY = 78


@dataclass(frozen=True)
class ThumbJob:
    """Un redimensionado pendiente: origen, destino y ancho objetivo."""

    source: Path
    dest: Path
    width: int


def parse_widths(raw: str) -> tuple[int, ...]:
    """Convierte "80,160" en tupla de anchos enteros positivos sin repetidos."""
    widths: list[int] = []
    for chunk in raw.split(","):
        width = int(chunk.strip())
        if width <= 0:
            raise ValueError(f"ancho invalido: {chunk.strip()!r}")
        if width not in widths:
            widths.append(width)
    if not widths:
        raise ValueError("indica al menos un ancho")
    return tuple(widths)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Define los flags del script (--widths, --quality, --check, filtros)."""
    parser = argparse.ArgumentParser(description="Genera miniaturas WebP.")
    parser.add_argument(
        "--widths", type=parse_widths, default=None, help="Anchos en px: 80,160."
    )
    parser.add_argument(
        "--quality", type=int, default=DEFAULT_QUALITY, help="Calidad WebP 1-100."
    )
    parser.add_argument(
        "--check", action="store_true", help="Exit 1 si desactualizado."
    )
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument("--icons-only", action="store_true", help="Solo iconos.")
    scope.add_argument("--team-only", action="store_true", help="Solo equipo.")
    args = parser.parse_args(argv)
    if not 1 <= args.quality <= 100:
        parser.error("--quality debe estar entre 1 y 100")
    return args


def collect_jobs(
    icon_widths: tuple[int, ...],
    team_widths: tuple[int, ...],
    *,
    icons_only: bool,
    team_only: bool,
) -> list[ThumbJob]:
    """Reune los trabajos de iconos y/o equipo segun los filtros activos."""
    jobs: list[ThumbJob] = []
    if not team_only:
        for pattern in ICON_GLOBS:
            for source in sorted(ASSETS_DIR.glob(pattern)):
                jobs.extend(
                    ThumbJob(source, ICONS_DIR / f"{source.stem}-{w}.webp", w)
                    for w in icon_widths
                )
    if not icons_only and TEAM_DIR.is_dir():
        for source in sorted(TEAM_DIR.iterdir()):
            if source.is_file() and source.suffix.lower() in TEAM_SUFFIXES:
                jobs.extend(
                    ThumbJob(source, TEAM_THUMBS_DIR / f"{source.stem}-{w}.webp", w)
                    for w in team_widths
                )
    return jobs


def is_fresh(job: ThumbJob) -> bool:
    """True si el destino existe y es mas nuevo que el origen (idempotencia)."""
    if not job.dest.is_file():
        return False
    return job.dest.stat().st_mtime_ns >= job.source.stat().st_mtime_ns


def build_thumbnail(job: ThumbJob, quality: int) -> None:
    """Redimensiona con LANCZOS (preserva aspecto) y guarda WebP sin metadatos."""
    job.dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(job.source) as image:
        if image.mode in ("RGBA", "LA", "PA") or (
            image.mode == "P" and "transparency" in image.info
        ):
            image = image.convert("RGBA")
        elif image.mode != "RGB":
            image = image.convert("RGB")
        image.thumbnail((job.width, job.width), Image.LANCZOS)
        image.save(job.dest, "WEBP", quality=quality)


def savings_pct(src_bytes: int, dst_bytes: int) -> float:
    """Porcentaje de ahorro (0-100); evita la division por cero."""
    return 0.0 if src_bytes <= 0 else (1.0 - dst_bytes / src_bytes) * 100.0


def print_report(rows: list[tuple[ThumbJob, int, int, str]]) -> None:
    """Imprime la tabla por archivo mas el resumen total de ahorro."""
    total_src = sum(src for _, src, _, _ in rows)
    total_dst = sum(dst for _, _, dst, _ in rows)
    for job, src_bytes, dst_bytes, status in rows:
        print(
            f"{job.source.relative_to(ROOT)} [{job.width}px] {status}: "
            f"{src_bytes} -> {dst_bytes} bytes "
            f"({savings_pct(src_bytes, dst_bytes):.1f}% ahorro)"
        )
    print(
        f"TOTAL {len(rows)} archivos: "
        f"{total_src} -> {total_dst} bytes "
        f"({savings_pct(total_src, total_dst):.1f}% ahorro)"
    )


def main(argv: list[str] | None = None) -> int:
    """Orquesta recoleccion, generacion (o verificacion) y reporte."""
    args = parse_args(argv)
    icon_widths = args.widths or DEFAULT_ICON_WIDTHS
    team_widths = args.widths or DEFAULT_TEAM_WIDTHS
    jobs = collect_jobs(
        icon_widths, team_widths, icons_only=args.icons_only, team_only=args.team_only
    )
    if not jobs:
        print("error: no se encontraron imagenes origen.", file=sys.stderr)
        return 1

    if args.check:
        stale = [job for job in jobs if not is_fresh(job)]
        for job in stale:
            print(f"STALE {job.dest.relative_to(ROOT)}")
        if stale:
            print(f"CHECK FAIL: {len(stale)}/{len(jobs)} desactualizadas.")
            return 1
        print(f"CHECK OK: {len(jobs)} miniaturas actualizadas.")
        return 0

    rows: list[tuple[ThumbJob, int, int, str]] = []
    for job in jobs:
        try:
            if is_fresh(job):
                status = "cached"
            else:
                build_thumbnail(job, args.quality)
                status = "hecho"
            rows.append(
                (job, job.source.stat().st_size, job.dest.stat().st_size, status)
            )
        except OSError as exc:
            print(f"error: {job.source}: {exc}", file=sys.stderr)
            return 1
    print_report(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

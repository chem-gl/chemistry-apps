// pointer-glow.utils.ts: resplandor ambiental que sigue al puntero.
// Compartido entre el hub de apps y el portal de login. Escribe la posicion
// como variables CSS (`--glow-x/--glow-y`) en el shell; la presentacion vive
// en la utilidad global `.reaction-glow` de styles.scss, que queda invisible
// bajo `prefers-reduced-motion`.

/** Fija las coordenadas del resplandor relativas al shell indicado. */
export function trackGlowPointer(event: PointerEvent, shell: HTMLElement): void {
  const bounds = shell.getBoundingClientRect();
  shell.style.setProperty('--glow-x', `${event.clientX - bounds.left}px`);
  shell.style.setProperty('--glow-y', `${event.clientY - bounds.top}px`);
}

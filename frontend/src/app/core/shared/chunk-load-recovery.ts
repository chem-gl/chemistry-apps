// chunk-load-recovery.ts: Recupera la aplicación cuando un chunk hasheado ya no
// existe en el servidor (pestaña abierta durante un deploy).
//
// Contexto: cada deploy rota los nombres de main/chunk-*.js. Una pestaña vieja
// que navega a una ruta lazy pide un chunk inexistente, nginx responde 404 y el
// navegador falla con "error loading dynamically imported module". La app queda
// inutilizable hasta que el usuario recarga a mano. Aquí se detecta ese fallo y
// se recarga una sola vez (con guarda temporal para no entrar en bucle).

const LAST_RELOAD_KEY = 'chemistry-apps.chunk-reload-at';
/** Ventana mínima entre recargas automáticas para evitar bucles. */
const RELOAD_COOLDOWN_MS = 10_000;

/** Mensajes con los que los navegadores reportan un import dinámico caído. */
const CHUNK_ERROR_PATTERNS: ReadonlyArray<string> = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'chunkloaderror',
];

function isChunkLoadError(message: string): boolean {
  const normalizedMessage = message.toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((pattern) => normalizedMessage.includes(pattern));
}

function withinCooldown(): boolean {
  try {
    const rawValue = sessionStorage.getItem(LAST_RELOAD_KEY);
    if (rawValue === null) {
      return false;
    }
    const elapsed = Date.now() - Number(rawValue);
    return Number.isFinite(elapsed) && elapsed < RELOAD_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function rememberReload(): void {
  try {
    sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage puede no estar disponible: la guarda temporal se pierde,
    // pero la recarga sigue siendo la respuesta correcta.
  }
}

function recoverFromChunkError(reason: unknown): void {
  const message =
    reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  if (!isChunkLoadError(message) || withinCooldown()) {
    return;
  }

  rememberReload();
  globalThis.location.reload();
}

/**
 * Escucha fallos de import dinámico (window.error y unhandledrejection) y
 * recarga la página una sola vez dentro de la ventana de enfriamiento.
 */
export function installChunkLoadRecovery(): void {
  globalThis.addEventListener('error', (event: ErrorEvent) => {
    recoverFromChunkError(event.message);
  });
  globalThis.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    recoverFromChunkError(event.reason);
  });
}

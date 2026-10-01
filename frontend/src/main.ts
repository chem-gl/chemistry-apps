import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';
import { installChunkLoadRecovery } from './app/core/shared/chunk-load-recovery';

// Antes del bootstrap: si un chunk con hash ya no existe (deploy en caliente),
// recargar una vez para obtener el index.html y los bundles nuevos.
installChunkLoadRecovery();

try {
  await bootstrapApplication(App, appConfig);
} catch (err) {
  // Mantener el manejo de errores consistente y claro
  console.error(err);
}

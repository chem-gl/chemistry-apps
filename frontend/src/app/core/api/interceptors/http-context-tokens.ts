// http-context-tokens.ts: Tokens de contexto HTTP para modular comportamiento transversal por request.

import { HttpContextToken } from '@angular/common/http';

export const SKIP_GLOBAL_ERROR_MODAL = new HttpContextToken<boolean>(() => false);

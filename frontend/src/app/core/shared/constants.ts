// constants.ts: Constantes compartidas del frontend para configuracion de servicios

import { environment } from '../../../environments/environment';

const TRAILING_SLASH_PATTERN: RegExp = /\/+$/;

export const API_BASE_URL: string = environment.apiBaseUrl.replace(TRAILING_SLASH_PATTERN, '');

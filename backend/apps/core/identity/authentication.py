"""authentication.py: Autenticación JWT que acepta el token por query string.

`EventSource` (SSE) y `WebSocket` no permiten enviar cabeceras HTTP, así que el
frontend adjunta el access token como `?token=<jwt>` en esas rutas de streaming.

Consideraciones de seguridad:
- Se sigue prefiriendo la cabecera `Authorization: Bearer`; el query string es
  solo un fallback para streaming.
- El access token vive 30 minutos (`SIMPLE_JWT.ACCESS_TOKEN_LIFETIME`), lo que
  acota la ventana de exposición si el token queda en un log o en el historial.
- No se acepta `token` en rutas de escritura: DRF solo usa esta clase como
  autenticación adicional, y el token debe ser válido y no revocado.
"""

from __future__ import annotations

from rest_framework.permissions import SAFE_METHODS
from rest_framework.request import Request
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.tokens import Token

QUERY_TOKEN_KEY = "token"


class QueryStringJWTAuthentication(JWTAuthentication):
    """Autentica por cabecera `Authorization` o, si falta, por `?token=`."""

    def authenticate(self, request: Request) -> tuple[object, Token] | None:
        """Reutiliza la autenticación por cabecera y cae al query string.

        El token por query string solo se acepta en métodos seguros (GET/HEAD/
        OPTIONS): así se cubren los streams SSE sin exponer el token en URLs de
        escritura, que quedarían en logs de acceso e historial.
        """
        header_authentication = super().authenticate(request)
        if header_authentication is not None:
            return header_authentication

        if request.method not in SAFE_METHODS:
            return None

        raw_token = request.query_params.get(QUERY_TOKEN_KEY)
        if raw_token is None or str(raw_token).strip() == "":
            return None

        validated_token: Token = self.get_validated_token(str(raw_token).strip())
        return self.get_user(validated_token), validated_token

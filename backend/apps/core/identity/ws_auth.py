"""ws_auth.py: Middleware ASGI que autentica WebSockets con el JWT de query string.

Las conexiones WebSocket del navegador no permiten cabeceras personalizadas, así
que el cliente añade `?token=<access>` al URL. Este middleware:

1. Deja que `AuthMiddlewareStack` resuelva primero la sesión (por cookies).
2. Si hay un `token` válido en el query string, reemplaza `scope["user"]` por el
   usuario del JWT.

El consumer decide después si acepta o rechaza la conexión según el usuario.
"""

from __future__ import annotations

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken

from .authentication import QUERY_TOKEN_KEY


@database_sync_to_async
def _resolve_user_from_token(raw_token: str) -> object:
    """Resuelve el usuario dueño de un access token válido.

    Reutiliza `JWTAuthentication.get_user` para respetar `USER_ID_FIELD` y
    validar que la cuenta siga activa.
    """
    try:
        validated_token = AccessToken(raw_token)
        return JWTAuthentication().get_user(validated_token)
    except (AuthenticationFailed, InvalidToken, TokenError, KeyError):
        return AnonymousUser()


class JWTAuthMiddleware:
    """Sobrescribe `scope['user']` cuando llega un `token` válido por query string."""

    def __init__(self, inner: object) -> None:
        self.inner = inner

    async def __call__(self, scope: dict, receive: object, send: object) -> None:
        """Inyecta el usuario del JWT (si existe) y delega en el consumer."""
        if scope.get("type") == "websocket":
            query_values = parse_qs(scope.get("query_string", b"").decode("utf-8"))
            raw_values = query_values.get(QUERY_TOKEN_KEY, [])
            raw_token = str(raw_values[0]).strip() if raw_values else ""

            if raw_token != "":
                scope["user"] = await _resolve_user_from_token(raw_token)

        return await self.inner(scope, receive, send)

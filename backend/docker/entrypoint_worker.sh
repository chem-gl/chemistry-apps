#!/bin/sh
# entrypoint_worker.sh: garantiza una entrada en /etc/passwd para el UID del host
# y ejecuta el comando del worker con esos privilegios.
#
# Motivo: OpenSSH aborta con "No user exists for uid N" cuando el UID efectivo no
# está en /etc/passwd. Los workers corren con HOST_UID (UID del usuario de deploy
# en el host) para que los archivos que escriben en volúmenes compartidos queden
# con el dueño correcto. Este entrypoint crea la entrada (como root) y luego baja
# privilegios con setpriv, sin dejar el proceso corriendo como root.
#
# Uso (docker-compose): entrypoint con argumentos, p. ej.
#   entrypoint: ["sh", "/app/docker/entrypoint_worker.sh"]
#   command: ["sh", "-c", "... celery ..."]

set -e

TARGET_UID="${HOST_UID:-1000}"
TARGET_GID="${HOST_GID:-1000}"

# Si ya corremos sin privilegios (dev o tests), no podemos crear la entrada ni
# cambiar de usuario: ejecutar el comando tal cual.
if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

if ! getent passwd "${TARGET_UID}" >/dev/null 2>&1; then
  if ! getent group "${TARGET_GID}" >/dev/null 2>&1; then
    groupadd -o -g "${TARGET_GID}" appgrp 2>/dev/null || true
  fi
  useradd -o -u "${TARGET_UID}" -g "${TARGET_GID}" -M -s /bin/sh -d /app appuser 2>/dev/null || true
fi

exec setpriv --reuid="${TARGET_UID}" --regid="${TARGET_GID}" --clear-groups "$@"

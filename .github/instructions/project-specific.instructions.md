# Instrucciones específicas para el proyecto Chemistry Apps

Estas instrucciones están diseñadas para estandarizar el desarrollo y mantenimiento del proyecto Chemistry Apps.

## Estructura del proyecto

- **Backend**: Contiene la lógica del servidor, organizada en aplicaciones Django dentro de `backend/apps/`.
- **Frontend**: Implementado en Angular, ubicado en `frontend/`.
- **Scripts**: Scripts útiles para tareas específicas, como `create_openapi.py`.
- **Legacy**: Código antiguo o en desuso, ubicado en `legacy/`.

## Convenciones de desarrollo

1. **Comentarios y documentación**:
   - Usar comentarios en español explicando el objetivo y uso de cada archivo.
   - Documentar funciones y clases con docstrings claros y descriptivos.

2. **Nombres descriptivos**:
   - Usar nombres de variables y funciones que describan claramente su propósito.
   - Evitar abreviaturas innecesarias.

3. **Estructura del código**:
   - Mantener el código limpio y organizado.
   - Seguir las mejores prácticas de programación.
   - Evitar el uso de código obsoleto.

4. **Pruebas**:
   - Escribir pruebas unitarias para cada nueva funcionalidad.
   - Ubicar las pruebas en archivos `tests.py` dentro de cada aplicación o módulo.

5. **Errores**:
   - Manejar errores de manera adecuada.
   - Evitar el uso de variables globales.

## Backend

- **Framework**: Django.
- **Base de datos**: SQLite (en desarrollo, cambiar a PostgreSQL en producción).
- **Ejecución**:
  ```bash
  ./venv/bin/python manage.py runserver
  ```
- **Pruebas**:
  ```bash
  ./venv/bin/python manage.py test
  ```

## Frontend

- **Framework**: Angular.
- **Ejecución**:
  ```bash
  npm start
  ```
- **Pruebas**:
  ```bash
  npm test
  ```

## Scripts

- **Generación de OpenAPI**:
  - Ubicado en `scripts/create_openapi.py`.
  - Ejecutar con:
    ```bash
    ./venv/bin/python scripts/create_openapi.py
    ```

## Estilo de codificación

- Seguir las convenciones de PEP 8 para Python.
- Usar Prettier y ESLint para el frontend.

## Control de versiones

- Usar ramas descriptivas para nuevas funcionalidades o correcciones.
- Asegurarse de que el código pase todas las pruebas antes de hacer un merge a `main`.

## Notas adicionales

- Mantener el archivo `README.md` actualizado con información relevante del proyecto.
- Eliminar código muerto o archivos no utilizados para mantener el proyecto limpio.

# frontend

- Mantener la lógica de negocio en servicios separados de los componentes.
- Documentar cada componente y servicio con comentarios claros.
- Seguir las buenas prácticas de Angular para asegurar escalabilidad y mantenibilidad.
- Asegurarse de que los componentes visuales no dependan directamente del código generado por
  Todo lo visual debe estar en ingles, pero la logica de negocio y los comentarios pueden estar en español para facilitar la comprensión del equipo. pero las variables y funciones deben estar en ingles para mantener una buena práctica de programación y facilitar la colaboración con otros desarrolladores que puedan no hablar español.
  OpenAPI, usando wrappers para proteger el contrato generado.
- Configurar la base URL del backend de manera centralizada usando environments y constantes compartidas.
- Usar operadores de control de flujo modernos de Angular para evitar duplicación en plantillas.
- Mantener strict mode de TypeScript y tipado estricto de respuestas OpenAPI.
- Priorizar compatibilidad con la versión actual de Angular.
- Al integrar una nueva app científica en el backend, seguir el proceso de verificación técnica para asegurar que el frontend se actualiza correctamente y que los endpoints de la nueva app están disponibles y documentados en la UI de OpenAPI.
- Todo endpoint del backend, si es consumido por HTTP/HTTPS, debe ser consumido a través de los contratos generados por OpenAPI, y no debe ser consumido directamente, para asegurar que el contrato se mantiene consistente y que cualquier cambio en el backend se refleja correctamente en el frontend, evitando así problemas de integración o errores de consumo de endpoints que no estén actualizados; clara excepcion a esto en los archivos spec de pruebas unitarias, donde se pueden consumir directamente los endpoints para probar su funcionalidad e inclusive conseguir trazabilidad completa de las pruebas, pero fuera de los archivos de pruebas unitarias, cualquier consumo de endpoints debe hacerse a través de los contratos generados por OpenAPI, para mantener la consistencia y la integridad del proyecto.

los test no deben ser pruebas de reaccion de codigo, se debe pensar claramente en cada test que se va a probar, y escribir pruebas unitarias que prueben la funcionalidad específica de cada componente o servicio, evitando pruebas que simplemente reaccionen a cambios en el código sin un objetivo claro, es importante que cada prueba tenga un propósito específico y que pruebe una funcionalidad concreta, para asegurar que las pruebas sean efectivas y útiles para mantener la calidad del código, y para evitar tener pruebas que no aporten valor o que simplemente reaccionen a cambios sin un objetivo claro.
los test deben tener comentarios cada uno explicando claramente lo que se esta probando, y el objetivo de cada prueba, para asegurar que las pruebas sean fáciles de entender y mantener, y para facilitar la colaboración entre desarrolladores, es importante que cada prueba tenga un comentario claro que explique lo que se esta probando y el objetivo de la prueba, para asegurar que las pruebas sean efectivas y útiles para mantener la calidad del código, y para evitar tener pruebas que no aporten valor o que simplemente reaccionen a cambios sin un objetivo claro, tambien ayuda a saber que debe hacer el codigo y se puede llegar a entender si el codigo cumple con lo que se espera que haga, y si no es así, se puede identificar claramente que parte del codigo no esta cumpliendo con lo que se espera, y se puede corregir de manera efectiva, por eso es importante que cada prueba tenga un comentario claro que explique lo que se esta probando y el objetivo de la prueba, para asegurar que las pruebas sean efectivas y útiles para mantener la calidad del código, y para evitar tener pruebas que no aporten valor o que simplemente reaccionen a cambios sin un objetivo claro.
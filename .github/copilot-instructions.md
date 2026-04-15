---
applyTo: "**/*"
name: "Instrucciones Generales de Desarrollo y Mejores Prácticas para el Proyecto"
description: " Reglas generales de codificación, estructura, documentación, ambientación, verificación, mantenibilidad, manejo de tipado y errores, tests y ejecución para el proyecto."
---

# Instrucciones Generales de Desarrollo y Mejores Prácticas para el Proyecto

## Reglas de Codificación

- Usar comentarios en español.
- No usar código duplicado.
- Preferir funciones pequeñas.
- Generar tests unitarios.
- Explicar lógica compleja.
- Funciones y variables en inglés muy descriptivas.
- Evitar dependencias innecesarias.
- Solo crear un README.md.
- No crear documentación .md adicional no solicitada.
- Poner en todos los archivos un encabezado con el nombre del archivo y una breve descripción de su función.
- Usar nombres de variables y funciones descriptivos.
- Evitar el uso de variables globales.
- Manejar errores de manera adecuada.
- Mantener el código limpio y organizado.
- Seguir las mejores prácticas de programación.
- Evitar el uso de código obsoleto.
- Usar arquitecturas por capas.
- Siempre se puede usar el navegador web integrado para verificar los cambios del frontend.
- Separar responsabilidades en diferentes archivos y carpetas.
- Usar patrones de diseño cuando sea apropiado.
- Mantener la coherencia en el estilo de codificación.
- Usar control de versiones de manera efectiva.
- Seguir las convenciones de programación para código de ciencia.

### Prioridades técnicas obligatorias

- El tipado estricto es una prioridad máxima del proyecto y debe aplicarse siempre antes de aceptar soluciones rápidas o dinámicas.
- Todo parámetro, retorno, estructura intermedia, callback, DTO, serializer, servicio y utilidad compartida debe estar tipado explícitamente.
- Se debe priorizar programación modular real: archivos cohesivos, responsabilidades separadas y componentes pequeños bien contenidos.
- Se debe priorizar programación funcional real cuando mejore claridad: composición, funciones puras, transformaciones de datos, inmutabilidad y reducción de efectos secundarios ocultos.
- Para manejo de errores se deben preferir mónadas o estructuras equivalentes como Result, Either, Option o Maybe antes que excepciones como flujo principal.
- Se debe mantener una orientación a objetos correcta: encapsulamiento, abstracción, cohesión alta, bajo acoplamiento y responsabilidades bien delimitadas.
- En programación orientada a objetos se debe encapsular correctamente el estado interno y evitar exponer o mutar campos directamente sin control.
- En Python y en otros lenguajes con soporte equivalente se deben preferir decoradores, properties, getters/setters bien justificados y APIs explícitas para proteger invariantes del dominio.
- No romper POO por escribir código demasiado directo: si una entidad necesita control sobre sus datos, debe contener ese comportamiento dentro de la clase correspondiente.
- Aplicar patrones de diseño cuando aporten claridad y mantenibilidad: Factory, Builder, Adapter, Facade, Repository, Dependency Injection, Strategy y Observer.

## Estructura y Documentación

- Solo existirá un .md, el README.md y los que están en la carpeta .github/instructions/ con las instrucciones para Copilot, no se crearán otros archivos de documentación .md adicionales no solicitados.
- No crear .md adicionales como para decir cosas de fases o cosas así, solo se usará el README.md para documentar el proyecto y los archivos .md en la carpeta .github/instructions/ para las instrucciones de Copilot, no se crearán otros archivos de documentación .md adicionales no solicitados.

## Ambientación del Proyecto y Ejecución

- Al ambientar el proyecto debe quedar claro que el usuario puede ejecutar el código en su máquina local o en un servidor, y que se pueden usar diferentes IDEs o editores de texto para trabajar con el código.
- No crear archivos .sh (al menos que se pida específicamente) para ejecutar comandos, se deben ejecutar directamente con el entorno virtual o npm scripts, de tal forma que el usuario pueda ejecutar los comandos sin necesidad de usar scripts adicionales, por ejemplo: `./.venv/bin/python manage.py test` o `npm run build`.

## Verificación Continua y Mantenimiento del Código

- Se debe verificar que todo esté bien conectado y funcionando, continuamente verificar y eliminar cualquier código que no funcione o que no se integre correctamente, para mantener un proyecto limpio y funcional, eliminando cualquier código muerto o archivos que no se usen, y asegurando que todo el código que quede sea funcional y esté bien integrado en el proyecto.

## Mantenibilidad y Tamaño de Archivos

- Tratar dentro de lo posible que cualquier archivo no mida más de 400 líneas, si es necesario dividirlo en varios archivos para mantener la legibilidad y mantenibilidad del código.
- Tratar como muy importante que los archivos de código tengan un tamaño aproximado de 200 - 400 líneas, aunque se necesite dividirlo en varios archivos para mantener la legibilidad y mantenibilidad del código, es importante no crear archivos con menos de 100 líneas, y como máximo 600 líneas, pero esto dedicado a casos excepcionales, lo ideal es mantener los archivos entre 200 y 400 líneas, para asegurar que el código sea fácil de leer y mantener, los que son demasiado largos tienden a ser SCSS o HTML, pero si se puede dividir en componentes más pequeños, es preferible hacerlo para mantener la claridad y organización del proyecto. Pero código como Python, TypeScript, etc., es importante mantenerlo entre 200 y 400 líneas para asegurar que sea fácil de leer y mantener.

  NUNCA superar las 600 líneas.

  Al refactorizar o eliminar código no tener miedo de eliminar archivos completos si es necesario, siempre y cuando se mantenga la funcionalidad del proyecto, es importante mantener el proyecto limpio y organizado, eliminando cualquier código que no se use o que no funcione correctamente, para asegurar que el proyecto sea fácil de mantener y entender.

  También si se elimina una funcionalidad completa, eliminar cualquier archivo relacionado con esa funcionalidad, para mantener el proyecto limpio y organizado, y evitar confusiones o código muerto en el proyecto.

  Al igual si una funcionalidad se divide en varias partes, crear archivos separados para cada parte, para mantener la claridad y organización del proyecto, y evitar tener archivos demasiado largos o con demasiada funcionalidad, lo ideal es mantener cada archivo con una funcionalidad clara y específica, para asegurar que el código sea fácil de leer y mantener.

## Manejo de Tipado y Errores de Estilo

- El tipado fuerte y explícito debe considerarse prioridad máxima en cualquier lenguaje usado en el proyecto.
- Siempre tipar todo lo que sea razonable: funciones, métodos, propiedades, parámetros, retornos, colecciones, estructuras compartidas, errores y contratos entre capas.
- Si existe tensión entre rapidez de implementación y calidad del tipado, se debe priorizar el tipado correcto.
- Cuando haya problemas de tipado por tipado insuficiente tratar de crear los tipos para solucionarlo, tratar dentro de lo factible no usar `# type: ignore` al igual que ts-ignore, es importante tratar de mantener el código lo más tipado posible, para asegurar que sea fácil de entender y mantener, y para aprovechar las ventajas del tipado estático, como la detección temprana de errores y la autocompletación en los editores de código, si es necesario crear tipos personalizados para solucionar problemas de tipado, es preferible hacerlo en lugar de usar `# type: ignore` o `// @ts-ignore`, para mantener el código limpio y bien tipado, y evitar tener código con tipado insuficiente o con errores de tipado que puedan causar problemas en el futuro. Así como cualquier error de estilo evitar usar ignore para cualquier error y justificar en caso de que el ignore sea estrictamente necesario, por ejemplo:

  Using http protocol is insecure. Use https instead

  "http://0.0.0.0:4200" # se ignora porque es la URL de desarrollo local, no se expone a internet y no representa un riesgo de seguridad en este contexto, además se usa para facilitar el desarrollo y pruebas locales siempre y cuando se tenga claro que no se expone a internet y no representa un riesgo de seguridad en este contexto, y se debe asegurar que en producción se use HTTPS para garantizar la seguridad de las comunicaciones.

  Así que si se llega a ignorar debe haber razones de peso y una justificación de por qué no ignorarlo.

  Así mismo si se llega a haber problemas de tipo quizás convenga usar mónadas como Maybe o Result para manejar errores de manera más elegante y evitar tener que usar `# type: ignore` para ignorar errores de tipado, esto puede ayudar a mantener el código limpio y bien tipado, y a manejar.

  En dado caso siempre se ignoran los archivos autogenerados **/generated/**, ya que estos archivos son generados automáticamente por herramientas y no deben ser editados manualmente. Así que se insta a modificar los linters y herramientas de análisis estático para que ignoren cualquier error de estilo o tipado en los archivos dentro de la carpeta **/generated/**, ya que estos archivos son generados automáticamente y no deben ser editados.

## Tests y Verificación de Comandos

- Los tests tocan todo el código privado y público a través de las pruebas a puntos públicos.

  Para verificar que el comando acabó es posible agregar un `& echo listo` al final de los comandos, para que al finalizar el comando se imprima "listo" en la consola, lo que indica que el comando ha terminado de ejecutarse, esto es especialmente útil para comandos que pueden tardar un tiempo en ejecutarse o en comandos de tsc.

  De cualquier forma siempre se debe asegurar que hay una salida en la terminal que indique que el comando ha terminado de ejecutarse, ya sea a través de un mensaje personalizado como "listo" o a través de la salida estándar del comando, para asegurarse de que el usuario tenga claro cuándo el comando ha finalizado y pueda continuar con los siguientes pasos sin confusión. Incluso si falla o es exitoso especialmente si es exitoso y este no siempre muestra una salida clara, es importante asegurarse de que haya una indicación clara de que el comando ha terminado, para evitar confusiones o incertidumbre sobre el estado del proceso. Esto es especialmente importante en comandos que pueden tardar un tiempo en ejecutarse, para que el usuario sepa cuándo puede continuar con los siguientes pasos sin tener que adivinar si el comando ha terminado o no.

Aquí tienes las instrucciones en forma general (agnósticas al lenguaje), redactadas para un LLM:

---

# Instrucciones de diseño: manejo de errores y estilo declarativo

## Manejo de errores

- No uses excepciones como mecanismo principal de control de flujo.
  Usa estructuras tipadas que representen éxito y error.
- No retornes `null`, `undefined` o valores ambiguos para indicar fallos.
  Representa los errores de forma explícita en el tipo de retorno.
- Modela los errores como datos.
  Define estructuras claras para los errores en lugar de usar strings o códigos sin contexto.
- Propaga errores de forma explícita.
  Evita bloques anidados de control de errores; prefiere composición.

---

## Uso de mónadas

- Usa abstracciones como `Result`, `Either`, `Option` o equivalentes para encapsular valores.
- Encadena operaciones usando `map`, `flatMap` (o equivalente) en lugar de lógica imperativa.
- No extraigas valores de la mónada antes de tiempo.
  Mantén la composición hasta el final del flujo.
- Evita condicionales repetitivos (`if`, `switch`) sobre estados de error.
  Usa composición funcional.

---

## Estilo declarativo

- Prefiere un estilo declarativo sobre uno imperativo cuando mejore la legibilidad.
- Describe qué se quiere hacer en lugar de cómo hacerlo paso a paso.
- Usa funciones puras siempre que sea posible.
- Evita efectos secundarios ocultos.

---

## Tipado

- Usa tipado fuerte y explícito para modelar flujos de datos.
- Asegura que los tipos representen correctamente todos los estados posibles (incluyendo errores).
- Evita tipos ambiguos o genéricos débiles.

---

## Legibilidad

- Prioriza la legibilidad sobre la abstracción excesiva.
- No introduzcas mónadas o patrones funcionales si hacen el código más difícil de entender.
- Usa composición funcional solo cuando haga el flujo más claro.

---

## Reglas generales

El código debe ser lo más declarativo, tipado y expresivo posible, pero siempre priorizando la claridad.

Si el uso de mónadas o abstracciones funcionales reduce la legibilidad o complica el código innecesariamente, se debe preferir una solución más simple.

Todas las reglas pueden ser ignoradas si se justifica claramente que hacerlo mejora la claridad o la mantenibilidad del código en ese caso específico, pero no se deben ignorar sin una razón de peso y una justificación clara bien comentada en el lugar del código donde se ignore la regla, explicando por qué se decidió ignorar esa regla en ese caso específico, y cómo esa decisión mejora la claridad o la mantenibilidad del código en ese contexto particular.

## Prioridad de paradigmas

Los paradigmas no compiten: se complementan y deben combinarse correctamente.

| Paradigma   | Enfoque principal          | Control del flujo |
| ----------- | -------------------------- | ----------------- |
| Modular     | Organización del código    | Neutral           |
| Declarativa | Qué hacer                  | Abstracto         |
| Funcional   | Cómo transformar los datos | Funciones         |

Reglas de prioridad:

- primero: tipado estricto y contratos claros
- segundo: modularidad y separación real de responsabilidades
- tercero: estilo declarativo y funcional para flujos de transformación
- cuarto: orientación a objetos bien encapsulada cuando el dominio lo requiera

Ejemplo de composición funcional simple:

```ts
const add = (a, b) => a + b
const double = (x) => x * 2

const result = double(add(2, 3))
```

Este estilo debe preferirse cuando haga el flujo más claro, testeable y mantenible.

## Patrones de diseño y orientación a objetos

Aplicar explícitamente, cuando tenga sentido, los siguientes patrones y principios:

- Factory para creación controlada de objetos complejos
- Builder para construcción paso a paso de estructuras complejas
- Adapter para integrar librerías o servicios externos sin contaminar el dominio
- Facade para simplificar subsistemas y exponer puntos de entrada claros
- Repository como patrón arquitectónico para acceso a datos desacoplado
- Dependency Injection para reducir acoplamiento y facilitar pruebas
- Strategy para intercambiar algoritmos sin condicionales dispersos
- Observer para eventos, notificaciones y flujos reactivos desacoplados
- Encapsulamiento, abstracción, cohesión alta y bajo acoplamiento como base de la programación orientada a objetos correcta

### Encapsulación correcta de campos

- No exponer campos internos de forma pública si la clase necesita validar, transformar o proteger su estado.
- Preferir acceso controlado mediante propiedades, decoradores y métodos expresivos en lugar de manipulación externa directa.
- En Python se deben preferir `@property`, `@<campo>.setter`, `@classmethod`, `@staticmethod` y otros decoradores cuando mejoren encapsulación y claridad.
- En otros lenguajes se debe seguir el equivalente idiomático: getters, setters restringidos, modificadores de acceso y métodos del dominio bien contenidos.
- Evitar clases anémicas donde toda la lógica viva fuera del objeto si el comportamiento pertenece naturalmente a esa entidad.

# Tokens

## Regla principal

Minimiza tokens sin sacrificar precisión.

## Formato

- Prefiere listas cortas o código directo.
- Máximo 5–8 líneas si no se pide explicación.
- Si es código: solo devuelve el código.

## Instrucciones

- Responde con la menor cantidad de texto posible.
- No expliques lo obvio.
- No repitas la pregunta.
- No agregues contexto innecesario.
- No uses introducciones ni conclusiones.

## Explicaciones

- Solo si el usuario lo pide explícitamente.
- Si explicas: máximo 3 puntos clave.

## Prohibido

- Emojis
- Frases de relleno ("Claro", "Aquí tienes", etc.)
- Ejemplos innecesarios

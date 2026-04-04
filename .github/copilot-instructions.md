- Usar comentarios en español
- No usar código duplicado
- Preferir funciones pequeñas
- Generar tests unitarios
- Explicar lógica compleja
- funciones y variables en ingles muy descriptivas
- Evitar dependencias innecesarias
- Solo crear un README.md
- No Crear documentacion .md adicional no solicitada
- poner en todos los archivos un encabezado con el nombre del archivo y una breve descripción de su función
- Usar nombres de variables y funciones descriptivos
- Evitar el uso de variables globales
- Manejar errores de manera adecuada
- Mantener el código limpio y organizado
- Seguir las mejores prácticas de programación
- Evitar el uso de código obsoleto.
- usar arquitecturas por capas
- separar responsabilidades en diferentes archivos y carpetas
- usar patrones de diseño cuando sea apropiado
- mantener la coherencia en el estilo de codificación
- usar control de versiones de manera efectiva
- Solo existira un .md, el README.md y los que estan en la carpeta .github/instructions/ con las instrucciones para copilot, no se crearan otros archivos de documentacion .md adicionales no solicitados
- no crear .md adicionales como para decir cosas de phases o cosas asi, solo se usara el README.md para documentar el proyecto y los archivos .md en la carpeta .github/instructions/ para las instrucciones de copilot, no se crearan otros archivos de documentacion .md adicionales no solicitados
- seguir las convenciones de programacion para codigo de ciencia
- al ambientarse debe quedar claro que el usuario puede ejecutar el código en su máquina local o en un servidor, y que se pueden usar diferentes IDEs o editores de texto para trabajar con el código
- No crear archivos .sh (al menos que se pida especificamente) para ejecutar comandos, se deben ejecutar directamente con el entorno virtual o npm scripts, de tal forma que el usuario pueda ejecutar los comandos sin necesidad de usar scripts adicionales, por ejemplo: `./venv/bin/python manage.py test` o `npm run build`
- se debe verificar que todo este bien conectado y funcionando, continuamente verificar y eliminar cualquier código que no funcione o que no se integre correctamente, para mantener un proyecto limpio y funcional, eliminando cualquier codigo muerto o archivos que no se usen, y asegurando que todo el código que quede sea funcional y esté bien integrado en el proyecto

- Tratar dentro de lo posible que los archivos cualquier archivo no mida mas de 400 lineas, si es necesario dividirlo en varios archivos para mantener la legibilidad y mantenibilidad del código.

- Tratar como muy importante que los archivos de codigo tengan un tamaño aproximado de 200 - 400 lineas, aunque se necesite dividirlo en varios archivos para mantener la legibilidad y mantenibilidad del código, es importante no crear archivos con menos de 100 lineas, y como maximo 600 lineas, pero esto dedicado a casoso excepcionales, lo ideal es mantener los archivos entre 200 y 400 lineas, para asegurar que el código sea fácil de leer y mantener, los que son demasiado largos tienden a ser scss o html, pero si se puede dividir en componentes mas pequeños, es preferible hacerlo para mantener la claridad y organización del proyecto. pero codigo como python, typescript, etc, es importante mantenerlo entre 200 y 400 lineas para asegurar que sea fácil de leer y mantener.
  NUNCA superar las 600 lineas.
  Al refactorizar o eliminar codigo no tener miedo de eliminar archivos completos si es necesario, siempre y cuando se mantenga la funcionalidad del proyecto, es importante mantener el proyecto limpio y organizado, eliminando cualquier código que no se use o que no funcione correctamente, para asegurar que el proyecto sea fácil de mantener y entender.
  tambien si se elimina una funcionalidad completa, eliminar cualquier archivo relacionado con esa funcionalidad, para mantener el proyecto limpio y organizado, y evitar confusiones o código muerto en el proyecto.
  al igual si una funcionalidad se divide en varias partes, crear archivos separados para cada parte, para mantener la claridad y organización del proyecto, y evitar tener archivos demasiado largos o con demasiada funcionalidad, lo ideal es mantener cada archivo con una funcionalidad clara y específica, para asegurar que el código sea fácil de leer y mantener.
  Cuando haya problemas de tipado por tipado insuficiente tratar de crear los tipara solucionarlo tratar dentro de lo factible no usar `# type: ignore` al igual que ts-ignore, es importante tratar de mantener el código lo más tipado posible, para asegurar que sea fácil de entender y mantener, y para aprovechar las ventajas del tipado estático, como la detección temprana de errores y la autocompletación en los editores de código, si es necesario crear tipos personalizados para solucionar problemas de tipado, es preferible hacerlo en lugar de usar `# type: ignore` o `// @ts-ignore`, para mantener el código limpio y bien tipado, y evitar tener código con tipado insuficiente o con errores de tipado que puedan causar problemas en el futuro. asi como cualquir error de estilo evitar usar ignore para cualquier error y justificar en caso de que el ignore sea estrictamente necesario, p
  por ejemplo  
  Using http protocol is insecure. Use https instead
  "http://0.0.0.0:4200" #se ignora porque es la url de desarrollo local, no se expone a internet y no representa un riesgo de seguridad en este contexto, además se usa para facilitar el desarrollo y pruebas locales, y no se utiliza en producción donde se debe usar https para garantizar la seguridad de las comunicaciones. eso tiene sentido y poner un https local con un certificado autofirmado para desarrollo local es posible pero puede generar problemas de configuración y uso, por lo que en este caso se prefiere usar http para desarrollo local, siempre y cuando se tenga claro que no se expone a internet y no representa un riesgo de seguridad en este contexto, y se debe asegurar que en producción se use https para garantizar la seguridad de las comunicaciones.
  asi que si se llega a ignorar debe haber razones de peso y una justificacion de porque no ignorarlo
  asi mismo si se llega haber problemas de tipo quizas convenga usar monados como Maybe o Result para manejar errores de manera más elegante y evitar tener que usar `# type: ignore` para ignorar errores de tipado, esto puede ayudar a mantener el código limpio y bien tipado, y a manejar
  En dado caso siempre se ignoran los archivos autogenerados **/generated/**, ya que estos archivos son generados automáticamente por herramientas y no deben ser editados manualmente. asi que se insta a modificar los linters y herramientas de análisis estático para que ignoren cualquier error de estilo o tipado en los archivos dentro de la carpeta **/generated/**, ya que estos archivos son generados automáticamente y no deben ser editados.
- los test tocan todo el codigo privado y publico a traves de las pruebas a puntos publicos.

para verificar que el comando acabo es posible agregar un & echo listo al final de los comandos, para que al finalizar el comando se imprima "listo" en la consola, lo que indica que el comando ha terminado de ejecutarse, esto es especialmente útil para comandos que pueden tardar un tiempo en ejecutarse o en comandos de tsc 
de cualquier forma siempre se debe asegurar que hay una salida en la tarminal que indique que el comando ha terminado de ejecutarse, ya sea a través de un mensaje personalizado como "listo" o a través de la salida estándar del comando, para asegurarse de que el usuario tenga claro cuándo el comando ha finalizado y pueda continuar con los siguientes pasos sin confusión. incluso si falla o es exitoso especialmente si es exitoso y este no siempre muestra una salida clara, es importante asegurarse de que haya una indicación clara de que el comando ha terminado, para evitar confusiones o incertidumbre sobre el estado del proceso. esto es especialmente importante en comandos que pueden tardar un tiempo en ejecutarse, para que el usuario sepa cuándo puede continuar con los siguientes pasos sin tener que adivinar si el comando ha terminado o no.
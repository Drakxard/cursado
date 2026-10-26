# Sincronización sin reiniciar la vista

La recepción remota usa reconciliación por ID. Los objetos sin cambios conservan
sus referencias, incluidas las propiedades anidadas: mover una figura no vuelve
a calcular los gráficos ni sustituye las tablas y los reproductores existentes.
Las listas de gráficos, videos y tablas solo notifican a React si cambiaron.

Los cursores y los trazos en vivo se pintan en sus capas de superposición, sin
repintar el documento. Los cambios confirmados se aplican en memoria y se pintan
agrupados en el siguiente `requestAnimationFrame`. La cámara permanece local.
Se mantiene la selección por ID; los índices de trazos se reasocian por su ID
cuando cambia el orden. Se descartan únicamente las selecciones eliminadas.

Las actualizaciones remotas se incorporan también a los puntos de Deshacer y
Rehacer: una acción personal no debe quitar agregados ajenos ni revertir sus
propiedades. Estas copias no comparten objetos mutables con la escena actual.
Los snapshots completos de recuperación usan la misma reconciliación visual.

Referencias consultadas: [reconciliación de Excalidraw](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/data/reconcile.ts)
y [cambios remotos y estado personal en tldraw](https://tldraw.dev/sdk-features/collaboration).
La adaptación conserva el protocolo y las reglas de combinación existentes.

Validación: `tests/scene-reconciliation.test.mts` comprueba las referencias y el
historial. `tests/board-context-tools.browser.mjs` verifica que los cursores y
trazos no repinten el documento, y que una edición remota real mantenga el
editor enfocado, la posición del cursor de escritura, la tabla y Deshacer.

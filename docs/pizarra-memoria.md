# Memoria de la pizarra

La implementación y las mediciones de vistas previas persistentes e inicio de
Estudio del 2026-10-25 se detallan en [Imágenes escalables](pizarra-imagenes-rendimiento.md).

La pizarra conserva los archivos originales en almacenamiento. Las vistas previas
se decodifican según zoom, tamaño mostrado y densidad de pantalla, con un presupuesto
conjunto de 64 MiB y un máximo de dos operaciones simultáneas. Los recursos que salen
de pantalla, se borran o pertenecen a una pizarra cerrada liberan sus píxeles. Los
resultados tardíos no vuelven a incorporarse. El presupuesto es de la caché retenida;
no limita la RAM total del navegador ni los buffers transitorios del decodificador.

Los lectores PDF sin fijar se desmontan al cerrar. El último PDF fijado conserva
un único lector, documento y worker al ocultarse, con sus páginas visibles y sus
anotaciones pendientes. Se liberan las demás páginas y se pausa la cola de
renderizado, sin detener los guardados. Al volver se conserva página, zoom y
desplazamiento sin recargar el documento. Cambiar el PDF, desfijarlo estando oculto
o abandonar la pizarra desmonta el lector anterior. Las posiciones de otros PDF
se limitan a 50 por contexto; los resultados de búsqueda restauran scroll.

El lector de pizarra retiene hasta tres páginas y 64 MiB nominales de canvas.
Las páginas actualmente visibles tienen prioridad y mantienen su resolución,
incluso si por sí solas exceden esos límites; en ese caso se descartan las demás.
No se renderizan páginas anticipadamente fuera de pantalla. Se cuentan también
los canvas de detalle y se vuelve a comprobar el presupuesto al terminar cada
renderizado. Este presupuesto no incluye buffers transitorios ni toda la memoria
interna de PDF.js. La política está aislada en `public/pdfjs/web/board-memory.mjs`
y se integra mediante cambios pequeños en el visor vendorizado; al actualizar
PDF.js hay que conservar esa integración y ejecutar sus pruebas de navegador.

Los accesos directos a PDF y pizarras conservan referencias, sin abrir sus destinos.
La biblioteca local proyecta únicamente metadatos con un cursor, sin acumular el
contenido, borradores ni `draftBase` de todas las pizarras. La lista de copias
compartidas disponibles sin conexión consulta únicamente claves de IndexedDB.
No cambia el formato almacenado. Calculadora, ecuaciones y gráficos cargan el
motor matemático al utilizarse y comparten una única instancia con configuración
predeterminada. Los botones de PDF fijados no inicializan ese motor.

La importación carga PDF.js bajo demanda y destruye su tarea y canvas al finalizar
o fallar; desmontar la pizarra cancela una importación pendiente. El historial sigue
conservando cinco cambios, con copias independientes de los datos editables.

## Medición del lector PDF (2026-10-24)

Se comparó el mismo PDF de 14 páginas incluido en PDF.js, en Chromium con viewport
1366 × 768, DPR 1 y zoom 180 %. El visor predeterminado y el de pizarra recorren las
mismas 14 páginas en la misma instancia del navegador. Después se oculta y muestra
el lector fijado veinte veces. La recolección de basura se fuerza antes de medir
el heap. Son datos sintéticos, no el PDF ni los 638 MB de la captura del usuario.

| Recurso | Predeterminado tras recorrer | Pizarra tras recorrer | Pizarra tras veinte ciclos |
| --- | ---: | ---: | ---: |
| Canvas con píxeles | 10 | 3 | 1 |
| Canvas, MiB nominales | 106,4 | 31,9 | 10,6 |
| Heap JavaScript, bytes | 9006600 | 8094880 | 7879740 |
| Nodos DOM | 10712 | 10697 | 10693 |
| Listeners | 292 | 287 | 286 |
| Iframes / workers | 1 / 1 | 1 / 1 | 1 / 1 |

La reducción de canvas retenidos al recorrer es del 70 %. No es una reducción del
70 % de la RAM total. El working set agregado de los procesos de esa instancia fue
860098560, 735174656 y 730759168 bytes respectivamente; incluye navegador, GPU y
workers, y está afectado por el historial del asignador. Tampoco equivale al
indicador de memoria de una pestaña de Chrome.

La prueba verifica que los veinte ciclos no vuelven a descargar el PDF ni crean
otro worker, conservan el mismo documento y sus anotaciones, y liberan el worker
al desmontar. También cubre ocultar durante la carga, reabrir, reemplazar y cerrar
antes de inicializar. El puente React se prueba aparte para validar origen,
ventana emisora, sesión y el estado oculto recibido antes de cargar el visor.

Para repetir desde la raíz, sin iniciar un servidor:

```sh
node --test --experimental-strip-types tests/board-pdf-memory.test.mts tests/board-pdf-memory.browser.mjs tests/board-reader-visibility.browser.mjs
```

La salida incluye las métricas crudas. El working set se obtiene con PowerShell
en Windows; en otros sistemas queda en `null`. La prueba de pizarra con 500 accesos
directos y veinte ediciones de textos y conectores comprueba canvas constantes,
heap sin crecimiento mayor de 8 MiB entre las últimas dos muestras, ausencia de
solicitudes de PDF y ausencia de carga del motor matemático. Para repetirla:

```sh
npm run build:pizarra
cd pizarraproyecto-main
node node_modules/@playwright/test/cli.js test tests/browser/memory.spec.mjs --grep "500 shortcuts"
```

## Medición anterior de vistas previas de imágenes

Se midió Chromium con doce originales PNG de 3200 × 2400, mostrados a 300 × 200 en
una ventana de 1366 × 900, DPR 1. Se usó la misma secuencia antes y después: cargar
la pizarra, esperar las doce imágenes, medir, recorrer y volver diez veces, medir.
Los datos son sintéticos; no son una medición del archivo de la captura del usuario.

| Momento | Working set antes | Working set después | Reducción |
| --- | ---: | ---: | ---: |
| Imágenes visibles | 941,6 MiB | 600,1 MiB | 36,3 % |
| Tras diez recorridos | 948,7 MiB | 620,1 MiB | 34,6 % |

El working set suma los procesos de esa instancia de Chromium, incluido GPU y
navegador; **no equivale al indicador de memoria de una pestaña de Chrome**. Los
valores crudos son 987303936 → 629227520 bytes y 994746368 → 650174464 bytes.
El heap JavaScript fue 6538392 → 5954792 bytes al cargar y 7016628 → 6497944 bytes
tras recorrer. Había tres canvas (14752800 bytes nominales), un iframe y un worker
en ambas mediciones; el worker observado en este escenario no era de importación PDF.
DOM tras los recorridos: 203 → 191 nodos y 232 listeners en ambas versiones.

Para repetir, compilar con `npm run build:pizarra`, servir `pizarraproyecto-main/dist`
con Vite preview en el puerto 4173 y ejecutar desde la raíz:

```sh
node scripts/measure-board-memory.mjs resultado.json
```

El script separa heap, working set, DOM, canvas, iframe y workers. El working set se
consulta mediante PowerShell en Windows; en otros sistemas se informa como `null`.
El tamaño del bundle no se utiliza como estimación de memoria.

## Verificación funcional

- Pruebas de caché: reparto del presupuesto, dos decodificaciones, cambios de zoom,
  liberación de recursos borrados y rechazo de cargas tardías al cerrar.
- Chromium: diez ciclos fuera/dentro de pantalla sin retener las vistas previas,
  original de 4000 píxeles intacto, borrado y deshacer; workers PDF ausentes después
  de una importación válida y otra inválida.
- Lectores: diez aperturas/cierres sin iframe retenido, restauración de coordenadas
  al cambiar documentos y cierre mientras todavía carga.
- Resultados PDF: diez aperturas/cierres, solo un lector activo y scroll restaurado.
- Regresiones: recorte, exportación/captura desde originales, tablet, cinco niveles
  de deshacer y colaboración con dos usuarios. Visor PDF real: cerrar/reabrir con
  zoom restaurado y captura de imagen, tabla y gráfico.

La prueba integral general de biblioteca también se intentó: no pudo encontrar el
ancestro `div[draggable=true]` del material de su fixture y terminó por timeout antes
de abrir el lector. La prueba específica con el visor PDF real sí pasó. Este fallo
general no se cuenta como una verificación exitosa ni como una regresión descartada.

# Diagnóstico del zoom de la pizarra

Los cambios del documento recibidos durante la transformación de cámara se
acumulan hasta que termina el gesto. La invalidación de datos sigue siendo
inmediata y el render final lee la versión más reciente. Iniciar una interacción
con un objeto fuerza la reconciliación antes del hit-test. Esto evita que cada
edición o carga entrante interrumpa el zoom con un recorrido completo del tablero.
La regresión se cubre en `e2e/camera-direct.spec.ts` con cambios de texto durante
doce cuadros de zoom, comprobando ausencia de reconciliaciones durante el gesto
y aparición de la última revisión al terminar.

Gestos de navegación: **rueda sola desplaza verticalmente** y **Ctrl + rueda hace
zoom alrededor del puntero**. Los deltas de rueda se normalizan en píxeles, líneas
y páginas; el desplazamiento mantiene la misma distancia en pantalla a cualquier
nivel de zoom. El pellizco táctil y los botones de zoom conservan su comportamiento.

La prueba reproduce una pizarra con 2.400 notas/formas y 600 trazos. Usa dos
contextos independientes conectados al Worker local; comprueba presencia, texto
remoto, actualización del contenido y confirmación del texto después del zoom.
No usa credenciales ni escribe en Cloudflare de producción.

## Causas corregidas

- Las siete variables CSS de la cuadrícula cambiaban en `#board` y se heredaban
  a todo el contenido. Incluso el zoom que solo transformaba la capa provocaba
  recálculo de estilos en los objetos. La cuadrícula ahora es un elemento hermano
  independiente, con sus variables y su pintura aisladas.
- Un editor remoto abierto desactivaba la transformación rápida de la cámara.
  Además, los eventos de presencia interrumpían esa transformación y repintaban
  el texto remoto aunque su contenido no hubiera cambiado. Ahora se compara el
  contenido y color del editor; un cambio real sigue actualizándose y la cámara
  se reconcilia antes de aplicar su geometría.
- El zoom podía volver a recorrer y posicionar objetos al salir del margen
  cacheado aunque ya estuvieran todos montados. Esa reconciliación se aplaza hasta
  que termina el gesto cuando no hay objetos adicionales que descubrir.

La sincronización Yjs, el protocolo de mensajes y el almacenamiento no cambian.

## Regresión por adaptación nocturna (4 de noviembre de 2026)

El observador de colores añadido para la lectura nocturna también recibía las
mutaciones de estilo de `.text-layer` y `.canvas-grid`. Cada cuadro de cámara
volvía a consultar y recorrer todos los textos y trazos, aunque no cambiaran sus
colores. La transformación rápida de cámara seguía funcionando, pero este trabajo
se añadía fuera de sus contadores de layout. Afectaba también al modo claro.

Ahora las mutaciones de atributos solo se procesan dentro de textos, trazos e
imágenes. Los cambios de tema conservan el recorrido completo necesario para
aplicar o restaurar la paleta. La prueba `tests/night-readability.browser.mjs`
comprueba que doce cuadros de cámara no consulten descendientes y que editar
colores y regresar al modo claro siga funcionando.

## Pruebas y artefactos

El workflow **Fluidez del zoom y colaboracion** se ejecuta en push y pull request
con cambios en `pizarra-sync/`, y también mediante **Run workflow**. Conserva el
reporte HTML, los JSON y el perfil de CPU durante 14 días. No reintenta fallos.

```powershell
cd pizarra-sync
pnpm.cmd exec playwright install chromium
pnpm.cmd exec playwright test e2e/perf.spec.ts e2e/camera-direct.spec.ts e2e/viewport.spec.ts --workers=1
```

En Linux usar `pnpm` en lugar de `pnpm.cmd`. Para un navegador instalado se puede
definir `E2E_BROWSER_PATH` con la ruta de su ejecutable.

- `zoom-sweeps.json`: cuadros p50/p95/máximo, cantidad de cuadros y costos/cantidad
  de llamadas durante rueda y Ctrl+rueda, con vistas cercanas y tablero completo.
- `zoom-profile.json`: trabajo durante 60 cuadros de zoom con un editor remoto
  abierto y cambios de presencia. No debe recorrer ni posicionar miles de objetos.
- `chrome-metrics.json`: diferencias de las métricas de Chrome durante esa fase.
  El presupuesto de recálculo de estilos es de 5 ms por cuadro medido.
- `zoom.cpuprofile`: abrir en DevTools → Performance → Load profile para examinar
  las pilas de CPU. Los tiempos de métodos anidados no deben sumarse entre sí.

Los cuadros se comparan con un tablero vacío medido en la misma ejecución:
p50 debe ser menor que `max(100 ms, vacío × 2)` y p95 menor que
`max(1.000 ms, vacío × 2)`. Se mantienen los techos de la prueba anterior en equipos
rápidos y se calibra contra el tablero vacío cuando el runner ya es lento. Estos
barridos incluyen montar y reconciliar miles de objetos al atravesar el rango de
zoom; son techos de regresión, no objetivos de fluidez. El perfil del gesto continuo
aplica por separado los presupuestos de trabajo y estilos. Se informan ambos valores, no se oculta una referencia
lenta. Esta comparación controla regresiones por tamaño; no certifica 60 FPS.
Los contadores de trabajo y el aislamiento CSS aportan comprobaciones adicionales
que no dependen de la velocidad de refresco del runner.

## Evidencia local

En Chromium headless de Windows, una medición de 60 cuadros con 3.000 elementos
acumuló 5.723 ms de recálculo de estilos antes de aislar la cuadrícula. Con la
cuadrícula separada, una ejecución comparable acumuló 38 ms, y el zoom no llamó a
`recull`, `layout`, `paintStroke` ni `paintConnector` durante el gesto con editor
remoto y cambios de presencia.

También se volvió a ejecutar la prueba con el código anterior de `text-layer.ts`,
manteniendo la cuadrícula ya aislada para separar ambas causas. La prueba falló
por el trabajo repetido. En dos ejecuciones consecutivas se obtuvo:

| Durante 60 cuadros con editor remoto | Código anterior | Corregido |
| ------------------------------------ | --------------: | --------: |
| Llamadas a `recull`                  |              60 |         0 |
| Llamadas a `layout`                  |         144.120 |         0 |
| Llamadas a `paintStroke`             |          36.000 |         0 |
| p50 del cuadro                       |          489 ms |    148 ms |
| p95 del cuadro                       |          600 ms |    216 ms |

Los perfiles y contadores se recogen antes de que termine el gesto; la
reconciliación final sigue siendo necesaria para recuperar el detalle y el
conjunto de objetos visibles. Las métricas de Chrome pueden incluir esa
reconciliación si ocurre antes de responder al comando de diagnóstico.

Estos tiempos corresponden a ese escenario y equipo. El navegador automatizado
también mostró cuadros lentos con la pizarra vacía. Hace falta verificar la
sensación visual en el navegador y equipo habituales; los resultados locales no
permiten prometer fluidez absoluta para cualquier tablero o dispositivo.

## Cuadr?cula y navegaci?n con pocos elementos (7 de noviembre de 2026)

La cuadr?cula CSS de dos gradientes radiales se volv?a a rasterizar al cambiar
su tama?o, posici?n y transparencia en cada cuadro. El costo exist?a incluso
sin objetos. En Chrome headless local, un barrido alternado de 40 cuadros dio
medianas de 69?84 ms con la cuadr?cula anterior y aproximadamente 17 ms al
ocultarla. Es una comparaci?n exploratoria de esta m?quina, no una medici?n
del equipo del usuario.

`viewport-grid.ts` sustituye esos gradientes por un canvas del tama?o de la
pantalla. Los puntos se dibujan una sola vez en una peque?a baldosa y se repiten
con `CanvasPattern`; las l?neas usan dos trazados. Conserva las dos escalas,
la transici?n de densidad, el anclaje al mundo, el tema y el DPR. No transforma
ni reduce las im?genes del documento. La c?mara y el fondo se presentan en el
mismo cuadro; el porcentaje de zoom se notifica solo cuando cambia.

La prueba `e2e/camera-grid.spec.ts` compara la cuadr?cula visible y oculta con
0 y 8 notas, en la misma sesi?n. En la corrida local ambas medianas quedaron
en 16,7?16,8 ms; el P95 con cuadr?cula fue 18,2 ms sin objetos y 21,9 ms con
8 notas. El reporte `grid-frame-times.json` se adjunta a Playwright. La prueba
usa un umbral relativo para detectar regresiones, no para garantizar 60 FPS
en cualquier dispositivo. El perfil de 3.000 objetos con un editor remoto
registr? P50 22,8 ms y P95 50,9 ms, sin llamadas a `recull`, `layout`,
`paintStroke` ni `paintConnector` durante los 60 cuadros del gesto.

Validaciones adicionales: arrastre desde el primer p?xel, reversi?n y cancelaci?n,
zoom anclado al puntero, pellizco, selecci?n, cambios de documento durante el
zoom, puntos/l?neas y cambio de tema en DPR 1 y 2, TypeScript y build de Vite.
Los tests sint?ticos apuntan al canvas de Konva expl?citamente, para no enviar
los eventos al nuevo canvas de fondo.

Referencias consultadas: [motor de Figma con WebGPU](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/)
y [c?mara de tldraw](https://tldraw.dev/sdk-features/camera). Figma usa un motor
gr?fico propio; en esta aplicaci?n el costo aislado se resolvi? en el fondo,
sin sustituir el motor ni agregar animaciones a la navegaci?n.

```powershell
node --test tests/viewport-grid.browser.mjs tests/night-readability.browser.mjs
cd pizarra-sync
pnpm.cmd exec playwright test e2e/camera-direct.spec.ts e2e/viewport.spec.ts e2e/camera-grid.spec.ts --workers=1
pnpm.cmd exec playwright test e2e/perf.spec.ts --grep "zoom profile" --workers=1
```

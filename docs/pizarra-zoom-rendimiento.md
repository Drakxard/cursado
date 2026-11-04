# Diagnóstico del zoom de la pizarra

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

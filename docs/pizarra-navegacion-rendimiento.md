# Evaluar la respuesta de la pizarra

El workflow **Respuesta de navegacion de la pizarra** mide el bundle de produccion
en Chromium, con un Worker local. No usa cuentas, materiales ni almacenamiento de
produccion. Se ejecuta con push, pull request y manualmente. No reintenta fallos.

## Que se mide

| Escenario | Problema que detecta | Evidencia |
| --- | --- | --- |
| 1.200 notas con enlaces, en claro y oscuro | Consultar geometria de todos los enlaces al mover el puntero | Consultas `getClientRects`, tiempo de 30 sondas |
| Editar una sola nota con las demas visibles | Reconstruir contenido o mover notas ajenas | MutationObserver: identidades cambiadas y nodos movidos |
| Zoom y desplazamiento continuos | Bloquear el hilo principal, perder cuadros o retrasar la camara | Cuadros p50/p95/max, manejador de entrada, entrada hasta callback de camara, tareas largas |
| Fin de gesto | Pausa al recuperar el detalle y reconciliar objetos | Tiempo de reconciliacion mas siguiente cuadro |
| Reapertura | Carga del documento y primera nota visible | Tiempo de reapertura y Navigation Timing |
| Doce paginas escaneadas de 2048 x 3072 | Reemplazar imagenes, descargar o decodificar repetidamente durante el zoom | Identidad de los elementos, solicitudes y cuadros |
| Edicion, enlaces rotados, deshacer y salir del viewport | Optimizar rompiendo el comportamiento | Enlaces correctos, orden DOM, contenido restaurado y remontaje |
| 3.000 objetos, colaboracion y gestos de mouse reales | Regresiones en camara, seleccion o presencia | Suite de camara, perfiles existentes, arrastre y resize entre clientes |
| Pizarra integrada y cambios de pagina | Un motor rapido dentro de una integracion lenta o con sesiones acumuladas | Pruebas de la integracion de Materias/Importantes, enlaces PDF, paginas y modo noche |

Las sondas instrumentadas de rueda son sinteticas para separar el costo de JS.
`inputToCameraCallback` mide hasta el callback de sincronizacion, **no** hasta que
el monitor muestra los pixeles. La suite `camera-direct` usa mouse, rueda y pinch
con el navegador para verificar anclaje, inversion, primer movimiento y parada.
Los tiempos de reapertura corresponden a una recarga con cache; no representan
una primera visita con red lenta.

Los contadores de trabajo son condiciones de regresion deterministas: una edicion
solo puede reconstruir su nota, no debe mover notas ajenas y una sonda sobre un
espacio vacio no debe medir rectangulos de enlaces. Los tiempos se muestran por
separado para no presentar un test aprobado como una garantia de 60 FPS.

## Hallazgos y correcciones

En el render anterior, cada evento de documento ejecutaba `innerHTML` y
`appendChild` en todas las notas visibles. Ademas del costo directo, se recreaban
enlaces y se activaban los observadores de colores y contenido. El render ahora
reutiliza el contenido cuando el objeto materializado de Yjs no cambio. El orden
se reconcilia moviendo solo los nodos fuera de lugar. Una nota modificada sigue
actualizando su contenido; un cambio real de orden sigue reflejandose en el DOM.

El hover de enlaces recorria todos los anchors y media sus rectangulos. Ahora
primero busca el objeto bajo el puntero en coordenadas del tablero, contemplando
rotacion y geometria transitoria, y solo mide los enlaces de ese objeto o del
editor activo.

Primeras mediciones en GitHub Actions, con el mismo escenario de 1.200 notas:

| Medicion | Antes | Despues |
| --- | ---: | ---: |
| Rectangulos medidos en 30 sondas vacias | 36.000 | 0 |
| Notas reconstruidas al editar una | 1.200 | 1 |
| Nodos reordenados al editar una | 1.200 | 0 |
| Edicion + siguiente cuadro, claro | 72,9 ms | 30,3 ms |
| Edicion + siguiente cuadro, oscuro | 108,5 ms | 31,9 ms |

Referencia: baseline `e8f13fe`, candidato `179d773`. Los contadores son comparables;
los tiempos provienen de runners distintos y no son un ensayo controlado del
hardware. La pausa final aun rondaba 49 ms en el candidato y el p95 de cuadros
oscuros fue 44 ms: queda trabajo de composicion y reconciliacion por investigar.
Estas mejoras no demuestran navegacion instantanea para cualquier tablero.

## Reportes

La pagina de cada ejecucion muestra una tabla de resultados. El artefacto
`board-navigation-<commit>` conserva durante 14 dias:

- `navigation-results`: JSON por escenario, perfiles `.cpuprofile` y trazas de fallos.
- `navigation-report`: reporte HTML del bundle de produccion.
- `test-results` y `playwright-report`: pruebas funcionales y perfiles de zoom.

Abrir los perfiles CPU en DevTools / Performance para buscar trabajo que no
aparece en los contadores del motor, como callbacks de observadores. Para evaluar
sensacion visual, repetir en el equipo habitual con sus materiales, usando tanto
vista completa como lectura cercana y verificando la pausa al comenzar, invertir
y terminar el gesto. FPS medio por si solo oculta esas pausas.

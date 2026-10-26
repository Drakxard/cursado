# Imágenes escalables e inicio de Estudio

## Implementación (2026-10-25)

Los archivos originales mantienen sus bytes e identificadores. Las vistas previas
son datos locales descartables, separados de la escena, el historial, los respaldos
y la sincronización. Una base IndexedDB `pizarra-image-previews-v1` conserva niveles
de lado mayor 256, 512, 1024, 2048 y 4096, sin ampliar originales pequeños. Las claves
incluyen el ámbito del recurso; las publicaciones nativas incluyen su revisión.

La caché persistente guarda los blobs separados de sus metadatos. El descarte LRU
recorre únicamente metadatos, elimina el blob y su registro en una transacción y
limita los bytes codificados a 256 MiB. Un contador transaccional evita recorrer
toda la caché por cada inserción; el esquema 2 inicializa ese contador al actualizar
una caché anterior. Denegación de almacenamiento y errores de
cuota permiten seguir dibujando sin persistir las vistas previas.

La cola existente comparte dos puestos entre lectura, generación y preparación
de imágenes. Una misma referencia de recurso no inicia dos cargas simultáneas.
Los niveles pequeños se generan desde una versión mayor disponible antes de
volver al original. PNG conserva transparencia y evita agregar compresión con
pérdidas a capturas de texto. Para obtener dimensiones se leen 32 bytes de PNG o
WebP; JPEG permite hasta 512 KiB de cabeceras y respeta la orientación EXIF. Los
formatos no reconocidos utilizan el lector del navegador.

Los niveles persistidos y los píxeles retenidos tienen resoluciones diferentes:
la imagen dibujable se limita al tamaño de pantalla, redondeado en pasos de 64
píxeles y repartido entre los recursos visibles. Se conserva la proporción del
original. La caché retenida respeta 64 MiB también durante reemplazos; los buffers
transitorios del decodificador y de generación no forman parte de ese límite.
Las superficies de generación se liberan después de codificar; las copias para
pantalla se obtienen de una superficie pequeña independiente.

Durante un gesto se sigue dibujando la vista previa disponible. Los reemplazos
esperan 150 ms sin movimiento de cámara y los niveles tienen umbrales distintos
para subir y bajar. Las referencias nuevas visibles pueden cargar inmediatamente.
Salir de pantalla, borrar y cerrar liberan los píxeles; un resultado tardío no
reincorpora imágenes a una pizarra cerrada. Recorte y exportación siguen leyendo
los originales. La caché derivada se puede eliminar sin perder contenido.

Estudio carga voz, prueba de voces y administración al abrirlos. Las conversiones
de imágenes y texto a PDF se importan al ejecutar la acción. Importantes se monta
en la primera visita y conserva su instancia después, para mantener borradores y
colas de guardado. En modo de sesión remota, la consulta periódica omite pestañas ocultas y reúne
eventos de foco/visibilidad próximos y solicitudes concurrentes. Las tareas de
sincronización de archivos no cambian de frecuencia.

El enfoque toma la resolución por niveles y la actualización diferida de
[tldraw](https://tldraw.dev/sdk-features/performance), y la caché compartida por
identificador de [Excalidraw](https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/image.ts).
No incorpora ninguno de esos motores ni cambia el formato de la pizarra.

## Validación

- Compilación de producción de Next, TypeScript y Vite; empaquetado nativo.
- Caché: presupuesto durante reemplazos, dos puestos, ráfagas de zoom,
  movimiento dentro del mismo nivel, originales pequeños y cargas tardías.
- Persistencia: LRU, reemplazos, límite de bytes y almacenamiento denegado.
- Navegador: original PNG de 4000 píxeles intacto, transparencia, reapertura sin
  conexión, caché bloqueada, eliminación/deshacer y fotografía JPEG con hash
  original y proporción conservados.
- Regresiones: recorte, exportación, tablet y gestos táctiles, colaboración con
  dos personas, lector PDF y cierre de sus workers, y respaldos sin servidor.
- Estudio: entrada, reposo, primera apertura de Importantes y regreso desde su
  pizarra real; borradores, orden de tareas, conversión de imágenes y voz.

Los fixtures de validación también corrigen tres supuestos anteriores: la ruta
del manifiesto incluye `/pizarra/`, un día del calendario puede contener un evento
y los GET de configuración de TTS pasan por el interceptor de servicios.
ESLint no está instalado en este checkout; no se cuenta como verificación exitosa.

## Resultados medidos

Los [datos crudos](mediciones-imagenes-2026-10-25.json) contienen las corridas antes
y después. La pizarra utiliza perfiles persistentes nuevos para cada tamaño de
lote, en ambas versiones; al final se cierra Chrome y se vuelve a abrir el mismo
perfil. Son mediciones exploratorias de una máquina, no un promedio estadístico
ni las imágenes personales del usuario.

En la vista general, los píxeles retenidos disminuyen un 25 %:

| Imágenes | Antes, MiB de bitmaps | Después, MiB de bitmaps |
| --- | ---: | ---: |
| 10 | 0,625 | 0,469 |
| 30 | 1,875 | 1,406 |
| 100 | 6,250 | 4,688 |

La reducción corresponde a las vistas previas, no a toda la RAM. Con 100 imágenes,
el working set agregado de Chrome fue:

| Momento | Antes, MiB | Después, MiB | Decodificaciones de originales, antes → después |
| --- | ---: | ---: | ---: |
| Tras importar | 1040,3 | 836,9 | 120 → 100 |
| Vista general al reabrir | 780,4 | 787,8 | 100 → 0 |
| Tras ráfaga de zoom | 695,3 | 805,5 | 183 → 0 |
| Tras veinte recorridos | 699,7 | 744,2 | 436 → 0 |
| Navegador nuevo, misma copia local | 544,6 | 532,8 | 100 → 0 |

Los contadores se reinician al navegar y son acumulados dentro de cada documento.
El presupuesto nominal de bitmaps retenidos se mantuvo por debajo de 64 MiB;
los picos transitorios se informan aparte. Entre los recorridos diez y veinte,
el heap aumentó 44.376 bytes en la versión nueva, sin crecimiento sostenido de
los píxeles retenidos. El escenario nuevo guardó 33.217.220 bytes derivados,
dentro del límite de 256 MiB.

El working set bajó aproximadamente un 20 % después de importar ese lote, pero
fue mayor después de los recorridos: **no se demostró un ahorro uniforme de RAM
total**. El P95 de fotogramas durante el zoom estuvo alrededor de 17 ms en ambas
versiones; este fixture no demuestra un aumento de FPS. Sí verifica que los
originales dejan de decodificarse al volver a la vista general, hacer zoom y
reabrir la copia local. El tiempo de importación y estabilización de ese lote
fue 32,3 → 29,6 segundos; generar los derivados tiene un costo inicial.

En Estudio, el heap inicial fue 7.240.196 → 6.992.168 bytes (aproximadamente un
3,4 % menos). En reposo fue 7.292.136 → 7.046.312 y después de volver de la
pizarra 7.597.248 → 7.462.644 bytes. El JS registrado para el escenario completo
bajó de 1.383.162 a 1.283.178 bytes. El working set inicial fue 490.442.752 →
495.120.384 bytes: tampoco demuestra una reducción de RAM total del navegador.

## Repetición de mediciones

Se utiliza Chrome de escritorio, viewport 1366 × 900 y DPR 1. Las pruebas de carga
importan archivos mediante el selector real, esperan a que la decodificación se
estabilice y luego distribuyen las imágenes importadas en una vista general. Los
fixtures son PNG de 3200 × 2400 con texto, gradientes detallados y transparencia.
La fotografía JPEG se valida aparte con el archivo de fondo del repositorio.

```powershell
npm.cmd run build
node node_modules/next/dist/bin/next start -p 3007
# En otra terminal:
node scripts/measure-study-startup.mjs .cache/image-performance/study.json

# Para la pizarra, servir el build de Vite en otra terminal:
cd pizarraproyecto-main
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4175
# Desde la raíz:
$env:BOARD_TEST_URL = 'http://127.0.0.1:4175'
$env:MEASURE_FRESH_BROWSER = '1'
node scripts/measure-board-images.mjs .cache/image-performance/images.json

# Opcional: cerrar Chrome y reabrir la misma copia local en un proceso nuevo.
$env:IMAGE_COUNTS = '100'
$env:MEASURE_FRESH_BROWSER = '1'
node scripts/measure-board-images.mjs .cache/image-performance/warm-browser.json
```

Para comparar versiones hay que compilar y servir cada una por separado. Los
scripts usan carpetas y perfiles de prueba propios, sin abrir pizarras personales.
Registran working set de los procesos de esa instancia de Chrome en Windows,
heap tras GC, píxeles de bitmaps, decodificaciones, tareas largas, fotogramas,
DOM, listeners, canvas, iframes y workers. En otros sistemas el working set queda
en `null`. El contador de originales reconoce los blobs por el tamaño de los
fixtures conocidos; no es un identificador general del contenido.

El working set incluye navegador y GPU y depende de las reservas del asignador;
no equivale a la memoria de una pestaña ni al presupuesto de la caché. Los picos
de bitmaps incluyen generación transitoria, pero no todos los buffers internos
del navegador. Los canvas contados en el DOM son los del documento, no todas las
superficies transitorias desacopladas.

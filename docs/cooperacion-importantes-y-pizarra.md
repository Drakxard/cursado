# Importantes compartidos y edición de pizarra

## Comportamiento

- Cooperativo → **Compartir mis importantes** → grupo aceptado → filas marcadas.
  Cada envío agrega una fila independiente en las listas de los destinatarios,
  aunque ya exista otra con el mismo nombre. El remitente conserva su fila.
- Los botones nuevos de una fila compartida se propagan desde cualquier
  participante. Quitar un botón o una fila es local: se conservan los IDs vistos
  y los envíos recibidos fuera de la lista para no reinsertarlos automáticamente.
  Un nuevo envío explícito tiene otro ID y vuelve a insertar la fila.
- Las pizarras de esos botones comparten su contenido y sus imágenes originales.
  El contenido usa la combinación cooperativa existente; sus borrados sí forman
  parte de la edición conjunta. La cámara permanece personal.
- La presencia descarta conexiones anteriores al recargar y muestra un solo
  cursor por persona. Los cursores sin actividad caducan si se pierde el aviso
  de desconexión. Las sincronizaciones sin cambios en la escena conservan la
  selección y el historial; las lecturas cooperativas se ejecutan en serie.
- Un acceso arrastrado apunta al ID local de la pizarra. También se reconocen
  los accesos históricos `study-*`, incluidos los de teoría y práctica que no
  aparecen en Importantes. Los nuevos arrastres conservan materia, semana y PDFs
  para abrir también pizarras sin respaldo previo. Si falta el respaldo se usa
  la copia existente del dispositivo. Los accesos a compartidas del servidor
  recuperan la sesión autenticada desde el editor incrustado.
- Inicio aparece únicamente cuando contiene materias. Eliminar una pestaña
  conserva sus materias y archivos: sus materias propias pasan a una pestaña
  normal llamada Mis materias. No se vuelve a generar Inicio. Las referencias
  en otras pestañas permanecen. Al quitar la última pestaña vacía quedan
  Cooperativo y el botón para agregar otra.

## Transferencias y permisos

Las publicaciones de Importantes reutilizan la autorización, los archivos
verificados, las operaciones idempotentes y los canales en vivo de Cooperativo.
El directorio agrega una columna `kind` con valor histórico `subject`; las nuevas
publicaciones `important` se listan separadas de las esferas. Esta parte requiere
desplegar también el worker de Cloudflare junto con la web.

El estado local vive en `.cooperation/<usuario>/important.json`: baselines,
entregas, vinculaciones, botones vistos y operación pendiente. Los documentos
grandes se suben mediante referencias verificadas; las imágenes tienen recursos
binarios propios y hash. No se envían como base64 en las operaciones. Al instalar
una pizarra local se reconstruye su respaldo compatible con el formato actual.
Las escrituras de Importantes combinan la base del editor con los cambios en disco
para conservar filas recibidas durante una edición.

## Figma y FigJam

El texto pegado queda editable. PNG y otros archivos del portapapeles se importan
como imágenes. SVG con rectángulos, elipses y texto sencillos puede conservar esos
objetos editables; SVG con trazados, transformaciones o efectos se importa como
imagen para conservar su apariencia. El formato privado de una selección de Figma
no se interpreta: si no trae una alternativa utilizable se indica copiar como
SVG o PNG. No se promete convertir cualquier diseño en objetos nativos editables.

Referencias oficiales: [copiar entre herramientas](https://help.figma.com/hc/en-us/articles/360040030374-Copy-assets-between-design-tools)
y [copiar y pegar objetos](https://help.figma.com/hc/en-us/articles/4409078832791-Copy-and-paste-objects).

## Barra contextual

Las figuras comunes admiten tipo, relleno, transparencia, ausencia de relleno,
borde continuo/discontinuo/punteado y texto interior por doble clic. Cuando tienen
texto aparecen fuente, tamaño, color, negrita, cursiva, tachado, lista, alineación
y enlace HTTP/HTTPS. Los cambios conservan deshacer, guardado y colaboración.
Texto independiente e imágenes muestran acciones adaptadas a su selección.
La barra sigue el zoom y el desplazamiento sin un bucle de renderizado permanente;
las ventanas emergentes se ajustan al espacio disponible.

## Validación

- `tests/important-sharing.test.mts`: salas reales con dos participantes y un
  tercero ajeno; envíos repetidos, adiciones bidireccionales, borrados locales,
  imágenes verificadas, edición de pizarra desde el destinatario y guardado
  concurrente de Importantes.
- `tests/study-workspace-tabs.test.mts`: Inicio vacío/poblado y eliminación de
  pestañas sin perder materias ni referencias.
- `tests/board-context-tools.browser.mjs`: Chrome con la pizarra de producción;
  acceso histórico de teoría, arrastre real de una pizarra sin abrir, recuperación
  de una copia del dispositivo, acceso autenticado a compartidas desde el editor
  incrustado, texto interior, relleno, negrita, portapapeles externo
  después de copiar un objeto propio, SVG editable, regreso y cierre con guardado.
- Pruebas existentes de Importantes, panel cooperativo, permisos y guardado local.

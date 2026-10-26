# Desplegar un acceso a PDF

Una pulsación de 600 ms sobre un acceso PDF del lienzo lo reemplaza por todas sus
páginas, en columna y agrupadas. Se conservan la posición y rotación del acceso,
las proporciones de las páginas y la separación de 30 unidades que ya utiliza la
importación. Si el acceso pertenecía a un grupo, las páginas conservan ese grupo.
Mouse, dedo y lápiz comparten el gesto; moverse más de 5 píxeles, apoyar otro dedo,
cambiar la cámara, perder el foco o cancelar el puntero anula la pulsación.
Un toque sigue abriendo el lector. La pulsación del icono lateral mantiene su
función de centrar el acceso y no convierte el documento.

La preparación obtiene el original desde la carpeta de Estudio, la referencia
compartida autorizada o el servicio de materiales. PDF.js consulta los tamaños de
las páginas sin rasterizarlas. El acceso permanece hasta tener los metadatos y
una copia del original en el almacenamiento de recursos. Recién entonces se
registra un único cambio de historial y se reemplaza la escena. El lector del
acceso, incluida su instancia retenida, se libera al completar la conversión.
Cancelar desde el indicador o con Escape conserva el acceso; los PDF inválidos,
protegidos por contraseña o inaccesibles muestran un error. No hay reconversión a
acceso; sí funcionan deshacer y rehacer normales.

## Datos y renderizado

Las nuevas páginas son `MediaItem` de tipo `pdf-page` con `pdfSource: true`.
Todas usan el mismo `assetId`, cuyos bytes son el PDF original; `pageNumber`
identifica cada página. Las páginas antiguas sin ese discriminador siguen
tratándose como imágenes. No se migra ni reinterpreta su contenido.

El módulo `canvas/pdfPages.ts` carga PDF.js y sus workers bajo demanda. Su pool
conserva como máximo dos originales y los libera después de 30 segundos sin
trabajo. Cancelar un render de pantalla conserva un original ya abierto; cancelar
una carga incompleta o cerrar la pizarra destruye los trabajos correspondientes.
Las tareas tardías no pueden crear workers ni reincorporar píxeles al cerrar.

Solo se solicitan páginas que intersectan la vista. Hasta 2048 píxeles de lado
proyectado se prepara una vista completa adaptada al tamaño de pantalla. Por
encima se conserva una vista general de 512 píxeles y se solicitan mosaicos de
hasta 1024 × 1024 para la región visible, con un margen de 128 píxeles. Las
coordenadas se calculan en el espacio de la página, también al rotarla.
Las nuevas resoluciones y mosaicos esperan 150 ms de cámara estable; los píxeles
disponibles siguen dibujándose durante el gesto.

Imágenes y PDF comparten dos puestos de trabajo y 64 MiB de píxeles retenidos.
La caché persistente de derivados sigue limitada a 256 MiB; sus claves incluyen
ámbito del original, página, región y resolución. Los originales, la memoria
interna de PDF.js y las superficies transitorias de captura no forman parte del
presupuesto de píxeles retenidos. El diseño sigue el criterio del
[visor de PDF.js](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#i-want-to-render-all-100-pages-in-a-document-at-a-high-resolution)
de no mantener canvases de todas las páginas.

## Persistencia y operaciones

El PDF original se conserva aunque se mueva o elimine el material de origen.
Guardado en carpeta, pizarras de temas, respaldos y enlaces compartidos deduplican
los recursos por `assetId`: no codifican ni suben el original por cada página.
El backend local admite `application/pdf` dentro de los límites de recursos ya
existentes. El lector nativo utiliza el mismo discriminador al dibujar el lienzo;
su modo de consulta no permite iniciar conversiones.

Recorte, impresión y capturas solicitan una imagen de la página elegida al motor.
Un recorte crea un recurso PNG para esa página y elimina su discriminador
`pdfSource`, conservando el original de las demás páginas. Los respaldos mantienen
el formato v1 con el campo opcional nuevo y aceptan PDF originales; al importar se
reasigna un único identificador por recurso y se conserva la asociación de todas
sus páginas.

## Validación

- PDF determinista de 40 páginas, con colores y tamaños diferentes: conversión
  agrupada, posición, lectores fijados, mouse/dedo/lápiz y cancelación por dos dedos.
- Comprobación de que solo las primeras páginas visibles generan derivados,
  mosaicos al ampliar y límites de caché compartida.
- Deshacer/rehacer, recorte de una página y recuperación desde la carpeta después
  de eliminar el original y vaciar las copias de escenas y recursos del navegador.
- Cancelación durante la descarga, permisos denegados y PDF corrupto sin reemplazar
  el acceso; originales tardíos sin creación de workers.
- Pool de dos documentos, descarte por inactividad, reutilización tras cancelar
  un mosaico, respaldos con un solo original y permisos de recursos compartidos.

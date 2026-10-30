# Pizarra Sync en Estudio

Estudio usa la copia de Pizarra Sync incluida en el repositorio, mediante
`TopicBoardOverlay`. Los contenedores, las filas de Importantes y los accesos
arrastrados conservan sus identificadores. `/pizarra` sigue usando su motor y
sus archivos anteriores. No hay conversión inversa entre los motores.

El cliente se compila con `npm run build:study-board`, incluido en `predev` y
`prebuild`. El script instala el workspace pnpm con su lockfile si hace falta y
publica los recursos generados en `public/study-board`. No necesita la carpeta
hermana original. `STUDY_BOARD_WORKER_HOST` permite cambiar el hostname del Worker.

## Guardado y migración

Los documentos se sincronizan mediante las salas Yjs del Worker existente y las
imágenes mediante su R2. En la carpeta conectada,
`progreso/pizarra-sync/<boardId>.json` conserva la asociación a una sala, el estado
de revisión y un checkpoint Yjs para recuperar el borrador. Los archivos originales
en `progreso/pizarras` no se sobrescriben. La fuente de cada migración se conserva
además como `<boardId>.original.json` en la carpeta nueva, incluyendo los originales
que existan solamente en el navegador. Así dos ventanas convierten exactamente la
misma fuente. Las reaperturas posteriores no vuelven a cargar sus imágenes originales.

La conversión prepara objetos con identificadores estables y actualizaciones Yjs
deterministas, divididas según el límite del Worker. Reabrir o migrar desde dos
ventanas no duplica los objetos ni el orden. Los accesos de los contenedores se
agregan por referencia sin cargar sus PDF.

La pregunta de migración aparece en la esquina inferior izquierda y permite
seguir usando la pizarra. Aceptar valida los tipos convertidos completamente para
la versión actual del conversor, registrados en `migration-approvals.json`.
Una pizarra posterior solo pregunta por tipos nuevos o conversiones parciales.
Cancelar vuelve a Estudio y conserva el borrador sin validar tipos nuevos.
Los errores impiden aceptar y mantienen el original intacto.

El conversor v2 conserva los marcadores de repaso como círculos interactivos y
su vista guardada. Al reabrir, también repara las tarjetas `shapes:review-marker`
de conversiones anteriores usando el original guardado en cada objeto, sin
reimportar la pizarra ni perder posiciones editadas. Clic recupera la vista;
Mayús + clic la actualiza. Los marcadores y contadores mantienen su geometría y
acompañan el zoom como el resto del contenido, incluidos bordes y controles.

Las migraciones reutilizan imágenes ya presentes en R2 por su hash, incluso al
reabrir después de un fallo. Las subidas se encolan respetando el límite existente
de 30 por minuto del Worker, con margen para otras ventanas. Un HTTP 429 respeta
`Retry-After`; los errores transitorios tienen reintentos acotados. La pausa se
indica en un aviso compacto. Si no se puede continuar, un único aviso agrupa los
errores repetidos y permite reintentar sin volver a subir los archivos exitosos.

Trazos, textos, imágenes, figuras compatibles, accesos, tablas y videos tienen
equivalentes editables. Los tipos sin equivalente conservan una tarjeta con su
información original consultable y se identifican como conversión parcial;
también se señalan propiedades que no se pueden reproducir exactamente.

El PDF fijado retiene un único visor durante la sesión. `<` alterna su visibilidad
y `Esc` sale del lector. Desfijarlo oculto, reemplazarlo o salir de la pizarra libera
el visor. El lector y sus anotaciones usan los componentes existentes de Estudio.
La chincheta de la barra lateral abre el PDF con un clic; mantenerla presionada
lleva a su acceso en la pizarra. El acceso permite desfijarlo y fijar otro lo reemplaza.
Los accesos mantienen sus proporciones al hacer zoom. El lector reutiliza una única
consulta a los metadatos de la materia y abre PDF.js con la ruta local conocida,
sin pantallas intermedias de búsqueda.
La biblioteca comparte el mismo `SubjectWheelLoader` del inicio de Estudio y abre
la mitad de la pantalla. Los contadores consultan las tareas originales al abrir,
recuperar el foco y cada cinco segundos.

## Publicación y verificación

Antes de usar la integración publicada, desplegar el Worker de
`pizarra-sync/packages/worker`: su lista de orígenes ahora incluye
`https://cursado.vercel.app` y el desarrollo local en el puerto 3000. Conservar los
nombres de los Durable Objects y el bucket R2. Publicar Cursado después.
Los enlaces de salas siguen siendo el mecanismo de acceso de Pizarra Sync;
Los accesos PDF publicados incluyen una referencia al archivo en R2 para quienes
tienen el enlace de esa sala. Se reutilizan los objetos de esferas cooperativas
tras validar la sesión y pertenencia del publicador, sin copiar sus bytes. Otros
PDF se publican por hash en el bucket existente del Worker, con un límite de 100 MB
y verificación completa de integridad antes de habilitar la descarga.

El enlace compartido abre `/estudio/pizarra` con la misma sala Yjs y la carpeta que
autorizó la persona. Los PDF se descargan solamente al abrirlos, con progreso de
0 a 100, y quedan en `pizarrasCompartidas/<hash>.pdf`. Un marcador escrito al terminar
permite reabrir sin descarga y conservar anotaciones locales. Las descargas incompletas
no se dan por válidas; dos aperturas coordinan el guardado. Si una esfera cooperativa
ya contiene el archivo local correcto, el lector lo reutiliza directamente.
Las tareas continúan siendo referencias a la carpeta original.

`npm run test:study-board` ejecuta las pruebas de migración y levanta los servicios
locales para la prueba de navegador si no están abiertos. Solo detiene los procesos
que inició. La prueba usa dos sesiones y servicios simulados para el visor PDF,
el importador Excel y la API de YouTube; PDF.js, SVG, CSV, Yjs y R2 local se ejercitan
realmente. El visor PDF original conserva sus pruebas específicas existentes.

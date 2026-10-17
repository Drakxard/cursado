# Biblioteca personal en InScreen

Desde el inicio de Cursado desplegado por HTTPS, el botón superior derecho abre
**Sincronizá tus dispositivos**. Elegí la carpeta habitual, conectá R2 si todavía
no está configurado y pulsá **Comenzar a subir**. Las credenciales existentes se
conservan cifradas en `User.Services`. Esta función solo necesita R2: Groq y Marker
siguen siendo independientes.

El panel reutiliza R2 de `User.Services` (también recupera su respaldo y el
formato anterior `User.InScreen`) o la configuración del despliegue. Muestra
**R2 conectado**, sin pedir las claves de nuevo. **Cambiar configuración** abre
los campos; dejar uno vacío conserva su valor. Si un archivo no puede abrirse,
se informa el problema para recuperar la configuración.

El botón **❔** abre cuatro pasos ilustrados para elegir el bucket, crear las
claves, identificar el endpoint S3 y configurar CORS. Incluye enlaces oficiales
de Cloudflare y permite copiar el JSON CORS con el origen de la web actual.

El panel separa configuración, sincronización y dispositivos en pantallas.
Mientras recupera, sube o verifica archivos, oculta los dispositivos y el QR,
incluso si hay una publicación anterior. Informa porcentaje, MB procesados,
MB pendientes y archivos restantes; las subidas muestran avance dentro de cada
archivo. El 100 % y la pantalla de QR aparecen después de verificar y activar
la publicación, incluyendo cambios pendientes. Al reabrir el panel se comprueba
la carpeta antes de habilitar el QR.

Si una subida queda bloqueada por CORS, **Revisar permisos CORS** abre directamente
ese paso. Una clave con permisos de objetos puede publicar, pero puede requerir
agregar la regla desde el panel de Cloudflare. No hace falta cambiar las claves.

La primera publicación con esta versión busca los manifiestos anteriores del
bucket y los PDF de `r2/materia/semana/día/`. Recupera los archivos faltantes en
la carpeta local, conserva las versiones locales y mantiene materia, semana,
día, orden y marcas de importante. Los PDF antiguos sin manifiesto se reconocen
por sus metadatos o por esa estructura de carpetas. No modifica ni elimina los
objetos originales. Las descargas interrumpidas se retoman al reintentar; la
recuperación se marca terminada para no resucitar después archivos eliminados.

Al publicar un archivo recuperado, el servidor verifica su SHA-256 y reutiliza
los bytes dentro de R2 mediante una copia a la revisión de lectura, sin volver
a subirlos desde la PC. Los inventarios versionados conservan sus propias
copias para que editar o eliminar un original no rompa una revisión anterior.
Las URLs de subida no incluyen el CRC32 de un cuerpo vacío y firman los
encabezados de metadatos que envía el navegador. Ante un fallo de transferencia,
una prueba temporal diferencia CORS de un rechazo de firma o permisos, sin
mostrar credenciales ni URLs firmadas.

La primera publicación habilita el QR, válido cinco minutos. En la primera pestaña
de InScreen, **Vincular con nuevo dispositivo** abre el escáner. Se admiten varios
celulares por espacio y una biblioteca activa por celular. Reemplazarla requiere
confirmación y validar primero el vínculo nuevo. La pila, módulos, widgets y
conexión de micrófono no se reemplazan.

La computadora publica cambios guardados tras dos segundos de pausa, revisa
pendientes cada 45 segundos y reintenta al recuperar conexión. Debe permanecer
abierta para publicar nuevos cambios; el celular puede leer lo ya publicado con
la computadora apagada. Los inventarios se activan después de verificar sus
archivos. Una interrupción conserva la publicación anterior.

InScreen actualiza el catálogo al abrir, manualmente y mediante WorkManager
(intervalo mínimo de 15 minutos; Android puede diferirlo). Descarga toda la
biblioteca por Wi-Fi; con datos móviles descarga únicamente lo que abrís. La app
indica cuántos archivos están guardados y verifica tamaño y SHA-256 antes de
conservarlos. Se mantiene la revisión completa anterior hasta terminar la nueva.
La falta de conexión o espacio deja disponibles los archivos ya descargados.

En Estudio, deslizar hacia la izquierda abre **Importantes**; deslizar hacia la
derecha desde la rueda muestra las pestañas, y desde Importantes vuelve a la
rueda. Se publica `progreso/importantes.json`, junto con las pizarras de sus
temas. Los cambios guardados avisan al sincronizador de la web. Si una publicación
anterior no incluye ese archivo, InScreen indica que hay que sincronizar desde
la web y luego actualizar los archivos del celular. Una lista publicada vacía
se distingue de un archivo ausente.

Desde Inicio (los dos accesos de Cursado), deslizar a la derecha vuelve a la pila
de InScreen. Al instalar un APK con una interfaz inicial nueva, se verifica y
activa esa interfaz aunque hubiera una copia antigua guardada. Las posteriores
actualizaciones web siguen conservándose al reiniciar la app.

**Desvincular** desde la PC bloquea nuevas solicitudes. Las URLs de descarga ya
emitidas vencen en dos minutos y las copias locales pueden seguir leyéndose.
**Quitar biblioteca** desde el celular elimina su descarga local.

## Cursado original dentro de Android

La primera pestaña ejecuta la entrada sin conexión de Cursado, con los componentes
originales de Inicio, Estudio, Síntesis y Pizarra. El lector separado anterior se
retiró. La entrada usa el adaptador de navegación de `native-web` en lugar del
servidor de Next.js, conserva los estilos originales y usa el mismo PDF.js.

`CursadoNative` versión 1 entrega el inventario y las acciones de vinculación y
descarga. `lib/native-workspace.ts` presenta una carpeta virtual de solo lectura:
enumera las rutas publicadas y lee `/files/<revision>/<id>`. Android resuelve cada
identificador contra los blobs verificados de esa revisión; no entrega rutas del
sistema ni credenciales. No se solicitan carpeta o `User.Services`, no se ejecutan
migraciones ni se publican cambios desde el celular. Las operaciones de escritura
fallan aunque se intenten fuera de los controles ocultos de la interfaz.

Pizarra usa su biblioteca y lienzo originales con un proveedor de documentos
sincronizados. `boards/library.json` conserva nombres y carpetas; los documentos
referencian sus imágenes por rutas publicadas. Los inventarios anteriores siguen
siendo legibles; una nueva publicación desde la PC incorpora la estructura de
carpetas. Las preferencias de navegación y apariencia permanecen en el celular.

Los PDF usan `libraryReadOnly=1`, que desactiva edición y scripting. Los documentos
HTML guardados se abren en otra WebView sin puente nativo ni acceso a la red.

Cada compilación web genera `public/native-web/current.json` y los recursos de su
revisión en `public/native-web/releases/<revision>/`. El manifiesto público incluye
la versión del puente y tamaño/SHA-256 de cada archivo, sin documentos personales.
Android obtiene los paquetes únicamente del origen HTTPS de la biblioteca,
rechaza rutas inseguras, redirecciones, versiones incompatibles y tamaños excesivos,
y activa la interfaz solo después de verificar todos sus recursos. Una descarga
fallida conserva la interfaz anterior. Al volver a abrir la app se usa la nueva
versión; las actualizaciones de archivos y de interfaz son independientes.

## Configuración y publicación del APK

El despliegue conserva las semillas existentes `INSCREEN_CONFIG_SEED` e
`INSCREEN_PROVIDER_CAPSULE_SECRET`, de al menos 32 caracteres. No rotarlas al
actualizar: protegen los servicios y vínculos existentes. El bucket permanece
privado. La app intenta agregar una regla CORS para el origen actual sin borrar
las demás; si la clave solo permite operaciones de objetos, configurar en el
panel de R2 una regla con ese origen, métodos GET/HEAD/PUT, encabezados
`content-type` y `x-amz-*`, y `ETag` expuesto.

`manifests/workspace-library-sync.json` conserva la identidad y cola local de
publicación; no se publica. R2 usa un prefijo por espacio bajo
`manifests/workspace-library/`, con blobs por hash, revisiones, dispositivos y
canjes de QR. No se publican credenciales, sesiones, respaldos históricos ni
pizarras compartidas del servidor. Las eliminaciones desaparecen del catálogo;
las revisiones anteriores se retienen para finalizar descargas en curso.

InScreen fija el commit de este repositorio en `.github/cursado-reader-ref`.
GitHub Actions prepara una interfaz inicial sin conexión, prueba los componentes en Chrome
móvil, ejecuta pruebas/lint de Android y compila el APK. La etiqueta `vX.Y.Z` debe
coincidir con `versionName`; el workflow existente conserva la firma y publica
`InScreenMic.apk` en GitHub Releases. No hace falta compilar Android en la PC.

Validación local de la interfaz, sin compilar Android:

```powershell
node scripts/build-native-web.mjs
node --test tests/native-web.browser.mjs
npm.cmd run typecheck
npm.cmd test
```

Los contratos prueban cifrado, vencimiento, canjes simultáneos, revocación,
inventarios incompletos, actualizaciones, reintentos y eliminaciones. El lector
se comprueba con red desactivada. La cámara real, restricciones del fabricante y
modo avión completo del APK deben verificarse adicionalmente en un dispositivo.

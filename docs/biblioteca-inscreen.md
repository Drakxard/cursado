# Biblioteca personal en InScreen

Desde el inicio de Cursado desplegado por HTTPS, el botón superior derecho abre
**Sincronizá tus dispositivos**. Elegí la carpeta habitual, conectá R2 si todavía
no está configurado y pulsá **Comenzar a subir**. Las credenciales existentes se
conservan cifradas en `User.Services`. Esta función solo necesita R2: Groq y Marker
siguen siendo independientes.

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

**Desvincular** desde la PC bloquea nuevas solicitudes. Las URLs de descarga ya
emitidas vencen en dos minutos y las copias locales pueden seguir leyéndose.
**Quitar biblioteca** desde el celular elimina su descarga local.

## Recursos compartidos de interfaz

`public/library` contiene el HTML, CSS y navegación de lectura empaquetados en el
APK. La preparación extrae las mismas variables de temas de `app/globals.css`,
los íconos del inicio y el componente circular de materias que usa Estudio.
Pizarra reutiliza las formas, tablas y gráficos del editor, con cámara y zoom de
lectura. Los PDF usan el mismo `public/pdfjs/web/viewer.html` de Cursado, con su
barra, búsqueda, selección, miniaturas y zoom; el modo `libraryReadOnly=1`
desactiva edición y scripting de PDF. Verlo se abre en otra WebView sin puente
nativo ni acceso a la red. No se requiere regenerar contenido con IA.

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
GitHub Actions prepara los recursos compartidos, prueba el lector en Chrome
móvil, ejecuta pruebas/lint de Android y compila el APK. La etiqueta `vX.Y.Z` debe
coincidir con `versionName`; el workflow existente conserva la firma y publica
`InScreenMic.apk` en GitHub Releases. No hace falta compilar Android en la PC.

Validación local de la interfaz, sin compilar Android:

```powershell
node scripts/prepare-workspace-library.mjs ../InScreen/modules/library
node --test tests/workspace-library.browser.mjs
npm.cmd run typecheck
npm.cmd test
```

Los contratos prueban cifrado, vencimiento, canjes simultáneos, revocación,
inventarios incompletos, actualizaciones, reintentos y eliminaciones. El lector
se comprueba con red desactivada. La cámara real, restricciones del fabricante y
modo avión completo del APK deben verificarse adicionalmente en un dispositivo.

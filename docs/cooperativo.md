# Estudio cooperativo

Inicio → Compartir ofrece Estudio cooperativo y Sincronizar dispositivos. La
sincronización existente por R2/QR mantiene su configuración. Cooperativo usa
las cuentas de Pizarra; el campo admite `PersonaA, PersonaB` o
`[PersonaA, PersonaB]`. La misma lista de participantes reutiliza el grupo.

En Estudio, Cooperativo muestra los grupos. Mantener pulsada una esfera permite
copiarla o moverla al grupo. Copiar agrega un acceso al mismo material; mover
retira el acceso anterior. Una esfera puede pertenecer a varios grupos. Todos acceden a la misma sala, archivos R2 y réplica local; compartirla con otro grupo no crea una copia ni reinicia la transferencia. Los participantes de esos grupos colaboran sobre el mismo contenido.

La primera descarga requiere Confirmar y muestra el tamaño en MB. Cancelar
deja la esfera gris. Aceptar una esfera también acepta participar en su grupo.
La esfera aparece como «Preparando publicación» apenas se comparte. El aviso
llega cuando se publica su descripción, sin esperar a los PDF. Tras confirmar,
los metadatos se instalan primero y permiten abrir la materia; PDF, imágenes y
pizarras continúan en segundo plano con progreso y reintento visible. Una
transferencia larga no bloquea el descubrimiento de nuevas invitaciones.
Después, los agregados y cambios se guardan localmente y se sincronizan sin
preguntar. Se comparten PDF, explicaciones, síntesis e imágenes, contenedores,
conjuntos del micrófono, apuntes y pizarras asociadas. No hay llamada de voz.

Una eliminación completa remota conserva el elemento local hasta que se elija
Confirmar/Eliminar o Guardar. Esperar permite revisarlo más tarde; Guardar lo
conserva como personal y evita que vuelva a publicarse. Las decisiones quedan
en la carpeta local. Editar contenido o borrar trazos no pide confirmación.
Los conflictos conservan versiones recuperables; Cooperativo permite
descargarlas. Los cambios independientes se combinan por elemento o sección.

## Almacenamiento y API

- La cookie HttpOnly de Pizarra conserva su alcance `/pizarra/`.
- La API del navegador vive bajo `/pizarra/api/cooperation/`. El proxy existente
  la dirige al Worker configurado con `PIZARRA_BACKEND_URL`.
- `GET/POST groups` lista o crea grupos. `POST spheres` crea una esfera;
  `spheres/:id/accept`, `snapshot`, `operations`, `files/:hash` y `ticket`
  gestionan aceptación, réplicas, cambios y archivos.
- Un ticket de un solo uso, válido por 60 segundos, abre un WebSocket directo
  al Worker. Se valida el origen y la pertenencia antes de emitirlo.
- `IdentityDirectory` conserva grupos y participantes. `SharedContentRoom`
  guarda el estado confirmado en SQLite y transmite presencia, versiones,
  cursores y trazos. Los archivos verificados se guardan en R2 bajo
  `cursado/shared/<sphereId>/`, hasta 100 MiB por archivo. Los clientes actuales
  suben directamente a R2; los anteriores conservan el endpoint multipart.
- Los documentos JSON grandes se transfieren como archivos verificados para
  no superar el límite de las operaciones. SQLite divide el estado en filas
  pequeñas. Las imágenes de las pizarras se transfieren fuera del JSON.
- `.cooperation/<userId>/state.json` guarda asociaciones, decisiones y la
  operación pendiente. Las carpetas `uploads`, `downloads` y `recovery` permiten
  reintentos y recuperación. El bloqueo del navegador coordina varias pestañas.
- Las materias recibidas tienen carpetas e identificadores propios. El catálogo
  registra `cooperationId` para que la reconciliación y los cambios de nombre
  no las mezclen con materias personales. No se comparten credenciales.

Las tablas nuevas se crean de forma compatible dentro de las clases existentes.
No se necesita otro namespace ni cambiar `AUTH_PEPPER`, el bucket o las cuentas.
Para publicar hay que desplegar el Worker y la aplicación; el `dry-run` no
modifica producción. Las API antiguas de bibliotecas de pizarras compartidas
permanecen separadas de la colaboración por esferas.

## Verificación

La sincronización ocurre al abrir o recuperar conexión, guardar cambios locales
o recibir avisos por WebSocket. Un canal privado por usuario avisa de grupos,
invitaciones y materias nuevas; las salas existentes avisan de nuevas versiones.
No se consulta la API cada cuatro segundos. Si se corta un canal o falla una
transferencia pendiente, se reintenta con espera creciente hasta 30 segundos.
Los avisos que llegan durante una transferencia se procesan al terminarla.
Una versión sin cambios no recarga la pantalla; los cambios remotos de la
materia abierta se incorporan en segundo plano.

### Subida directa a R2

El cliente solicita una URL firmada en `POST /pizarra/upload-session`; esa ruta
conserva el alcance de la cookie de Pizarra. El Worker comprueba la sesión y la
pertenencia aceptada al grupo antes de devolver la clave autorizada. Vercel
firma la subida durante 15 minutos y el navegador envía los bytes directamente
al endpoint S3 de R2, incluyendo los documentos JSON grandes. La firma vincula
el tamaño (hasta 100 MiB), el tipo y el checksum SHA-256. Las operaciones se
publican después de que R2 confirme la subida.

La aplicación usa la configuración R2 sellada de `User.Services`, igual que
la publicación de biblioteca existente. También admite `R2_ENDPOINT`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` y `R2_BUCKET_NAME=estudiodiario` del
servidor. Requiere `PIZARRA_BACKEND_URL` y el bucket debe coincidir con el del
Worker. La configuración personal se envía solamente a la ruta de Vercel;
no se reenvía a Cloudflare ni se comparte con los otros participantes.

La configuración personal es opcional para Cooperativo. Un participante sin
claves R2 recibe una URL del Worker con un permiso de subida de un solo uso,
válido por cinco minutos y vinculado al hash, tamaño y tipo del archivo. El
navegador envía los bytes directamente al Worker, que los verifica y guarda
en el bucket compartido; el cuerpo del archivo no atraviesa Vercel. La sesión
y la pertenencia aceptada al grupo se comprueban antes de emitir el permiso.
Si una subida S3 personal falla, el cliente puede usar este mismo camino.

Antes de firmar, el Worker comprueba si el archivo ya existe en la esfera
con el mismo hash y tamaño. Si falta allí, se busca en la biblioteca R2 del
dispositivo (`manifests/workspace-library/<workspaceId>/blobs/<hash>`). Se
verifican los bytes con SHA-256 y se hace una copia interna condicionada al
ETag de origen. Esto evita volver a subir el contenido desde el navegador y
mantiene independiente la copia cooperativa del respaldo personal. Si no hay
una copia exacta, se emite la URL para la subida directa.

El bucket debe permitir `PUT` desde `https://cursado.vercel.app` con los headers
`Content-Type` y `x-amz-checksum-sha256`. `cloudflare/cooperation-cors.json`
contiene la regla en formato Wrangler. Al aplicarla, conservar también las
reglas CORS existentes que usen otras funciones. Desplegar el Worker y la
aplicación juntos; la ruta de subida completa anterior permanece compatible
con los clientes antiguos.

No se ha validado una transferencia real al bucket con las pruebas locales;
éstas verifican autorización, firma y flujo del cliente con servicios simulados.

`npm run typecheck`, `npm test`, `npm run build` y `npm run cloudflare:check`.
La prueba de interfaz del selector es
`node --test --experimental-strip-types tests/workspace-library-panel.browser.mts`.

Para probar WebSockets, RPC y multipart con el runtime real, iniciar Wrangler
localmente en el puerto 8794 y ejecutar en PowerShell:

```powershell
$env:COOP_LOCAL_URL='http://127.0.0.1:8794'
node --test tests/cooperation-worker.integration.mjs
```

Los tests de réplicas simulan cuatro usuarios y carpetas independientes, incluyen
copias locales de PDF, pizarras con imágenes, conjuntos y síntesis, y verifican
que Guardar no resucite una eliminación en los demás participantes.

## Selección de semanas

La invitación ofrece «Sincronizar todo» y «Elegir». Elegir instala solamente
una vista previa de los listados y abre la esfera. El botón «Sincronizar» cambia
entre gris y verde para la semana completa; `<`, `>` y las flechas recorren las
semanas. Los campos editables conservan sus teclas. «Terminar» guarda la selección,
retira los listados excluidos y comienza las descargas en segundo plano.

Se guardan las semanas excluidas: las elegidas y las semanas creadas después se
sincronizan automáticamente. Los archivos compartidos por varias semanas se
incluyen si alguna está seleccionada. PDF, imágenes, síntesis y pizarras siguen
las referencias de sus semanas. Las pizarras nuevas guardan su semana explícita;
para las anteriores se utilizan sus referencias PDF o su identificador de Estudio.
Los archivos sin asociación verificable a una semana no se descargan en este modo.
La selección y su vista previa se recuperan después de recargar. Las exclusiones
son locales y nunca se publican como eliminaciones para los compañeros.

Pruebas específicas:
`node --test --experimental-strip-types tests/cooperation-selection.test.mts tests/cooperation-mirror.test.mts tests/cooperation-panel.browser.mts`.
Con la aplicación iniciada, `node --test tests/cooperation-weeks.browser.mjs`
comprueba el recorrido en la esfera real, incluidos los listados previos a la descarga.

La aceptación recupera la carpeta existente si el catálogo ya identifica esa esfera. Para materias locales anteriores sin asociación, se reutiliza el identificador y la carpeta cuando coinciden los identificadores originales y el contenido comprobado. No se deduce identidad solamente del nombre. Antes de descargar se verifica el archivo de destino con SHA-256; los bytes existentes no se descargan de nuevo. Las copias temporales de subida se retiran después de confirmar el estado remoto y persistirlo localmente. Las copias antiguas con procedencia registrada y contenido redundante se reparan automáticamente: se vinculan sus grupos con el original y se retira la copia. La reparación conserva un registro de recuperación y puede continuar tras una interrupción. La sala comprueba la versión y rechaza retirar copias con cambios de otros participantes. Los archivos modificados después de la comprobación se conservan; no se borran objetos antiguos de R2 como parte de esta reparación.

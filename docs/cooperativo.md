# Estudio cooperativo

Inicio → Compartir ofrece Estudio cooperativo y Sincronizar dispositivos. La
sincronización existente por R2/QR mantiene su configuración. Cooperativo usa
las cuentas de Pizarra; el campo admite `PersonaA, PersonaB` o
`[PersonaA, PersonaB]`. La misma lista de participantes reutiliza el grupo.

En Estudio, Cooperativo muestra los grupos. Mantener pulsada una esfera permite
copiarla o moverla al grupo. Copiar agrega un acceso al mismo material; mover
retira el acceso anterior. Una esfera pertenece a un grupo en esta versión.

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
  `cursado/shared/<sphereId>/` mediante multipart, hasta 100 MiB por archivo.
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

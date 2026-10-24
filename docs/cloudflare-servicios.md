# Servicios de colaboración de Cursado

La infraestructura vive en `cloudflare/`, separada de Next.js y Vite.
Wrangler está fijado a 4.151.0 en los comandos del proyecto.

## Recursos

- Worker: `cursado-realtime`, publicado en `workers.dev`.
- Binding `CONTENT_ROOMS`: clase `SharedContentRoom` con SQLite. La migración
  `v1` crea su namespace al desplegar. No hay que crear una sala por semana
  manualmente; cada contenido tendrá un ID estable.
- Binding `CONTENT_FILES`: bucket privado existente `estudiodiario`.
- Binding `IDENTITY_DIRECTORY`: registro de usuarios y sesiones en SQLite,
  creado por la migración `v2`, separado del contenido de las salas.
- Prefijo reservado para la futura colaboración: `cursado/shared/`.
- Origen de la interfaz: `https://cursado.vercel.app`.

El binding accede a R2 desde el Worker sin introducir claves S3 en el navegador.
No se modifica la configuración pública, CORS ni los objetos existentes del
bucket. La comprobación de infraestructura solo consulta una clave del prefijo.

## Acceso y despliegue desde CMD

Desde la raíz del repositorio:

```cmd
npx wrangler@4.151.0 login
npx wrangler@4.151.0 whoami
npm run cloudflare:deploy
```

Wrangler guarda la autorización fuera del repositorio. Si hay varias cuentas,
seleccionar la cuenta propietaria de `estudiodiario` mediante
`CLOUDFLARE_ACCOUNT_ID` en el entorno del comando. No subir tokens OAuth a Git.
No es necesario activar Workers Paid para esta clase SQLite; verificar el plan
en el panel de Cloudflare. R2 mantiene las condiciones de facturación de la
cuenta existente.

`GET /health` y `/healthz` comprueban acceso al namespace, SQLite y R2. Una
respuesta correcta incluye `phase: "cooperation"`, `authenticationReady` y
`collaborationReady: true`. Se cachea durante 60 segundos.

## Estado de la integración

La API implementa creación de usuario (`/api/auth/guest`), ingreso
(`/api/auth/login`), restauración (`/api/auth/me`), cierre de sesión, avatar y
cambio de contraseña. El formulario existente conserva esos contratos.
La biblioteca empieza vacía y la interfaz abre o crea una pizarra privada local.
El calendario se presenta vacío; sus escrituras, las pizarras compartidas,
invitaciones y reconocimiento de las rutas antiguas siguen respondiendo 501.
La colaboración de Estudio usa la nueva API `/api/cooperation/`, independiente
de esas rutas. Ver [Estudio cooperativo](cooperativo.md).
Las cuentas Python anteriores no se migran automáticamente.

Para usar este acceso, configurar `PIZARRA_BACKEND_URL` en Vercel con
`https://cursado-realtime.dariorafael2005.workers.dev` y volver a desplegar.
La cookie se entrega mediante el proxy del mismo origen, es HttpOnly, Secure,
SameSite=Lax y se limita a `/pizarra/`. Salir revoca la sesión; Ctrl+Q vuelve
al inicio conservándola.

Cloudflare necesita el secreto estable **AUTH_PEPPER**, independiente de los
secretos del organizador. Las contraseñas usan PBKDF2-SHA256 con sal aleatoria y
100.000 iteraciones (límite nativo de Cloudflare), más HMAC-SHA256 con ese secreto.
Los tokens de sesión son aleatorios y SQLite conserva solamente sus hashes.
Cambiar la contraseña revoca las otras sesiones. Conservar AUTH_PEPPER estable:
si cambia, se impediría verificar las contraseñas existentes.

El secreto se respalda en `cloudflare/.dev.vars`, ignorado por Git, y se carga
como secreto de Wrangler. Desde otra computadora, restaurar ese respaldo de
manera privada. Las mutaciones verifican el origen y el tamaño de los datos.
Los límites de intentos por cuenta y red persisten al reiniciar el objeto.

La colaboración de Estudio usa una sala por esfera compartida: copia local,
operaciones identificadas, autorización por sala, presencia temporal,
WebSocket con hibernación y recuperación tras desconexión. Los PDF originales
irán a R2; anotaciones y explicaciones se vincularán al ID y versión del PDF.

## Verificación

La opción nueva de compartir pizarras por enlace usa `/api/board-links/`,
el binding `BOARD_LINKS` y la migración `v3`. Reutiliza R2 y el proxy de acceso,
sin implementar las rutas antiguas del servidor Python. Ver
[Compartir pizarras por link](pizarra-compartir-link.md).

GitHub Actions ejecuta las pruebas de las rutas de infraestructura y la
compilación de Wrangler con `--dry-run`. No necesita credenciales Cloudflare
para esas comprobaciones y no despliega recursos automáticamente.

# Servicios de colaboración de Cursado

La infraestructura vive en `cloudflare/`, separada de Next.js y Vite.
Wrangler está fijado a 4.151.0 en los comandos del proyecto.

## Recursos

- Worker: `cursado-realtime`, publicado en `workers.dev`.
- Binding `CONTENT_ROOMS`: clase `SharedContentRoom` con SQLite. La migración
  `v1` crea su namespace al desplegar. No hay que crear una sala por semana
  manualmente; cada contenido tendrá un ID estable.
- Binding `CONTENT_FILES`: bucket privado existente `estudiodiario`.
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
respuesta correcta incluye `phase: "infrastructure"` y
`collaborationReady: false`. Se cachea durante 60 segundos.

## Estado de la integración

Estos recursos preparan el servicio; todavía no implementan login, permisos,
invitaciones, WebSockets ni sincronización de la Pizarra actual. Las rutas
`/api/*` y `/recognize/*` responden 501 explícitamente.

**No configurar todavía esta URL como `PIZARRA_BACKEND_URL` en Vercel.** Esa
variable continúa apuntando al backend Python compatible, cuando exista.
El cambio de backend se hará cuando estén implementadas y probadas las rutas
que consume Pizarra. Reconocimiento y otras funciones Python necesitan una
solución propia; no quedan implementadas por desplegar un Worker.

La evolución prevista es una sala por contenido compartido: copia local,
operaciones identificadas, autorización por sala, presencia temporal,
WebSocket con hibernación y recuperación tras desconexión. Los PDF originales
irán a R2; anotaciones y explicaciones se vincularán al ID y versión del PDF.

## Verificación

GitHub Actions ejecuta las pruebas de las rutas de infraestructura y la
compilación de Wrangler con `--dry-run`. No necesita credenciales Cloudflare
para esas comprobaciones y no despliega recursos automáticamente.

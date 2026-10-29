# Pizarra Sync

Pizarra colaborativa basada en [Komuboard](https://github.com/donth77/komuboard), commit `bff8475716ff817d756bd566272e07a59f9f129d`. Licencia MIT; ver LICENSE y los créditos de recursos VR en UPSTREAM_README.md.

- Aplicación: https://pizarra-sync.vercel.app
- Servidor: https://pizarra-komuboard.dariorafael2005.workers.dev
- Vercel sirve la interfaz Vite. Cloudflare Durable Objects con SQLite conserva las salas y sincroniza Yjs. R2 almacena imágenes.
- Sin registro: abrí la aplicación y usá **Compartir** para enviar el enlace. Cualquiera con ese enlace puede editar.
- Al renombrar una sala, su dirección queda como `/nuevo-nombre`. Un directorio SQLite en Cloudflare mantiene la relación con el tablero original; los nombres ocupados se rechazan para evitar mezclar salas. Los enlaces anteriores siguen resolviendo al mismo contenido.
- Sin eliminación programada de salas o imágenes. No requiere clave de licencia ni VPS. Se aplican las cuotas de los proveedores.

## Desarrollo

Node.js 22 o superior y pnpm 9.15.0:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

En Windows también funciona `npx.cmd --yes pnpm@9.15.0 dev`. Desarrollo local usa Wrangler y R2 emulados, sin credenciales. No configures `VITE_WORKER_HOST` para usar el servidor local. `.env.example` muestra el hostname de producción; no es necesario copiarlo para desarrollar.

## Verificación

Verificado en la URL pública: 24 pruebas de navegador aprobadas con sesiones independientes, incluyendo dibujo y arrastre antes de soltar el mouse, presencia, selecciones, enlaces, subidas R2, imágenes tras cerrar todos los clientes, reconexión, conflictos concurrentes y aislamiento de salas. También aprobaron la comprobación de tipos, 117 pruebas unitarias y la compilación. Las pruebas de persistencia verifican volver a entrar; no simulan una caída abrupta del proceso ni sustituyen una prueba de recuperación desde una copia de seguridad.

```sh
pnpm typecheck
pnpm test
pnpm build
```

Para probar la aplicación publicada, con Chromium de Playwright instalado:

```sh
E2E_WORKER_URL=https://pizarra-komuboard.dariorafael2005.workers.dev pnpm exec playwright test --config=playwright.production.config.ts e2e/live-draw.spec.ts e2e/live-drag.spec.ts e2e/reconnect.spec.ts e2e/persistence.spec.ts e2e/image.spec.ts --workers=1
```

En PowerShell usar `$env:E2E_WORKER_URL='https://pizarra-komuboard.dariorafael2005.workers.dev'` antes del comando. `E2E_BROWSER_PATH` permite indicar un navegador Chromium existente. Estas pruebas crean salas y suben imágenes al servicio real.

## Publicar cambios

1. Autenticar una vez: `pnpm --filter @komuboard/worker exec wrangler login`.
2. Publicar primero el servidor: `pnpm deploy`.
3. Publicar la interfaz: `npx vercel --prod` en el proyecto `pizarra-sync`.

`vercel.json` configura compilación, rutas SPA, encabezados y `VITE_WORKER_HOST` (hostname sin `https://`). `packages/worker/wrangler.toml` contiene identificadores públicos, sin credenciales. El bucket dedicado `pizarra-komuboard-assets` ya está creado. Conservar los nombres del Worker y del Durable Object al actualizar para mantener el acceso a las salas existentes. GitHub almacena el código; Vercel puede desplegar la interfaz mediante su integración con GitHub. Los cambios del servidor se publican por separado, antes del cliente.

## Límites

Dibujo y movimiento se transmiten en vivo; Yjs sincroniza el estado final. La edición simultánea del texto de una misma caja no combina por carácter. No incluye IA, permisos individuales ni cifrado de extremo a extremo. La reconexión conserva cambios mientras la página sigue abierta; cerrar sin conexión no garantiza conservarlos.

El guardado ocurre tras 2 segundos sin cambios y como máximo cada 5 segundos durante actividad, además de al salir el último cliente. No sustituye una copia de seguridad: exportá los tableros importantes. Al no haber limpieza automática, salas y archivos siguen consumiendo almacenamiento.

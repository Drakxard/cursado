# Compartir pizarras por link

El menú **+ → Compartir via link** y **Perfil → Compartir pizarra actual**
guardan la pizarra, publican sus archivos y copian el mismo enlace. Si el
navegador no permite copiar, el diálogo muestra el enlace para seleccionarlo.
El creador puede desactivarlo desde ese diálogo; el siguiente enlace será nuevo.

Quien abre el link entra directamente con su cuenta de Pizarra, si existe una
sesión, o con un animal aleatorio asignado por el servidor. Puede editar la
pizarra y las pizarras alcanzables por sus accesos directos, y leer sus PDF.
Agregar o quitar accesos modifica esa cadena. Los ciclos y los caminos repetidos
no duplican pizarras. Un destino que el creador no puede publicar permanece
sin autorización; conocer su identificador no concede acceso.

La colaboración conserva los identificadores de las pizarras originales.
Las referencias de los invitados usan alias locales separados. Sus imágenes
también tienen una caché separada. Los cambios se mezclan con el documento
original y, en los temas, se escriben en `progreso/pizarras` para que continúe
la sincronización habitual. El archivo del tema conserva la asociación y la base de sincronización de la
pizarra compartida, sin incluir el enlace ni credenciales, para recuperarlas
también al sincronizar la carpeta en otro dispositivo con la misma cuenta.
Los borradores se guardan localmente antes de enviarlos y se reintentan al
recuperar la conexión. Desactivar un enlace
impide nuevas lecturas y escrituras y cierra las conexiones de invitados;
no elimina archivos que ya hayan descargado.

## Servicio y despliegue

- API HTTP: `/pizarra/api/board-links/`, mediante el proxy existente de Next.
- Durable Object `BoardLinks`, binding `BOARD_LINKS`, migración SQLite `v3`:
  documentos, versiones, grafo, enlaces y autorizaciones.
- Archivos privados en el R2 existente, bajo `cursado/shared/board-links/`.
  Las subidas verifican tamaño y SHA-256 con tickets de un solo uso, sin
  credenciales R2 en el navegador. El máximo por archivo es 100 MiB; cada
  solicitud de documento admite hasta 4 MiB, sin incluir los binarios.
- WebSocket autenticado con ticket de un solo uso para presencia, trazos y
  avisos de versiones; HTTP y la copia local permiten recuperarse si falla.

Publicar **primero el Worker** con `npm run cloudflare:deploy` para aplicar
`v3`; luego desplegar la web, cuyo build genera la pizarra. Mantener
`PIZARRA_BACKEND_URL` apuntando al Worker y conservar `AUTH_PEPPER`,
`CURSADO_ORIGIN` y el bucket configurados. Esta función no usa el backend Python.
No se migran automáticamente las invitaciones antiguas del servidor Python.

## Verificación

`tests/board-links.test.mts` prueba la autorización y la persistencia con SQLite
y R2 simulado. `tests/board-links.browser.mjs` abre dos contextos de navegador
para comprobar edición, navegación en cadena, PDF, temas, desconexión y
revocación. Las comprobaciones de WebSocket en un Worker real se ejecutan con
la prueba de integración y `COOP_LOCAL_URL` apuntando a Wrangler local.

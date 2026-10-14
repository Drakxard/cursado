# Despliegue de Cursado en Vercel

Importar el repositorio `Drakxard/cursado`, rama `main`, raíz `./` y framework
**Next.js**. Mantener los comandos de instalación y compilación de `vercel.json`;
no elegir la carpeta de Pizarra como raíz ni establecer `public` como salida.

El inicio, las pizarras privadas y el organizador local pueden compilarse y
abrirse sin claves de proveedores. No se necesita `DATABASE_URL` en el modo
local actual. Configurar únicamente los servicios que se quieran utilizar.

En **Settings → Environment Variables**, agregar las variables al entorno
Production y también a Preview si se usarán esos despliegues. Después de
agregarlas o modificarlas, volver a desplegar.

## Pizarra compartida

| Variable | Valor |
| --- | --- |
| `PIZARRA_BACKEND_URL` | Origen HTTPS del servidor Python existente, por ejemplo `https://pizarra-api.example.com`. Sin `/api`, rutas, parámetros ni credenciales. |

Se lee durante la compilación. Sin ella, la pizarra ofrece las privadas y copias
del dispositivo, y la API compartida responde 503. El servidor Python debe
seguir conectado. En su `hosting.local.json`, actualizar `publicOrigin` al
origen HTTPS del nuevo sitio y `backendOrigin` al del servidor; reiniciar Python.

## Servicios y aplicaciones complementarias

| Función | Variables |
| --- | --- |
| Guardar/abrir credenciales de `User.Services` | `INSCREEN_CONFIG_SEED`: secreto estable de al menos 32 caracteres. |
| Vincular dispositivos y exportar a aplicaciones InScreen | `INSCREEN_PROVIDER_CAPSULE_SECRET`: otro secreto de al menos 32 caracteres. |
| Respaldo de la carpeta en Azure | `storage_azure`: cadena de conexión. `storage_azure_container` es opcional; por defecto `cursado2026`. |
| Verlo con Azure | `gpt5mini`: clave; `conexiongpt5mini`: endpoint del recurso/proyecto; `AZURE_OPENAI_DEPLOYMENT`: nombre del despliegue, por defecto `gpt-5-mini`. |
| Verlo/IA con AI Gateway | `gatewayia` (o `AI_GATEWAY_API_KEY` para Verlo). `PDF_EXPLANATION_MODEL` es opcional. |
| Transcripción de PDF con Datalab | `datalab` o `MARKER_API`. |
| Voz con Cloudflare | `cloudflareapi` y `CLOUDFLARE_ACCOUNT_ID`. |
| TTS con Azure | `apittshd`, `conexionttshd`; opcional `AZURE_TTS_HD_DEPLOYMENT`. |
| Funciones de Groq | `GROQ_API_KEY`. |
| Transcripción de audio con Gemini | `GEMINI_API_KEY`; `GEMINI_TRANSCRIBE_MODEL` y `GEMINI_TRANSCRIBE_PROMPT` son opcionales. |
| Almacenamiento InScreen/R2 | `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`. También se pueden configurar mediante `User.Services`. |
| Google Drive | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` igual a `https://TU-DOMINIO/api/google/oauth/callback`; registrar esa URI en Google. `GOOGLE_DRIVE_ROOT_FOLDER_NAME` es opcional. |
| Revisión móvil | `MOBILE_REVIEW_SECRET` y `APP_BASE_URL` igual al origen HTTPS del sitio. |

Para reutilizar archivos `User.Services` existentes, copiar el valor anterior
de `INSCREEN_CONFIG_SEED`: generar uno distinto impediría abrir sus credenciales.
Para secretos nuevos, generar un valor independiente para cada variable:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

`ALLOWED_GOOGLE_EMAIL` y `APP_AUTH_SECRET` corresponden al acceso administrado
del organizador en modo de base de datos; no son necesarios en su modo local
actual. La cuenta de la pizarra se administra en Python y permanece independiente.

Conservar los nombres y las mayúsculas exactamente como aparecen aquí. Las
claves son variables del servidor: no agregarles el prefijo `NEXT_PUBLIC_`,
no incluirlas en Git y no pegarlas en issues o registros de Actions.

Documentación: [variables de entorno de Vercel](https://vercel.com/docs/environment-variables).

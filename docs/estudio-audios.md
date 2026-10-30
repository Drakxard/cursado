# Audios en las esferas de Estudio

La lupa activa la entrada a las esferas de búsqueda. Dentro de una esfera, `+` abre AudioMass; el atajo se ignora en campos de texto. El editor conserva todas las herramientas y usa un tema claro. Al confirmar un nombre, guarda la mezcla completa como WAV PCM de 16 bits en la ubicación actual. Las cancelaciones con cambios piden confirmación.

Arrastrar un audio sobre otro crea un conjunto después de pedir su nombre. Arrastrar audios o conjuntos sobre un conjunto existente los mueve allí. El botón «Nivel superior» también recibe elementos arrastrados. No se admiten ciclos. El material anterior sigue disponible mediante «Material guardado anteriormente»; se retiró la carga de nuevas imágenes y la búsqueda manual `tema/temas`.

## Persistencia y cooperación

- `manifests/subject-voice/<materia>/audios.json`: versión 1, conjuntos con `parentId`, audios con identidad estable, ubicación, nombre, duración y transcripción.
- `subject-voice/audio/<materia>/<id>.wav`: audio confirmado. Las rutas usan el identificador de materia codificado.
- Los cambios de ubicación y guardados comparten un bloqueo de manifiesto entre pestañas. El audio y su texto se incorporan juntos. Las escrituras JSON utilizan el respaldo y verificación existentes.
- El escaneo cooperativo incluye estos archivos, remapea las rutas por materia y protege eliminaciones con el flujo existente.

## Transcripción

La grabación activa `SpeechRecognition` o `webkitSpeechRecognition`, en español de Argentina, con resultados provisionales y continuos. Se conserva la última versión de cada resultado para evitar duplicar palabras; si el navegador finaliza una sesión, se reinicia mientras siga la grabación. Las pausas suspenden el dictado y al confirmar se espera el último resultado antes de guardar. Una grabación nueva reemplaza el texto del intento anterior; reanudar o grabar sobre el audio existente lo continúa.

La app no descarga modelos ni ejecuta tareas de transcripción posteriores. El navegador puede utilizar un servicio remoto y requerir Internet. Si no soporta dictado o lo interrumpe, el audio se guarda igualmente, junto con el texto parcial disponible. Los estados nuevos son `none`, `completed`, `partial` y `unavailable`; los estados antiguos siguen siendo legibles, sin reactivar trabajos de Whisper. Los textos anteriores se conservan.

El texto corresponde a lo hablado durante la grabación. Importar un archivo no lo transcribe y recortar o reordenar el audio no ajusta el texto automáticamente.

## Recursos y verificación

AudioMass se conserva en `public/vendor/audiomass`, con licencia MIT, avisos de terceros y commit de origen en `CURSADO.txt`. La distribución completa ocupa aproximadamente 16,4 MB sin comprimir, incluidos los ejemplos; el iframe se monta solo al abrir el editor. El puente de dictado es JavaScript pequeño, sin dependencias ni modelos.

- `npm run test:audio`: almacenamiento, agrupación, integración cooperativa y flujo real de AudioMass en Chromium. El reconocimiento del navegador se simula para comprobar resultados provisionales/finales, reinicios, pausas, guardado, falta de soporte y errores sin depender del servicio de voz.
- `npm run typecheck` y `npm run build` verifican tipos y compilación de producción.

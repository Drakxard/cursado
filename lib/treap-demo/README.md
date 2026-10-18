# Prototipo de treaps

El archivo entregable es `public/demos/treap-d3.html`. Se puede abrir directamente o importar desde la estrella de Estudio, usando **Importar HTML** en una explicación abierta. Funciona sin internet y contiene D3 integrado; no llama al modelo.

Reconstruir: `npm run build:treap-demo`. Probar: `npm run test:treap-demo`.

Para otra explicación: `node scripts/build-treap-demo.mjs entrada.json salida.html`. La entrada se valida completa antes de escribir el HTML; el navegador vuelve a validarla al abrirlo. No hay carga de archivos JSON en la interfaz por ahora.

`example.json` es la entrada del ejemplo visible. El contrato versión 1 contiene `catalog`, `initial` y `steps`. Cada paso tiene `title`, `text`, `badge`, `operation` y, opcionalmente, `focus` (IDs presentes en ese paso). Se admiten hasta 40 pasos. Las operaciones son:

- `{ "type": "observe" }`: conservar el árbol actual y explicar o destacar nodos.
- `{ "type": "show", "tree": { ... } }`: mostrar otro estado inicial explícito, validado como ABB.
- `{ "type": "insert", "node": "id" }`: insertar un nodo del catálogo.
- `{ "type": "rotateLeft", "pivot": "id" }` o `rotateRight`: calcular una rotación.
- `{ "type": "check" }`: verificar que el ABB también cumpla el heap de máximo. Un conflicto hace fallar este paso.

`sequence.mjs` valida el contrato estricto y calcula snapshots independientes. Las señales de conflicto y éxito se derivan de los datos, no se aceptan afirmaciones `danger`/`success` del autor. Los textos son contenido literal; su corrección pedagógica aún requiere revisión y no se deduce de la validación estructural.

`model.mjs` compila el JSON de ejemplo para las pruebas del modelo. `operations.mjs` expone `createTreeModel(catalog)`: recibe hasta 64 nodos con IDs y claves únicas y valores numéricos finitos. Devuelve `inspect(tree)`, `insert(tree, nodeId)`, `rotateLeft(tree, pivotId)` y `rotateRight(tree, pivotId)`. Los árboles tienen `{ root: id | null, children: { [id]: [leftId | null, rightId | null] } }`.

Las operaciones validan el catálogo y el orden ABB, rechazan referencias inválidas y devuelven nuevos árboles sin modificar los anteriores. Admiten inserción en un árbol vacío y prioridades iguales. `inspect` devuelve claves en orden y las conexiones que violan el heap de máximo; esos conflictos temporales se permiten para poder explicarlos y se resaltan automáticamente en el gráfico. Insertar no balancea automáticamente: cada rotación sigue siendo una operación explícita.

`player.mjs` representa esos estados con SVG y anima posiciones y conexiones en el mismo temporizador de D3. `template.html` define la presentación sin dependencias externas.

`layout.mjs` distribuye árboles binarios mediante recorrido en orden, sin depender de los valores ni de las distancias numéricas entre claves. Conserva izquierda/derecha para hijos únicos, rechaza referencias inválidas y calcula un escenario común para todos los pasos. El reproductor mide los valores con la fuente real y ensancha las cápsulas y la separación entre nodos para conservar etiquetas completas. Los árboles anchos o profundos amplían el SVG y se exploran mediante desplazamiento. Las pruebas incluyen un árbol de 24 nodos y valores decimales, negativos y científicos largos. El ejemplo visible sigue siendo fijo; la IA y su contrato de generación no cambian.

Las pruebas comprueban las invariantes, el movimiento, la cancelación, tamaños de pantalla, movimiento reducido y ejecución sin conexión. `tests/pdf-explanation.browser.mjs` también importa el entregable desde el selector real de la estrella y comprueba su recarga.

## Piloto con GPT-5 mini en Azure

`npm run evaluate:treap` muestra tres casos sin llamar a la API: rotación izquierda, rotación derecha e inserción sin rotación. `npm run evaluate:treap -- --live --case=left` realiza una sola llamada al cliente Azure ya usado por el proyecto. Omitir `--case` ejecuta los tres casos secuencialmente, una llamada por caso, sin reintentos ni correcciones automáticas. Cada llamada tiene un límite de 6000 tokens de salida y 120 segundos.

La configuración se lee del entorno y de `.env.local` (ignorado por Git): `gpt5mini`, `conexiongpt5mini` y, si corresponde, `AZURE_OPENAI_DEPLOYMENT`. También se aceptan los alias `AZURE_OPENAI_API_KEY` y `AZURE_OPENAI_ENDPOINT`. Las credenciales nunca se incluyen en los HTML ni informes. No pegarlas en el chat. Se pueden quitar de `.env.local` al terminar la prueba.

El transporte de salida estructurada usa arrays de nodos con campos fijos, que `generation.mjs` convierte al contrato del visualizador. Sigue las [restricciones de Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). El piloto valida el catálogo, estado inicial, inserción, rotaciones esperadas y comprobación final. Rechaza reemplazos con `show` para impedir que se salten operaciones.

Los resultados se guardan en `.cache/treap-evaluation/<ejecución>/`: JSON generado, HTML si pasa y un informe de tiempos y tokens. Si la estructura generada es inválida, se conserva como `.invalid.json` con el error de validación, sin producir HTML. Los errores del proveedor se registran solo por su tipo para no volcar encabezados o respuestas sensibles. Un resultado aprobado estructuralmente aún necesita revisión visual y pedagógica; las pruebas simuladas del SDK no miden la calidad real de GPT-5 mini.

La revisión `treap-v2-visible-keys` limita el foco generado a dos nodos y pide identificar nodos mediante sus claves visibles y explicar el recorrido antes de insertar. El informe incluye indicadores de foco, menciones de IDs internos y cobertura del recorrido. Son indicadores parciales, no una prueba de la corrección del texto. Se guarda también `instructions.txt` para reproducir la variante del prompt.

`node scripts/review-treap-html.mjs ruta/al/archivo.html` revisa un HTML existente sin usar la API: navegación, conexiones, tres tamaños de pantalla y sandbox sin conexión. Guarda capturas por paso y un informe de navegador junto al archivo. No sustituye la revisión visual de las capturas.

`npm run evaluate:treap -- --live --case=source-treaps` prueba una sola generación desde la transcripción de la página 58 guardada en `source-page.json`, sin árbol ni valores preparados. Se ejecuta solo al seleccionar ese caso; la tanda predeterminada sigue teniendo tres casos fijos. El modelo debe identificar el ejemplo adicional en el primer título o texto, proponer un árbol inicial válido e insertar exactamente un nodo que cause una rotación. La evaluación comprueba las operaciones, no la fidelidad completa del texto. El panel permite desplazamiento interno cuando una explicación larga excede el espacio disponible.

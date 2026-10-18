# Explicaciones estructuradas de Verlo

Las nuevas respuestas usan una lección JSON `version: 2` para contenido mixto,
o `pantilla1_grafos` para relaciones, procesos, redes y transformaciones. Azure recibe un JSON
Schema estricto; Gateway recibe el mismo contrato en sus instrucciones y pasa
por la misma validación local. Una salida inválida permite un intento adicional
de corrección. Errores del proveedor no disparan correcciones ni un cambio a HTML
libre. La región seleccionada, la transcripción y las preferencias pedagógicas
siguen formando parte de la solicitud.

Los bloques admitidos son texto, fórmula LaTeX, tabla, diagrama y rotación. Las
rotaciones hacen referencia a un árbol previamente definido. La aplicación las
calcula, valida y convierte a estados SVG. Los árboles no admiten ciclos ni
componentes desconectados; los grafos dirigidos sí pueden contener ciclos.
La estructura válida no demuestra por sí sola la corrección pedagógica: la
revisión de contenido y ejemplos sigue siendo necesaria.

El compilador incluye el JSON, los controles y las fuentes KaTeX en un único
HTML. El contrato de respuesta `data-explanation: { html }`, el guardado, la
descarga y la lectura de HTML anteriores se mantienen. El renderizador nuevo
inserta el contenido del modelo como texto, sin ejecutar código generado.

## Verificación y comparación

- `npm run test:explanations` ejecuta validaciones, transporte y pruebas de
  navegador con respuestas controladas, incluidas las lecciones anteriores.
- `npm run evaluate:explanations` compara los bytes que el modelo tendría que
  producir para entregar exactamente la misma presentación mediante HTML
  completo o JSON. Usa AVL, grafo, tabla SQL y fórmula. Mide por separado el
  trabajo local de validación y compilación. Las fuentes embebidas incrementan
  el tamaño del HTML descargado, pero no el JSON producido por el modelo.
- Esa comparación no mide calidad, latencia ni tokens de GPT-5 mini en vivo.
  No representa una reducción demostrada de costo o tiempo de inferencia.
  El esquema y las instrucciones también consumen tokens de entrada.

Para una comparación real, usar en ambas versiones la misma página, región,
pregunta, despliegue y presupuesto de salida, con al menos cinco repeticiones
por caso. Revisar las etiquetas y conexiones, las rotaciones, la fórmula, las
filas de la tabla y los controles. Comparar medianas de tiempo, tokens de entrada
y salida y tasa de respuestas válidas; incluir los intentos de corrección en el
total. No reutilizar resultados de OCR entre versiones de forma desigual.

Los archivos de diagnóstico descargados incluyen ahora todos los eventos de
validación con duración acumulada, consumo informado por el proveedor e intento.
Permiten medir esos valores sin exponer credenciales. El despliegue conserva
el modelo y las credenciales existentes. No requiere migrar archivos guardados.

## Motor general de grafos

La estrella usa estas mejoras en su flujo habitual, sin un selector por tema:

- El reproductor de grafos usa D3 para actualizar el SVG e interpolar posiciones
  y opacidades con un reloj compartido. D3 se empaqueta dentro del HTML, sin CDN
  ni conexión. `build:pdf-explanation-ui` lo regenera antes de desarrollo y build
  de producción; la fuente está en `lib/client/pdf-explanation-graph-player.mjs`.
  El módulo `lib/pdf-explanation-graph-player.ts` es un artefacto generado que
  incorpora el servidor a cada explicación nueva. Las pruebas comprueban que
  ambos coincidan y que la estrella entregue, descargue y reabra ese motor.
- Cada elemento admite `datos: [{ etiqueta, valor }]`, hasta cuatro atributos
  de texto. Una posición puede reemplazarlos en ese paso; `null` conserva los
  datos base y `[]` los quita. Sirven para estados, costos, cantidades u otros valores.
- Las aristas admiten `etiqueta` y `dirigida`; ciclos y conexiones en ambos
  sentidos son válidos. Las relaciones contrarias se curvan para distinguirlas.
- El reproductor mide los textos, conserva las etiquetas completas y amplía
  la separación y el escenario cuando hace falta. No depende de reglas de árboles.
- Nodos, conexiones y etiquetas comparten la misma animación. Las aristas que
  se agregan o retiran aparecen y desaparecen gradualmente. Repetir y navegar
  rápidamente cancela la animación anterior antes de iniciar la siguiente.
- Cada diapositiva puede incluir `titulo` y `objetivo`: una idea y una frase
  que orienta la observación. Los HTML anteriores siguen siendo compatibles.
- Los comentarios buscan espacio junto al nodo y se conectan con una línea,
  también cuando hay tarjetas o etiquetas en aristas. Se prueban ocho posiciones;
  si no hay espacio, o en móvil, pasan debajo del escenario. Los escenarios
  grandes permiten desplazamiento para conservar la legibilidad.
- Al mover nodos aparecen marcas de origen y trayectorias temporales, que se
  retiran al terminar. Se respeta la preferencia de movimiento reducido.
- Las instrucciones y el ejemplo de generación separan preparación, movimiento,
  reconexión y comprobación. Esta guía mejora la secuencia solicitada; no garantiza
  que toda respuesta del modelo sea correcta pedagógicamente.

Para abrir un ejemplo revisado de ocho páginas de ABB/AVL sin llamar al modelo:
`node --experimental-strip-types scripts/preview-avl-teaching.mts`.
Genera `avl-explicado.html`; admite una ruta de salida como primer argumento.

Para probar tras desplegar, generar una explicación nueva desde la estrella:
los HTML guardados conservan el motor que tenían al crearse. Si hay un system
prompt personalizado antiguo, usar **Restaurar prompt predeterminado** y guardar
para probar las instrucciones actualizadas. La elección entre grafo y contenido
mixto depende del material y de la pregunta; se puede pedir explícitamente un
grafo con pasos visuales. La validez del formato no demuestra la corrección
del contenido ni garantiza una buena distribución para toda topología posible.

Las pruebas incluyen procesos, redes, dependencias, atributos por paso, texto
largo, ciclos, flechas, navegación rápida, movimiento reducido y compatibilidad
con explicaciones anteriores. Se verificó también una generación real con
GPT-5 mini para Cliente → Router → Servidor, con cambios de buffer en tres pasos.

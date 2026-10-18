# Explicaciones estructuradas de Verlo

Las nuevas respuestas usan una lección JSON `version: 2`. Azure recibe un JSON
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

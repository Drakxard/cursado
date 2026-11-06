# Exportación de imágenes de Síntesis

El botón ↓ descarga una imagen **PNG**. Si hay una selección dentro del editor,
exporta solamente ese fragmento; sin selección, exporta todo el apunte. El botón
conserva la selección al pulsarlo y la captura antes de abrir el diálogo de progreso.

`lib/client/synthesis-image.ts` conserva texto parcial, listas, tablas, imágenes y
estilos. Las fórmulas KaTeX se copian completas aunque el extremo de la selección
caiga dentro de una fórmula. La copia se prepara fuera de pantalla, sin modificar
el documento ni la selección originales, y se elimina al terminar o cancelar.
También reconoce un nodo o imagen seleccionado y omite el resaltado temporal de
selección del editor, conservando los resaltados propios del apunte.

El PNG se genera directamente desde las franjas renderizadas, con **escala 2 fija**
para selecciones y documentos completos, independientemente de su longitud.
`lib/client/tiled-png.ts` une las filas en un único PNG mediante compresión por
stream y bloques IDAT, sin crear un lienzo del tamaño del documento ni reducir
el texto para ajustarlo a un límite global de píxeles. Cada franja mantiene su
presupuesto de memoria y se libera después de comprimirla. El archivo puede superar
las dimensiones que algunos visores de imágenes admiten; esos visores pueden
necesitar otro programa para abrirlo a resolución completa.
Los archivos se llaman `sintesis-seleccion.png` o `sintesis.png`.
Las regresiones de PNG están en `tests/synthesis-image.browser.mjs`, disponibles
mediante `npm run test:synthesis-image` sin requerir una compilación completa.
Incluyen la lectura y descompresión de un PNG de 68060 px de alto para comprobar
su resolución, el contenido entre franjas y el final, sin un lienzo gigante.

## Render compartido y compatibilidad

Se conserva el constructor SVG anterior para integraciones existentes y sus pruebas;
el botón del editor utiliza exclusivamente la descarga PNG. Los detalles siguientes
describen ese constructor de compatibilidad y el render por franjas compartido.

`lib/client/synthesis-svg.ts` copia el contenido y los estilos calculados del
editor, excluye sus controles y prepara imágenes y fuentes como datos locales.
El navegador renderiza esa copia mediante un SVG intermedio con `foreignObject`.
El archivo descargado sólo contiene un fondo y elementos `<image href="data:…">`;
no contiene HTML, referencias externas ni `foreignObject`.

La apariencia del texto, las tablas y las imágenes queda incorporada en el
renderizado. Como en la exportación de PDF.js, el texto no es editable como
vector y ampliar por encima de la resolución renderizada muestra píxeles.
Las fuentes utilizadas, incluidas las de hojas `@import`, se incrustan antes de
renderizar para conservar sus glifos al abrir el archivo sin conexión.

El documento completo se divide en franjas de hasta 2048 px de alto, sin huecos
entre ellas, con un máximo de 4 millones de píxeles por lienzo a escala 2.
Cada franja prepara solo los bloques cercanos a su área visible; los demás
conservan su espacio y márgenes sin copiar sus fórmulas y contenido interno.
Las medidas y estilos se reutilizan entre franjas. Los estilos idénticos se
agrupan en reglas CSS compartidas para reducir el SVG intermedio que debe
serializar y decodificar el navegador, especialmente en apuntes con fórmulas.
El `foreignObject` mide lo mismo que la franja, y la imagen intermedia y el
lienzo se liberan antes de preparar la siguiente. Esto reduce la memoria
usada por documentos largos con muchas fórmulas. PDF.js conserva la
separación de 16 px entre páginas. La exportación no altera el documento,
la selección ni el desplazamiento del editor. Si falla, el botón muestra el
error en pantalla y permite reintentar; se desactiva durante la exportación.
Una ventana muestra el progreso y permite cancelar. El procesamiento cede
tiempo al navegador entre bloques para atender eventos y pintar la interfaz.

Prueba de regresión en Chromium (instalar el navegador una vez):

```sh
npx playwright install chromium
npm run test:svg
```

Comprueba el serializador compartido, la descarga, el renderizado de texto,
tablas, listas e imágenes fuera de pantalla, la exclusión de controles y la
conservación de la selección. Una imagen que no puede incrustarse aborta la
descarga. También verifica fuentes importadas en un SVG abierto sin conexión y
el contenido final de un documento de más de 32767 px de alto. No automatiza
la importación dentro de Figma.
También comprueba progreso, cancelación, caracteres de texto inválidos en XML
y el editor Tiptap real con sus separadores de cursor. Una prueba con fórmulas
en múltiples franjas verifica que no se incluyan las fórmulas fuera del área
visible, que todas las franjas respeten el límite de píxeles y que el texto
renderizado sobreviva a lo largo del documento.

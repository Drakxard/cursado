# Pegado de texto y árboles

Ctrl+V sobre el lienzo crea un elemento Texto cuando el portapapeles contiene texto común. El menú contextual «Pegar» también permite insertar texto. El pegado dentro de un campo de edición sigue perteneciendo a ese campo.

Los objetos propios copiados, enlaces, YouTube, archivos, imágenes, SVG y tablas conservan sus rutas anteriores. Si aparece una URL en cualquier parte del texto, no se interpreta como mindmap ni como KaTeX.

## Árboles de implicaciones

Se admite este subconjunto local de [PlantUML MindMap](https://plantuml.com/mindmap-diagram):

```plantuml
@startmindmap
* Sistema lineal $X'=A(t)X+F(t)$
** Continuidad de los coeficientes
*** Existencia y unicidad
** Sistema homogéneo
*** Principio de superposición
@endmindmap
```

También se puede copiar una cerca de código completa. Se requiere una raíz, sin saltos de nivel, con hasta 127 nodos, 24 niveles y 2000 caracteres por etiqueta. No se interpretan estilos, inclusiones, directivas ni otras familias de diagramas. Una entrada inválida se pega íntegra como texto y muestra un aviso.

El árbol se distribuye horizontalmente y se ajusta a la vista. Cada nodo es una figura nativa y cada arista es un conector anclado. Un clic selecciona el grupo para moverlo; doble clic selecciona un nodo y permite editarlo con la barra habitual. Una importación completa se deshace en un paso. No hay un documento PlantUML separado que reemplace las ediciones de los nodos.

## Edición y fórmulas

Doble clic muestra la fuente de texto sobre el elemento, ocultando su etiqueta dibujada. Enter agrega una línea; Escape o tocar fuera guarda. La posición del editor respeta el zoom y la rotación de la figura.

Textos y etiquetas sin URL muestran fórmulas con `$…$`, `$$…$$`, `\(...\)` y `\[...\]`; los nodos también admiten `<latex>…</latex>`. Se conserva la fuente y las fórmulas inválidas permanecen legibles. No se convierte automáticamente notación matemática sin delimitadores.

El render utiliza KaTeX existente, con `trust: false`, y rasterización serializada con `html-to-image`. Una caché en memoria limita las representaciones a 256 entradas y 16 millones de píxeles; el zoom y el desplazamiento no invalidan las entradas. Si no puede generar una imagen o se excede el presupuesto de imágenes, se mantiene el texto fuente. Las exportaciones preparan las fórmulas antes de pintar y liberan la retención temporal al terminar.

## Verificación en CI

El workflow `checks.yml` admite `workflow_dispatch` con `focus: pizarra-text`. Compila la pizarra y ejecuta exclusivamente las pruebas del importador y los escenarios de pegado/edición con un trabajador de navegador. Publica capturas y diagnósticos. Los casos también están incluidos en las comprobaciones habituales. No requiere ejecutar compilaciones o navegadores localmente.

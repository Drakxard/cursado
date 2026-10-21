# Memoria de la pizarra

La pizarra conserva los archivos originales en almacenamiento. Las vistas previas
se decodifican según zoom, tamaño mostrado y densidad de pantalla, con un presupuesto
conjunto de 64 MiB y un máximo de dos operaciones simultáneas. Los recursos que salen
de pantalla, se borran o pertenecen a una pizarra cerrada liberan sus píxeles. Los
resultados tardíos no vuelven a incorporarse. El presupuesto es de la caché retenida;
no limita la RAM total del navegador ni los buffers transitorios del decodificador.

Los lectores PDF cerrados se desmontan. Solo quedan hasta 50 posiciones de lectura
por contexto, sin documentos, workers ni canvas ocultos. El lector de la pizarra
restaura página, zoom y desplazamiento; los resultados de búsqueda restauran scroll.
La importación carga PDF.js bajo demanda y destruye su tarea y canvas al finalizar
o fallar; desmontar la pizarra cancela una importación pendiente. El historial sigue
conservando cinco cambios, con copias independientes de los datos editables.

## Medición reproducible

Se midió Chromium con doce originales PNG de 3200 × 2400, mostrados a 300 × 200 en
una ventana de 1366 × 900, DPR 1. Se usó la misma secuencia antes y después: cargar
la pizarra, esperar las doce imágenes, medir, recorrer y volver diez veces, medir.
Los datos son sintéticos; no son una medición del archivo de la captura del usuario.

| Momento | Working set antes | Working set después | Reducción |
| --- | ---: | ---: | ---: |
| Imágenes visibles | 941,6 MiB | 600,1 MiB | 36,3 % |
| Tras diez recorridos | 948,7 MiB | 620,1 MiB | 34,6 % |

El working set suma los procesos de esa instancia de Chromium, incluido GPU y
navegador; **no equivale al indicador de memoria de una pestaña de Chrome**. Los
valores crudos son 987303936 → 629227520 bytes y 994746368 → 650174464 bytes.
El heap JavaScript fue 6538392 → 5954792 bytes al cargar y 7016628 → 6497944 bytes
tras recorrer. Había tres canvas (14752800 bytes nominales), un iframe y un worker
en ambas mediciones; el worker observado en este escenario no era de importación PDF.
DOM tras los recorridos: 203 → 191 nodos y 232 listeners en ambas versiones.

Para repetir, compilar con `npm run build:pizarra`, servir `pizarraproyecto-main/dist`
con Vite preview en el puerto 4173 y ejecutar desde la raíz:

```sh
node scripts/measure-board-memory.mjs resultado.json
```

El script separa heap, working set, DOM, canvas, iframe y workers. El working set se
consulta mediante PowerShell en Windows; en otros sistemas se informa como `null`.
El tamaño del bundle no se utiliza como estimación de memoria.

## Verificación funcional

- Pruebas de caché: reparto del presupuesto, dos decodificaciones, cambios de zoom,
  liberación de recursos borrados y rechazo de cargas tardías al cerrar.
- Chromium: diez ciclos fuera/dentro de pantalla sin retener las vistas previas,
  original de 4000 píxeles intacto, borrado y deshacer; workers PDF ausentes después
  de una importación válida y otra inválida.
- Lectores: diez aperturas/cierres sin iframe retenido, restauración de coordenadas
  al cambiar documentos y cierre mientras todavía carga.
- Resultados PDF: diez aperturas/cierres, solo un lector activo y scroll restaurado.
- Regresiones: recorte, exportación/captura desde originales, tablet, cinco niveles
  de deshacer y colaboración con dos usuarios. Visor PDF real: cerrar/reabrir con
  zoom restaurado y captura de imagen, tabla y gráfico.

La prueba integral general de biblioteca también se intentó: no pudo encontrar el
ancestro `div[draggable=true]` del material de su fixture y terminó por timeout antes
de abrir el lector. La prueba específica con el visor PDF real sí pasó. Este fallo
general no se cuenta como una verificación exitosa ni como una regresión descartada.

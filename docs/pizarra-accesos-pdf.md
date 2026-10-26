# Accesos a PDF en la pizarra

Mantener pulsado un acceso del lienzo durante 600 ms lo despliega como páginas
agrupadas, con renderizado bajo demanda desde una copia del PDF original.
El gesto del icono lateral conserva su función de centrar el acceso.
Ver [PDF desplegado en la pizarra](pizarra-pdf-desplegado.md).

En InScreen, un toque sobre el acceso o su icono fijado abre el lector PDF nativo.
Arrastrar y usar dos dedos sigue desplazando o ampliando la pizarra, sin mover
elementos ni abrir un PDF accidentalmente. Se vuelve con el botón o gesto de
Android, conservando la pantalla de origen. Si no se puede abrir el archivo,
aparece un mensaje con una opción para reintentar. No se precargan lectores web
en el modo de consulta de Android.

Al seleccionar un único acceso a PDF aparece una chincheta junto al elemento.
Activarla agrega ese acceso a la barra lateral. Volver a activarla lo desfija.
La selección de varios elementos no muestra esta acción.

Cada PDF fijado tiene un icono con el nombre del archivo como descripción.
Un clic abre el mismo lector del acceso original. Mantener pulsado durante
600 ms centra la pizarra en ese elemento y lo selecciona para moverlo o desfijarlo.
Con teclado, Mayús+Enter realiza la misma acción. Los elementos fijados se guardan
con la pizarra y participan de deshacer, rehacer y sincronización. Duplicar un
acceso no fija automáticamente la copia; eliminarlo también retira su icono.

Arrastrar un acceso perteneciente a la selección múltiple conserva el grupo.
Soltar esa selección no abre un PDF accidentalmente.

No se precargan lectores PDF. El ?ltimo PDF fijado permanece cargado al ocultarlo durante la sesi?n de la pizarra: ?<? y su bot?n alternan su visibilidad instant?neamente. Se retiene como m?ximo un lector, sin foco ni interacci?n mientras est? oculto; cambiar de pizarra, reemplazar el lector o recargar lo libera. Cerrar un lector no fijado desmonta su iframe y conserva
solo su página, zoom y desplazamiento para restaurarlos al reabrir. Se guardan
hasta 50 posiciones por pizarra, incluso al alternar documentos. Recargar
la página o cambiar de pizarra reinicia esta memoria. Ver [mediciones de memoria](pizarra-memoria.md).

Deshacer conserva los últimos cinco cambios del lienzo. Esos cinco cambios
también pueden rehacerse; realizar un cambio nuevo descarta la rama de rehacer.

GitHub Actions ejecuta las pruebas de `pdf-shortcuts.spec.mjs`, incluidas
fijación, pulsación prolongada, guardado, movimiento grupal, alternancia entre
lectores, liberación de los PDF cerrados y cinco cambios de deshacer. La validación del servidor se comprueba
con `tests/pdf_shortcuts.test.py`.

Las actualizaciones se descargan en segundo plano y se usan en la próxima apertura. Nunca recargan la sesión abierta ni cierran sus editores o ventanas.

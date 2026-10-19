# Accesos a PDF en la pizarra

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

El lector precarga inicialmente dos PDF distintos. Los PDF visitados conservan
su iframe y su estado durante la sesión de esa pizarra, hasta ocho lectores.
Al superar ese límite se descarta el menos recientemente visitado. Recargar
la página o cambiar de pizarra reinicia esta memoria. No se precargan todos
los accesos ni se promete conservar lectores que el navegador descarte.

GitHub Actions ejecuta las pruebas de `pdf-shortcuts.spec.mjs`, incluidas
fijación, pulsación prolongada, guardado, movimiento grupal, alternancia entre
cinco lectores y límite de retención. La validación del servidor se comprueba
con `tests/pdf_shortcuts.test.py`.

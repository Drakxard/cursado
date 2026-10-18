# Accesos a PDF en la pizarra

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

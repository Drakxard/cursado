# Pizarras del inicio en la carpeta de Estudio

Las pizarras privadas del inicio usan `boards/library.json` para su catálogo y
`boards/<hash>.json` para cada escena. Los adjuntos originales se guardan como
`boards/<hash-del-contenido>.bin`, separados del JSON y compartidos cuando sus
bytes coinciden. El formato conserva los identificadores, accesos a otras
pizarras, geometría, objetos adicionales y la información de enlaces compartidos.
Es compatible con los documentos que ya interpreta la publicación nativa.

Al listar se combinan los metadatos de la carpeta con las pizarras anteriores del
navegador. La migración ocurre al abrir una pizarra: si todavía no existe en la
carpeta, se copian sus adjuntos y escena, se verifica la escritura y se agrega al
catálogo. IndexedDB conserva la copia anterior. Si ya existe un documento en la
carpeta, ese documento tiene prioridad sobre una copia vieja del navegador.

Los guardados posteriores leen el archivo actual y combinan los cambios con la
escena que se abrió, para conservar aportes independientes de otra instancia.
Los adjuntos con el mismo identificador se reutilizan sin leer ni volver a
procesar sus originales por cada edición de texto. Renombrar, mover a una carpeta
y eliminar actualizan el catálogo. Las eliminaciones se registran para impedir
que otro navegador reincorpore una copia antigua.

Cada navegador debe conectar y autorizar la misma carpeta de Estudio. Se ofrece
el botón **Conectar carpeta de Estudio** en **Mis pizarras**, también cuando el
arranque falla por falta de permisos. Si una pizarra ya se migró, perder el acceso
a su carpeta muestra un error y conserva la copia del navegador; no la presenta
como si fuera el archivo actual. Una pizarra antigua sin migrar puede seguir
usando el almacenamiento del navegador hasta conectar la carpeta.

Las pizarras de temas siguen usando `progreso/pizarras/`; las compartidas de
servidor y las abiertas como invitado conservan sus mecanismos actuales.
La publicación incluye los documentos de `boards/` aunque el navegador no tenga
una copia en IndexedDB y evita sustituirlos por escenas antiguas de esa base.

Validación:

```powershell
npm.cmd run build:pizarra
npm.cmd run typecheck
node --test tests/board-workspace.browser.mjs tests/board-paste-media.browser.mjs
node --test --experimental-strip-types tests/workspace-library-publisher.test.mts tests/topic-board-sync.test.mts
cd pizarraproyecto-main
node node_modules/vitest/vitest.mjs run tests/workspace-boards.test.ts tests/device-storage.test.ts
```

La prueba de navegador usa una carpeta de prueba OPFS y vacía IndexedDB para
comprobar la recuperación sin depender de las copias anteriores. No abre carpetas
personales ni demuestra exclusión mutua entre procesos de navegadores distintos;
los bloqueos Web Locks coordinan pestañas del mismo origen y navegador.

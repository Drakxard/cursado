# Vendored Pizarra Sync

Source: sibling `pizarra-sync`, commit `ea8cc2aa3aa20d41cf19e607a3d1b2dd330a0f21`.
Based on Komuboard; MIT license and third-party credits are preserved.

The complete tracked source is included, excluding secrets and deployment metadata.
Cursado adds an embedded Study bridge, Study objects, a material importer and the
Cursado origins in the Worker. The original `/pizarra` bundle is independent.

`npm run build:study-board` installs the locked pnpm workspace when necessary,
then builds only the web client into `public/study-board`. Set
`STUDY_BOARD_WORKER_HOST` to override the existing worker hostname.

The worker source is retained with its existing Durable Object and R2 names.
Deploy it before using the embedded client on Cursado's origin.

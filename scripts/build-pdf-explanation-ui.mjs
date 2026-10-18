import { build } from "esbuild"

await build({
  entryPoints: ["lib/client/pdf-explanation-ui.ts"],
  outfile: "public/pdfjs/web/viewer-explanation-sdk.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  minify: true,
  legalComments: "eof",
})

// Load the compiler only when opening/importing a CDN-based presentation.
await build({
  entryPoints: ["lib/client/pdf-explanation-import.ts"],
  outfile: "public/pdfjs/web/viewer-explanation-import.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  loader: { ".css": "text" },
  minify: true,
  legalComments: "eof",
})

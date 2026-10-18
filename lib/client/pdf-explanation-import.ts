import { compile } from "tailwindcss"
import theme from "tailwindcss/theme.css"
import preflight from "tailwindcss/preflight.css"

const slideStyles = `
html:has(body[data-pdf-slide-deck]){height:100%;width:100%;overflow:hidden}
body[data-pdf-slide-deck]{box-sizing:border-box!important;margin:0!important;width:100%!important;height:100%!important;min-height:0!important;display:grid!important;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto;gap:8px;padding:clamp(6px,1.5vmin,20px)!important;overflow:hidden!important}
body[data-pdf-slide-deck]>header,body[data-pdf-slide-deck]>footer{min-width:0;max-width:100%;width:100%;margin:0 auto;flex-wrap:wrap;gap:8px;padding:8px!important}
body[data-pdf-slide-deck]>header>div{min-width:0;max-width:100%}
body[data-pdf-slide-deck]>header>div:first-child{flex:1}
body[data-pdf-slide-deck]>header h1{min-width:0;font-size:clamp(13px,2.2vw,18px)!important}
body[data-pdf-slide-deck]>main{position:relative!important;width:100%;max-width:100%;height:100%;min-width:0!important;min-height:0!important;margin:0 auto!important;overflow:hidden!important}
body[data-pdf-slide-deck]>main>svg{position:absolute;inset:0;width:100%!important;height:100%!important;max-height:100%!important;min-width:0;min-height:0}
body[data-pdf-slide-deck]>footer>div{flex-wrap:wrap;min-width:0}
@media(max-width:480px){body[data-pdf-slide-deck]>header{gap:4px}body[data-pdf-slide-deck]>header>div:last-child{display:none}body[data-pdf-slide-deck]>footer button{padding:6px 10px}}
`

/** Prepare in a detached DOM: imported scripts only run later in the sandbox. */
export async function preparePdfExplanationHtml(html: string): Promise<string> {
  if (html.length > 1_500_000) throw new Error("El HTML supera el tamaño permitido.")
  if (!/<html[\s>]/i.test(html) || !/<\/html\s*>/i.test(html)) throw new Error("Elegí un documento HTML completo.")
  const doc = new DOMParser().parseFromString(html, "text/html")
  const tailwind = [...doc.querySelectorAll<HTMLScriptElement>("script[src]")].filter(script => {
    try { return new URL(script.src).hostname === "cdn.tailwindcss.com" } catch { return false }
  })
  if (tailwind.length) {
    // Scan script strings too: slide players often construct their class lists.
    const candidates = [...new Set(html.match(/[A-Za-z0-9_!@#%.[\]():/,+~=-]+/g) ?? [])].filter(value => value.length <= 200)
    const compiler = await compile(`${theme}\n${preflight}\n@tailwind utilities;`)
    const css = doc.createElement("style")
    css.dataset.pdfImportedTailwind = ""
    css.textContent = compiler.build(candidates).replace(/<\/style/gi, "<\\/style")
    // Utilities precede authored styles, matching the original CDN ordering.
    doc.head.prepend(css)
    tailwind.forEach(script => script.remove())
    for (const link of doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
      try { if (new URL(link.href).hostname === "fonts.googleapis.com") link.remove() } catch { /* Not an external font URL. */ }
    }
  }
  // Recognize viewport slide decks; ordinary scrollable HTML keeps its layout.
  if (doc.body.classList.contains("h-screen") && doc.body.classList.contains("flex-col") &&
      doc.querySelector("body > header") && doc.querySelector("body > main > svg[viewBox]") && doc.querySelector("body > footer")) {
    doc.body.dataset.pdfSlideDeck = ""
    const fit = doc.getElementById("pdf-slide-fit") ?? doc.createElement("style")
    fit.id = "pdf-slide-fit"; fit.textContent = slideStyles; doc.head.append(fit)
  }
  return '<!doctype html>\n' + doc.documentElement.outerHTML
}

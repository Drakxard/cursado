// KaTeX already supplies a self-contained visual tree and stylesheet. Preserve
// those instead of resolving hundreds of computed properties for every glyph.
// Inaccessible or incomplete stylesheets retain the general computed-style path.
export function katexExportCss(): string {
  const visited = new Set<CSSStyleSheet>()
  function sheet(source: CSSStyleSheet): string {
    if (visited.has(source)) return ""
    visited.add(source)
    try { return rules(source.cssRules) } catch { return "" }
  }
  function rules(source: CSSRuleList): string {
    const result: string[] = []
    for (const rule of Array.from(source)) {
      if (rule instanceof CSSStyleRule) {
        if (rule.selectorText.includes(".katex")) result.push(rule.cssText)
      } else if (rule instanceof CSSImportRule && rule.styleSheet) result.push(sheet(rule.styleSheet))
      else if ("cssRules" in rule) {
        const nested = rules((rule as CSSGroupingRule).cssRules)
        if (nested) result.push(`${rule.cssText.slice(0, rule.cssText.indexOf("{"))}{${nested}}`)
      }
    }
    return result.join("\n")
  }
  const css = Array.from(document.styleSheets, sheet).join("\n")
  return css.includes(".katex .base") && css.includes(".katex .mfrac") ? css : ""
}

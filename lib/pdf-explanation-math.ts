import katex from 'katex'
import { StructuredLessonError } from './pdf-explanation-structured.ts'

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Render only explicit math delimiters; surrounding text is always escaped. */
export function graphMathHtml(text: string): string | undefined {
  const pattern = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)(?<!\\)\$/g
  let html = '', offset = 0, found = false
  for (const match of text.matchAll(pattern)) {
    found = true
    html += escape(text.slice(offset, match.index))
    try {
      html += katex.renderToString(match[1] ?? match[2] ?? match[3] ?? match[4], {
        displayMode: match[1] !== undefined || match[2] !== undefined,
        throwOnError: true, trust: false, strict: 'ignore', maxExpand: 200, maxSize: 20,
      })
    } catch { throw new StructuredLessonError('Fórmula inválida en el mapa: revisá los delimitadores y la sintaxis LaTeX.') }
    offset = match.index! + match[0].length
  }
  return found ? html + escape(text.slice(offset)) : undefined
}

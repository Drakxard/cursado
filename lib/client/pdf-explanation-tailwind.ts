import { compile } from 'tailwindcss'
import theme from 'tailwindcss/theme.css'
import preflight from 'tailwindcss/preflight.css'

export async function compileExplanationTailwind(candidates: string[]) {
  const compiler = await compile(`${theme}\n${preflight}\n@tailwind utilities;`)
  return compiler.build(candidates)
}

import type { GraphPresentation } from '../../lib/pdf-explanation-graphs.ts'

export const mathGraphFixture: GraphPresentation = {
  plantilla: 'pantilla1_grafos', titulo: 'Resolver una ecuación y verificar el resultado',
  elementos_iniciales: [
    { id: 'ecuacion', tipo: 'nodo', etiqueta: String.raw`\(\frac{x}{2}+1=3\)` },
    { id: 'aislar', tipo: 'nodo', etiqueta: String.raw`\(\frac{x}{2}=2\)` },
    { id: 'resultado', tipo: 'nodo', etiqueta: String.raw`\(x=4\)`, datos: [{ etiqueta: 'Vector', valor: String.raw`$$\begin{pmatrix}x\\1\end{pmatrix}=\begin{pmatrix}4\\1\end{pmatrix}$$` }] },
    { id: 'verificar', tipo: 'nodo', etiqueta: String.raw`\(\frac{4}{2}+1=3\)` },
  ],
  diapositivas: Array.from({ length: 4 }, (_, index) => ({
    paso: index + 1,
    titulo: ['Leer la ecuación', 'Restar uno', 'Multiplicar por dos', 'Verificar'][index],
    objetivo: 'Una operación por paso, conservando la igualdad.',
    posiciones: Object.fromEntries(['ecuacion', 'aislar', 'resultado', 'verificar'].map((id, i) => [id, {
      fila: 3, columna: 1 + i * 3, estado: i === index ? 'destacado' : i > index ? 'atenuado' : 'normal',
    }])),
    aristas: index ? [{ desde: ['ecuacion', 'aislar', 'resultado'][index - 1], hacia: ['aislar', 'resultado', 'verificar'][index - 1], estilo: 'animado_verde', dirigida: true,
      etiqueta: [String.raw`\(-1\)`, String.raw`\(\times 2\)`, 'Sustituir'][index - 1] }] : [],
    comentarios: [{ anclado_a: ['ecuacion', 'aislar', 'resultado', 'verificar'][index], posicion: 'abajo', color: 'azul',
      texto: [String.raw`Buscamos \(x\).`, String.raw`Restamos \(1\) a ambos miembros.`, String.raw`Multiplicamos por \(2\), por eso \(x=4\).`, String.raw`La comprobación da \(3=3\).`][index] }],
  })),
}

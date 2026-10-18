import type { GraphPresentation } from '../../lib/pdf-explanation-graphs.ts'

export function generalGraphFixture(topic: 'process' | 'network' | 'dependencies' = 'process'): GraphPresentation {
  const labels = {
    process: ['Solicitud recibida', 'Validación de los datos', 'Procesamiento'],
    network: ['Cliente', 'Servidor de aplicaciones', 'Base de datos'],
    dependencies: ['Obtener datos', 'Calcular resultados', 'Publicar informe'],
  }[topic]
  return {
    plantilla: 'pantilla1_grafos', titulo: `Ejemplo de ${topic}`,
    elementos_iniciales: labels.map((etiqueta, i) => ({ id: ['A','B','C'][i], tipo: 'nodo', etiqueta,
      datos: [{ etiqueta: 'Estado', valor: ['recibido','pendiente','en espera'][i] }, { etiqueta: 'Cantidad', valor: String(i + 1) }] })),
    diapositivas: [
      { paso: 1, posiciones: { A: { fila: 3, columna: 2, estado: 'destacado' }, B: { fila: 3, columna: 5, estado: 'normal' }, C: { fila: 3, columna: 8, estado: 'atenuado' } },
        aristas: [{ desde: 'A', hacia: 'B', estilo: 'animado_amarillo', etiqueta: 'enviar', dirigida: true }, { desde: 'B', hacia: 'A', estilo: 'solido', etiqueta: 'respuesta', dirigida: true }, { desde: 'B', hacia: 'B', estilo: 'solido', etiqueta: 'reintentar', dirigida: true }],
        comentarios: [{ anclado_a: 'A', posicion: 'abajo', color: 'azul', texto: 'Primero se observa la relación de entrada.' }] },
      { paso: 2, posiciones: { A: { fila: 3, columna: 2, estado: 'atenuado' }, B: { fila: 2, columna: 5, estado: 'exito', datos: [{ etiqueta: 'Estado', valor: 'completado' }, { etiqueta: 'Cantidad', valor: '0' }] }, C: { fila: 3, columna: 8, estado: 'destacado', datos: [{ etiqueta: 'Estado', valor: 'en curso' }] } },
        aristas: [{ desde: 'B', hacia: 'C', estilo: 'animado_verde', etiqueta: 'habilita', dirigida: true }],
        comentarios: [{ anclado_a: 'C', posicion: 'abajo', color: 'verde', texto: 'El resultado habilita la etapa siguiente.' }] },
      { paso: 3, posiciones: { A: { fila: 3, columna: 2, estado: 'normal', datos: null }, B: { fila: 2, columna: 5, estado: 'normal', datos: [] }, C: { fila: 3, columna: 8, estado: 'exito', datos: [{ etiqueta: 'Estado', valor: 'finalizado' }] } },
        aristas: [{ desde: 'A', hacia: 'C', estilo: 'solido', etiqueta: null, dirigida: false }], comentarios: [] },
    ],
  }
}

export type ExplanationSpecialty = 'prog' | 'math'
export type ExplanationOrientation = 'auto' | 'horizontal' | 'vertical'

export type ExplanationPreferences = { specialty?: ExplanationSpecialty; orientation?: ExplanationOrientation }

export function explanationSpecialtyInstructions(specialty: ExplanationSpecialty = 'prog', orientation: ExplanationOrientation = 'auto') {
  return [
    'VISTA: usá exclusivamente pantilla1_grafos: un mapa con nodos, relaciones y comentarios anclados. No generes version 2, portadas ni párrafos fuera del mapa.',
    specialty === 'math'
      ? String.raw`ESPECIALIDAD MATH: enseñá matemáticas con una secuencia verificable: datos e incógnitas, regla y condiciones, sustitución, una transformación algebraica por paso, resultado y comprobación. Escribí TODAS las expresiones matemáticas en LaTeX delimitado por \(...\) o $$...$$ en etiquetas, datos, aristas y comentarios. Usá \frac, \begin{pmatrix}...\end{pmatrix}, subíndices y superíndices; nunca fórmulas ASCII como X_c, [a,b]^T o a/b sin delimitadores. Los valores largos van en datos.valor, con una expresión por campo. No omitas operaciones ni condiciones de validez; justificá cada flecha con la operación aplicada. En JSON escapá cada barra inversa como \\.`
      : 'ESPECIALIDAD PROG: explicá algoritmos, estructuras y procesos con estados concretos. Prepará el cambio, mostrá una operación por paso y verificá el resultado o invariante. Conservá IDs y el orden de los subárboles. No inventes alturas, datos ni resultados de ejecución. Las fórmulas de costos o invariantes usan LaTeX delimitado por \\(...\\).',
    orientation === 'vertical'
      ? 'ORIENTACIÓN VERTICAL: el flujo principal avanza de arriba hacia abajo: aumentá fila y conservá columna cuando no haya ramificaciones.'
      : orientation === 'horizontal'
        ? 'ORIENTACIÓN HORIZONTAL: el flujo principal avanza de izquierda a derecha: aumentá columna y conservá fila cuando no haya ramificaciones.'
        : 'ORIENTACIÓN AUTOMÁTICA: elegí arriba-abajo para jerarquías y izquierda-derecha para operaciones o procesos; conservá una dirección coherente.',
    'SECUENCIA: cada paso cambia una sola idea visible. Incluí uno o dos comentarios breves anclados que expliquen qué cambia y por qué; el mapa debe entenderse sin encabezados externos. Resaltá el nodo y la relación activos y atenuá los pasos futuros. Cerrá verificando el resultado con los datos originales.',
  ].join('\n\n')
}

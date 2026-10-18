import type { GraphPresentation } from '../../lib/pdf-explanation-graphs.ts'

// Labels identify fragments from the reference; they are not numeric BST keys.
const initial = { D: [1,5], A: [3,3], B: [5,1], C: [5,4], E: [3,8] }
const rotated = { A: [1,4], B: [3,1], D: [3,7], C: [5,5], E: [5,9] }
const before = ['D -> A', 'D -> E', 'A -> B', 'A -> C']
const after = ['A -> B', 'A -> D', 'D -> C', 'D -> E']
const specs = [
  ['¿Por qué importa la altura?', 'Una búsqueda recorre un camino desde la raíz. La forma del árbol determina cuántos niveles visita.', initial, before, 'D', 'azul', 'D es la raíz de este fragmento. B, C y E representan subárboles completos.'],
  ['La regla AVL', 'En cada nodo, las alturas de sus dos subárboles difieren a lo sumo en 1. Aquí no conocemos esas alturas.', initial, before, 'A', 'azul', 'Los triángulos ocultan contenido: no podemos deducir su altura contando solo este dibujo.'],
  ['Cuándo considerar una rotación derecha', 'Si D está cargado a la izquierda y su hijo A permite una rotación simple, esta transformación puede corregir ese caso.', initial, before, 'D', 'rojo', 'La rotación se hace alrededor de D. Sin las alturas no afirmamos que este árbol esté desbalanceado.'],
  ['Preparar el movimiento', 'A, el hijo izquierdo, va a subir. D va a bajar a su derecha. Antes de mover, ubicá el subárbol C.', initial, before, 'A', 'amarillo', 'A sube; D baja. C no se pierde: necesitará un nuevo padre.'],
  ['Rotar: A sube y D baja', 'Seguí las marcas de origen y las trayectorias. B acompaña a A; E conserva a D como padre.', rotated, after, 'A', 'verde', 'A es la nueva raíz del fragmento. D es ahora su hijo derecho.'],
  ['El detalle clave: C cambia de padre', 'C era el subárbol derecho de A. Pasa a ser el izquierdo de D: contiene valores entre los de A y D.', rotated, after, 'C', 'amarillo', 'Antes: A → C. Ahora: D → C. Todo el contenido de C se conserva.'],
  ['Comprobar el resultado', 'El recorrido en orden sigue siendo B, A, C, D, E. Rotar cambia la forma y conserva el orden de los elementos.', rotated, after, 'C', 'verde', 'B sigue con A; E sigue con D. No se agregó ni eliminó ningún subárbol.'],
  ['La inversa: rotación izquierda en A', 'D vuelve a subir; A baja a su izquierda. C regresa al lado derecho de A. Repetir permite ver el movimiento otra vez.', initial, before, 'D', 'azul', 'Volvemos a la misma estructura inicial. Las dos rotaciones son inversas.'],
] as const

export const avlTeachingFixture: GraphPresentation = {
  plantilla: 'pantilla1_grafos', titulo: 'ABB y AVL · entender las rotaciones',
  elementos_iniciales: ['D','A','B','C','E'].map(id => ({ id, etiqueta: id, tipo: ['B','C','E'].includes(id) ? 'subarbol' : 'nodo' })),
  diapositivas: specs.map(([titulo,objetivo,positions,edges,anchor,color,texto],i) => ({
    paso: i+1, titulo, objetivo,
    posiciones: Object.fromEntries(Object.entries(positions).map(([id,[fila,columna]]) => [id,{fila,columna,estado: id===anchor ? color==='rojo'?'alerta':color==='verde'?'exito':'destacado' : 'normal'}])),
    aristas: edges.map(edge => { const [desde,hacia] = edge.split(' -> '); return {desde,hacia,estilo: i===5 && hacia==='C'?'animado_amarillo':'solido'} }),
    comentarios: [{anclado_a:anchor,color,texto,posicion: anchor==='C'?'derecha':'arriba-derecha'}],
  })),
}

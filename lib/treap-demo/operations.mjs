// A bounded, independent model. Heap violations are data: insertion may create
// them temporarily, while malformed topology or BST ordering is always rejected.
export function createTreeModel(catalog) {
  if (!Array.isArray(catalog) || catalog.length > 64) throw new Error('El catálogo admite hasta 64 nodos.')
  const nodes = new Map(), keys = new Set()
  for (const node of catalog) {
    if (!node || typeof node.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(node.id) ||
        !Number.isFinite(node.key) || !Number.isFinite(node.priority)) throw new Error('Nodo inválido: se requiere ID, clave y prioridad numéricas finitas.')
    if (nodes.has(node.id) || keys.has(node.key)) throw new Error('El catálogo contiene identificadores o claves duplicados.')
    nodes.set(node.id, { ...node }); keys.add(node.key)
  }
  function inspect(tree) {
    if (!tree || !tree.children || typeof tree.children !== 'object' || Array.isArray(tree.children) ||
        Object.keys(tree.children).length > nodes.size) throw new Error('Estructura de árbol inválida.')
    const seen = new Set(), order = [], violations = []
    function visit(id, min, max) {
      if (id === null) return
      if (typeof id !== 'string' || !nodes.has(id) || !Object.hasOwn(tree.children, id) || seen.has(id)) throw new Error('Referencia inexistente, repetida o cíclica.')
      const node = nodes.get(id), children = tree.children[id]
      if (!Array.isArray(children) || children.length !== 2) throw new Error('Cada nodo necesita hijo izquierdo y derecho, o null.')
      if (node.key <= min || node.key >= max) throw new Error('El árbol no conserva el orden ABB.')
      seen.add(id)
      visit(children[0], min, node.key); order.push(node.key); visit(children[1], node.key, max)
      for (const child of children) if (child !== null && nodes.get(child).priority > node.priority) violations.push([id, child])
    }
    visit(tree.root, -Infinity, Infinity)
    if (seen.size !== Object.keys(tree.children).length) throw new Error('Hay nodos desconectados de la raíz.')
    return { order, violations }
  }
  function insert(tree, id) {
    inspect(tree)
    const node = nodes.get(id)
    if (!node) throw new Error('El nodo a insertar no existe en el catálogo.')
    if (Object.hasOwn(tree.children, id)) throw new Error('El nodo ya está insertado.')
    const result = structuredClone(tree)
    result.children[id] = [null, null]
    if (result.root === null) result.root = id
    else {
      let parent = result.root
      while (true) {
        const side = node.key < nodes.get(parent).key ? 0 : 1
        if (result.children[parent][side] === null) { result.children[parent][side] = id; break }
        parent = result.children[parent][side]
      }
    }
    inspect(result)
    return result
  }
  function rotate(tree, pivot, side) {
    inspect(tree)
    if (!Object.hasOwn(tree.children, pivot)) throw new Error('El pivote no pertenece al árbol.')
    const promoted = tree.children[pivot][side]
    if (promoted === null) throw new Error('La rotación requiere un hijo en esa dirección.')
    const result = structuredClone(tree), opposite = 1 - side
    result.children[pivot][side] = result.children[promoted][opposite]
    result.children[promoted][opposite] = pivot
    if (result.root === pivot) result.root = promoted
    else for (const [id, children] of Object.entries(tree.children)) {
      const position = children.indexOf(pivot)
      if (position !== -1) result.children[id][position] = promoted
    }
    inspect(result)
    return result
  }
  return { inspect, insert, rotateLeft: (tree, pivot) => rotate(tree, pivot, 1), rotateRight: (tree, pivot) => rotate(tree, pivot, 0) }
}

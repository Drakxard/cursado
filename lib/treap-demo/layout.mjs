// Inorder placement depends on topology, never on numeric keys or their gaps.
// All slides share one canvas so navigation cannot clip earlier/later states.
export function layoutTrees(trees, { nodeWidth = 112 } = {}) {
  if (!Number.isFinite(nodeWidth) || nodeWidth < 112) throw new Error('Invalid capsule width')
  const spacing = nodeWidth + 32
  if (!Array.isArray(trees) || !trees.length) throw new Error('At least one tree is required')
  const layouts = trees.map(tree => {
    if (!tree || !tree.children || typeof tree.children !== 'object') throw new Error('Invalid tree')
    const seen = new Set(), ordered = []
    function visit(id, depth) {
      if (id === null) return
      if (typeof id !== 'string' || seen.has(id) || !Object.hasOwn(tree.children, id)) throw new Error('Invalid or repeated tree reference')
      const children = tree.children[id]
      if (!Array.isArray(children) || children.length !== 2) throw new Error('Each node requires left and right children')
      seen.add(id)
      visit(children[0], depth + 1)
      ordered.push({ id, depth })
      visit(children[1], depth + 1)
    }
    visit(tree.root, 0)
    if (seen.size !== Object.keys(tree.children).length) throw new Error('Disconnected nodes')
    const width = Math.max(840, ordered.length * spacing + 80)
    const height = Math.max(500, 160 + Math.max(0, ...ordered.map(n => n.depth)) * 112)
    const offset = (width - Math.max(0, ordered.length - 1) * spacing) / 2
    return { width, height, positions: new Map(ordered.map((n, rank) => [n.id, { x: offset + rank * spacing, y: ordered.length === 1 ? 230 : 90 + n.depth * 112 }])) }
  })
  const width = Math.max(...layouts.map(l => l.width)), height = Math.max(...layouts.map(l => l.height))
  return { width, height, positions: layouts.map(l => new Map([...l.positions].map(([id, p]) => [id, { x: p.x + (width - l.width) / 2, y: p.y }]))) }
}

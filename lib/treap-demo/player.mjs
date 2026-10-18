import { select, timer, easeCubicInOut, interpolateNumber } from 'd3'
import { compileSequence } from './sequence.mjs'
import { layoutTrees } from './layout.mjs'
import { createTreeModel } from './operations.mjs'

function start() {
const { catalog, steps } = compileSequence(JSON.parse(document.getElementById('treap-lesson').textContent))
const svg = select('#scene'), nodes = svg.select('#nodes'), edges = svg.select('#edges')
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
let index = 0, animation, current = new Map()
// Measure actual glyphs at the authored font size; reserve equal halves for all
// capsules so interpolation and edge anchors keep a consistent geometry.
const ruler = svg.append('text').attr('class', 'value').style('font', '800 23px ui-monospace,monospace').style('visibility', 'hidden')
let halfWidth = 56
for (const node of catalog) for (const value of [node.key, node.priority]) {
  ruler.text(String(value)); halfWidth = Math.max(halfWidth, Math.ceil(ruler.node().getComputedTextLength() + 20))
}
ruler.remove()
const layout = layoutTrees(steps.map(step => step.tree), { nodeWidth: halfWidth * 2 })
const model = createTreeModel(catalog)
const conflicts = steps.map(step => new Set(model.inspect(step.tree).violations.map(([from, to]) => `${from}:${to}`)))
svg.attr('viewBox', `0 0 ${layout.width} ${layout.height}`)
  .style('min-width', `${layout.width}px`).style('min-height', `${layout.height}px`)
function draw(positions) {
  nodes.selectAll('g.node').attr('transform', n => `translate(${positions.get(n.id).x},${positions.get(n.id).y})`)
  edges.selectAll('path').attr('d', e => {
    const a = positions.get(e.from), b = positions.get(e.to)
    // Attach to the top and bottom of each capsule on the same animation frame.
    return `M${a.x},${a.y + 31} L${b.x},${b.y - 31}`
  })
  current = positions
}
function render(target, replay = false) {
  animation?.stop()
  const interrupted = document.body.dataset.animating === 'true'
  index = Math.max(0, Math.min(steps.length - 1, target))
  const step = steps[index], end = layout.positions[index]
  const start = replay && index > 0 ? layout.positions[index - 1] : current
  document.body.dataset.step = String(index + 1)
  document.body.dataset.animating = 'false'
  document.querySelector('#step-title').textContent = step.title
  document.querySelector('#counter').textContent = `${index + 1} / ${steps.length}`
  document.querySelector('#explanation').textContent = step.text
  document.querySelector('#badge').textContent = step.badge
  document.querySelector('#badge').dataset.tone = step.danger ? 'danger' : step.success ? 'success' : 'normal'
  document.querySelector('#prev').disabled = index === 0
  document.querySelector('#next').disabled = index === steps.length - 1
  document.querySelector('#replay').disabled = index === 0
  document.querySelectorAll('#steps button').forEach((button, i) => {
    if (index === i) button.setAttribute('aria-current', 'step')
    else button.removeAttribute('aria-current')
  })
  const links = Object.entries(step.tree.children).flatMap(([from, children]) => children.filter(Boolean).map(to => ({ from, to, id: `${from}:${to}` })))
  edges.selectAll('path').data(links, e => e.id).join('path')
    .attr('data-edge', e => e.id).attr('class', e => conflicts[index].has(e.id) ? 'conflict' : '')
  const groups = nodes.selectAll('g.node').data(catalog.filter(n => end.has(n.id)), n => n.id).join(enter => {
    const g = enter.append('g').attr('class', 'node').attr('data-node', n => n.id)
    g.append('rect').attr('x', -halfWidth).attr('y', -31).attr('width', halfWidth * 2).attr('height', 62).attr('rx', 25)
    g.append('path').attr('class', 'divider').attr('d', 'M0,-23 V23')
    for (const [x, label, field, cls] of [[-halfWidth / 2, 'CLAVE', 'key', 'key'], [halfWidth / 2, 'PRIO', 'priority', 'priority']]) {
      g.append('text').attr('class', `caption ${cls}`).attr('x', x).attr('y', -10).text(label)
      g.append('text').attr('class', `value ${cls}`).attr('x', x).attr('y', 16).text(n => n[field])
    }
    g.append('title').text(n => `Clave ${n.key}, prioridad ${n.priority}`)
    return g
  })
  groups.attr('data-tone', n => step.focus.includes(n.id) ? step.danger ? 'danger' : step.success ? 'success' : 'focus' : 'normal')
  const interpolate = new Map([...end].map(([id, p]) => {
    const a = start.get(id) ?? p
    return [id, { x: interpolateNumber(a.x, p.x), y: interpolateNumber(a.y, p.y) }]
  }))
  // A rapid navigation settles immediately to a complete, authoritative snapshot.
  if (!current.size || reduced.matches || interrupted) { draw(end); return }
  document.body.dataset.animating = 'true'
  draw(new Map([...interpolate].map(([id, p]) => [id, { x: p.x(0), y: p.y(0) }])))
  animation = timer(elapsed => {
    const progress = Math.min(1, elapsed / 850), t = easeCubicInOut(progress)
    draw(new Map([...interpolate].map(([id, p]) => [id, { x: p.x(t), y: p.y(t) }])))
    if (progress === 1) { animation.stop(); document.body.dataset.animating = 'false' }
  })
}
steps.forEach((step, i) => {
  const button = document.createElement('button')
  button.textContent = String(i + 1); button.setAttribute('aria-label', `Ir al paso ${i + 1}`)
  button.onclick = () => render(i); document.querySelector('#steps').append(button)
})
document.querySelector('#prev').onclick = () => render(index - 1)
document.querySelector('#next').onclick = () => render(index + 1)
document.querySelector('#replay').onclick = () => render(index, true)
addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input,textarea,select,[contenteditable]')) return
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault(); render(index + (event.key === 'ArrowRight' ? 1 : -1))
  }
})
reduced.addEventListener('change', () => render(index))
render(0)
}
try { start() } catch (error) {
  document.querySelector('#step-title').textContent = 'No se pudo abrir la explicación'
  document.querySelector('#explanation').textContent = error.message
  document.querySelector('#explanation').setAttribute('role', 'alert')
  document.querySelectorAll('button').forEach(button => { button.disabled = true })
}

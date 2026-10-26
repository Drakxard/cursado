'use client'
import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useLocalWorkspace } from '@/components/local-workspace-provider'
import { cooperationState, synchronizeCooperation } from '@/lib/client/cooperation'
import { readImportantTasks, type ImportantTask } from '@/lib/important-tasks'

export default function ShareImportantTasksDialog({ onClose }: { onClose: () => void }) {
  const { rootHandle } = useLocalWorkspace()
  const groups = cooperationState().groups.filter(group => group.accepted)
  const [groupId, setGroupId] = useState(''), [tasks, setTasks] = useState<ImportantTask[]>([]), [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false)
  useEffect(() => { if (rootHandle) readImportantTasks(rootHandle).then(setTasks).catch(error => setError(String(error))) }, [rootHandle])
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent className="max-h-[85dvh] overflow-auto">
    <DialogTitle>Compartir mis importantes</DialogTitle>
    <DialogDescription>Cada envío agrega otra fila. Los nuevos botones se comparten desde cualquier participante; quitar botones o filas solo afecta a tu lista.</DialogDescription>
    <label className="grid gap-2">Grupo<select aria-label="Grupo" className="rounded border bg-background p-2" value={groupId} disabled={busy} onChange={event => { setGroupId(event.target.value); setDone(false) }}><option value="">Seleccionar grupo</option>{groups.map(group => <option key={group.id} value={group.id}>{group.members.map(m => m.display_name).join(', ')}</option>)}</select></label>
    {!groups.length && <p>Aceptá o creá un grupo para compartir.</p>}
    {groupId && <fieldset disabled={busy} className="space-y-3"><legend className="mb-2">Filas a compartir</legend>{tasks.map(task => <label key={task.id} className="flex items-start gap-3 rounded border p-3"><input type="checkbox" checked={selected.includes(task.id)} onChange={event => { setDone(false); setSelected(previous => event.target.checked ? [...previous, task.id] : previous.filter(id => id !== task.id)) }} /><span>{task.text || 'Sin título'}<small className="block text-muted-foreground">{task.topics.join(' · ')}</small></span></label>)}{!tasks.length && <p>No hay filas en Importantes.</p>}</fieldset>}
    {error && <p role="alert" className="text-red-600">{error}</p>}{done && <p role="status">Filas compartidas. Los participantes las recibirán al sincronizar Estudio.</p>}
    <Button disabled={busy || !groupId || !selected.length || done} onClick={async () => { setBusy(true); setError(''); try { await (await import('@/lib/client/important-cooperation')).shareImportantTasks(groupId, selected); await synchronizeCooperation(); setDone(true) } catch (error) { setError(String(error)) } finally { setBusy(false) } }}>{busy ? 'Compartiendo…' : 'Compartir filas seleccionadas'}</Button>
  </DialogContent></Dialog>
}

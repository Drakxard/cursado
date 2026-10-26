import type { ImportantTask } from './important-tasks'

export type SharedImportantRow = Omit<ImportantTask, 'id' | 'cooperation' | 'topics' | 'topicBoardIds'> & {
  topics: { id: string; name: string }[]
  deliveries: { id: string; groupId: string }[]
}
export function validSharedImportantRow(value: unknown): value is SharedImportantRow {
  const row = value as SharedImportantRow | null
  return !!row && typeof row.text==='string' && typeof row.url==='string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(row.dueDate) &&
    Array.isArray(row.topics) && row.topics.every(topic=>topic && typeof topic.name==='string' && /^[a-zA-Z0-9-]{1,100}$/.test(topic.id)) &&
    new Set(row.topics.map(topic=>topic.id)).size===row.topics.length && Array.isArray(row.deliveries) &&
    row.deliveries.every(delivery=>delivery && /^[a-f0-9-]{36}$/.test(delivery.id) && /^[a-f0-9-]{36}$/.test(delivery.groupId))
}
/** Only additions travel. Seen IDs survive a local button or row deletion. */
export function appendSharedTopics(task: ImportantTask, row: SharedImportantRow, seen: string[]) {
  const additions = row.topics.filter(topic => !seen.includes(topic.id) && !task.topicBoardIds?.includes(topic.id))
  return { ...task, topics: [...task.topics, ...additions.map(t => t.name)], topicBoardIds: [...(task.topicBoardIds || []), ...additions.map(t => t.id)] }
}
export function unionSharedTopics(row: SharedImportantRow, tasks: ImportantTask[]): SharedImportantRow {
  const topics = [...row.topics]
  for (const task of tasks) task.topicBoardIds?.forEach((id, index) => {
    if (!topics.some(topic => topic.id === id)) topics.push({ id, name: task.topics[index] })
  })
  return { ...row, topics }
}

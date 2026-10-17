import { createHash } from 'node:crypto'
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3'
import { isLibraryPath } from '@/lib/workspace-library'
import { legacyLocalPath, isLegacyLibraryKey, type LegacyLibraryCatalog } from '@/lib/workspace-library-legacy'
import { SUBJECTS } from '@/lib/subjects'
import { WEEKDAY_NAMES, getWeekDates, formatDateKey } from '@/lib/subject-utils'

type Storage = { client: S3Client; bucket: string }
const slug = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '')
export async function discoverLegacyLibrary(s: Storage): Promise<LegacyLibraryCatalog> {
  const output: LegacyLibraryCatalog = { documents: [], files: [] }, known = new Set<string>()
  async function list(prefix: string) {
    const keys: string[] = []; let cursor: string | undefined
    do {
      const page = await s.client.send(new ListObjectsV2Command({ Bucket: s.bucket, Prefix: prefix, ContinuationToken: cursor }))
      for (const object of page.Contents || []) if (object.Key && !object.Key.endsWith('/')) keys.push(object.Key)
      if (keys.length > 50000) throw new Error('La biblioteca anterior supera el límite de archivos por recuperación.')
      cursor = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (cursor)
    return keys
  }
  async function register(key: string, kind = '') {
    if (!isLegacyLibraryKey(key) || known.has(key)) return
    const path = legacyLocalPath(key, kind); if (!path) return
    let head
    try { head = await s.client.send(new HeadObjectCommand({ Bucket: s.bucket, Key: key })) }
    catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404) return; throw error }
    known.add(key); output.files.push({ key, path, size: head.ContentLength || 0, mime: head.ContentType || 'application/octet-stream' })
  }
  async function convert(value: unknown, kind = ''): Promise<unknown> {
    if (Array.isArray(value)) { const result = []; for (const item of value) result.push(await convert(item, kind)); return result }
    if (!value || typeof value !== 'object') return value
    const record = value as Record<string, unknown>, result: Record<string, unknown> = {}
    kind = String(record.material_type || kind)
    for (const [field, item] of Object.entries(record)) {
      if (['drive_file_id', 'driveFileId', 'r2Key'].includes(field) && typeof item === 'string' && item.startsWith('r2/')) {
        await register(item, kind)
        const file = output.files.find(f => f.key === item)
        result[field] = file ? `workspace://${file.path}` : item
      } else result[field] = await convert(item, kind)
    }
    return result
  }
  // Never inspect provider capsules, pairings, devices, backups or shared boards.
  for (const key of await list('manifests/')) {
    const path = key === 'manifests/cronograma/current.json' ? 'manifests/cronograma.json' : key
    if (!isLibraryPath(path)) continue
    if (!key.endsWith('.json')) { await register(key); continue }
    const object = await s.client.send(new GetObjectCommand({ Bucket: s.bucket, Key: key }))
    if ((object.ContentLength || 0) > 4 * 1024 ** 2) throw new Error(`El manifiesto anterior ${key} es demasiado grande.`)
    const data = JSON.parse(await object.Body!.transformToString())
    output.documents.push({ path, data: await convert(data) as Record<string, unknown> })
  }
  // Older uploads sometimes have metadata but no material manifest.
  for (const key of await list('r2/')) {
    if (known.has(key) || !/\.pdf$/i.test(key) || !isLegacyLibraryKey(key)) continue
    const head = await s.client.send(new HeadObjectCommand({ Bucket: s.bucket, Key: key })), meta = head.Metadata || {}, parts = key.split('/')
    if (meta['replacement-temporary'] === 'true') continue
    const subjectId = meta['subject-id'] || SUBJECTS.find(subject => slug(subject.name) === parts[1])?.id
    const week = Number(meta['week-number'] || /^semana-(\d+)$/.exec(parts[2])?.[1])
    const day = Number(meta['weekday-index'] ?? WEEKDAY_NAMES.findIndex(name => slug(name) === parts[3]))
    if (!subjectId || !/^[a-zA-Z0-9_-]{1,100}$/.test(subjectId) || !Number.isInteger(week) || week < 1 || week > 100 || !Number.isInteger(day) || day < 0 || day > 6) continue
    const filename = meta['original-file-name'] || parts.at(-1)!.replace(/^\d+-/, '')
    const kind = ['theory', 'practice'].includes(meta['material-type']) ? meta['material-type'] : /guia|ejer|pract|resp/i.test(filename) ? 'practice' : 'theory'
    await register(key, kind)
    const file = output.files.find(f => f.key === key)!, path = `manifests/materials/${subjectId}/week-${week}.json`
    let doc = output.documents.find(d => d.path === path)
    if (!doc) { doc = { path, data: { version: 1, subjectId, weekNumber: week, materials: [] } }; output.documents.push(doc) }
    const createdAt = head.LastModified?.toISOString() || new Date().toISOString()
    const materialId = Number(meta['material-id'])
    if (!SUBJECTS.some(subject => subject.id === subjectId)) {
      let workspace = output.documents.find(d => d.path === 'manifests/workspace-state.json')
      if (!workspace) { workspace = { path: 'manifests/workspace-state.json', data: { customSubjects: {} } }; output.documents.push(workspace) }
      const custom = workspace.data.customSubjects as Record<string, unknown> || {}
      custom[subjectId] ||= { id: subjectId, storageKey: subjectId, name: meta['subject-name'] || parts[1], color: '#f59e0b', tabId: 'main', createdAt, targetWeekday: day }
      workspace.data.customSubjects = custom
    }
    ;(doc.data.materials as unknown[]).push({ id: Number.isSafeInteger(materialId) && materialId > 0 ? materialId : Number.parseInt(createHash('sha256').update(key).digest('hex').slice(0, 12), 16), subject_id: subjectId, subject_name: meta['subject-name'] || SUBJECTS.find(subject => subject.id === subjectId)?.name || parts[1], week_number: week, session_date: meta['session-date'] || formatDateKey(getWeekDates(week)[day]), weekday_index: day, material_type: kind, order_index: (doc.data.materials as unknown[]).length, file_name: filename, drive_file_id: `workspace://${file.path}`, drive_mime_type: head.ContentType || 'application/pdf', drive_web_view_link: '', is_checkup_done: false, created_at: createdAt, updated_at: createdAt })
  }
  return output
}

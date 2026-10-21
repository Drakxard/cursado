import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../public/pdfjs/web/viewer-custom.js', import.meta.url), 'utf8')
const sliceFunction = (name: string, next: string) => source.slice(source.indexOf(`  function ${name}(`), source.indexOf(`  function ${next}(`))

test('annotation monitoring serializes once per check and still schedules changed annotations', () => {
  let hashes = 0, scheduled = 0, dirty = false
  const context = {
    state: {app:{pdfDocument:{annotationStorage:{size:1,get serializable(){hashes++;return {hash:dirty?'changed':'saved'}}}}},lastSyncedAnnotationHash:'saved',lastObservedAnnotationHash:'saved',autosyncRetryCount:3},
    canSyncCurrentDocument: () => true,
    refreshSyncButtons: (unsynced: boolean) => { assert.equal(unsynced,dirty) },
    scheduleAutosync: () => { scheduled++ }, console,
  }
  const monitor = runInNewContext([
    sliceFunction('hasUnsyncedAnnotations','getAnnotationContentHash'),
    sliceFunction('getAnnotationContentHash','clearAutosyncTimer'),
    sliceFunction('monitorAnnotationChanges','getCurrentFileUrl'),
    'monitorAnnotationChanges',
  ].join('\n'),context)
  monitor()
  assert.equal(hashes,1)
  assert.equal(scheduled,0)
  dirty=true
  monitor()
  assert.equal(hashes,2)
  assert.equal(scheduled,1)
  assert.equal(context.state.autosyncRetryCount,0)
  monitor()
  assert.equal(hashes,3)
  assert.equal(scheduled,1)
})

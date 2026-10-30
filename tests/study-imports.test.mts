import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['pizarra-sync/packages/client-web/src/study-imports.ts'], bundle: true, write: false, platform: 'browser', format: 'esm', plugins: [{ name: 'file-import-fixture', setup(builder) {
  builder.onResolve({ filter: /^\.\/uploads$|^pdfjs-dist/ }, args => ({ path: args.path, namespace: 'fixture' }))
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.includes('?url') ? 'export default "worker.js"' : args.path === './uploads' ? `
    export async function uploadImage(file) {
      if(file.name==='failed.png') throw new Error('Subida rechazada');
      return {key:file.name,width:100,height:80};
    }
  ` : `
    export const GlobalWorkerOptions={};
    export function getDocument({data}) {
      const invalid=new TextDecoder().decode(data)==='invalid';
      return {destroy:async()=>{},promise:invalid?Promise.reject(new Error('PDF dañado')):Promise.resolve({numPages:1,getPage:async()=>({getViewport:()=>({width:100,height:80}),render:()=>({promise:Promise.resolve()}),cleanup(){}})})};
    }
  ` }))
} }] })
const { importStudyFiles } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)

test('mixed imports keep processing PDFs after unsupported, damaged and failed files', async t => {
  const previous = globalThis.document
  globalThis.document = { createElement: () => ({ getContext: () => ({}), toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['page'], { type: 'image/png' })) }) } as any
  t.after(() => { globalThis.document = previous })
  const statuses: string[] = [], objects: any[] = []
  const files = [
    new File(['valid'], 'before.pdf'),
    new File(['other'], 'unsupported.txt'),
    new File(['invalid'], 'broken.pdf'),
    new File(['image'], 'failed.png', { type: 'image/png' }),
    new File(['valid'], 'after.pdf'),
    new File(['a,b\n1,2'], 'last.csv'),
  ]
  await assert.rejects(async () => {
    for await (const object of importStudyFiles(files, { x: 20, y: 40 }, (status: string) => statuses.push(status))) objects.push(object)
  }, (error: Error) => {
    assert.match(error.message, /unsupported\.txt/)
    assert.match(error.message, /broken\.pdf.*PDF dañado/)
    assert.match(error.message, /failed\.png.*Subida rechazada/)
    return true
  })
  assert.deepEqual(objects.filter(object => object.type === 'image').map(object => object.src), ['before.pdf-1.png', 'after.pdf-1.png'])
  assert.equal(objects.length, 3)
  assert.ok(objects[1].y > objects[0].y, 'later successful imports keep their own position')
  assert.ok(statuses.some(status => status.includes('last.csv')))
  const next: any[] = []
  for await (const object of importStudyFiles([new File(['a'], 'retry.csv')], { x: 0, y: 0 }, () => {})) next.push(object)
  assert.equal(next.length, 1, 'a failed batch does not poison subsequent imports')
})

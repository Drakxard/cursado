import assert from 'node:assert/strict'
import test from 'node:test'
import { boardPdfReference, parseBoardPdfDrag, parseImportantDrag, parseBoardLinkDrag } from '../lib/board-library-contract.ts'

const reference = { materialId:41,subjectId:'calculo3',fileName:'Guía.PDF',workspaceFileId:'workspace://teoria/calculo3/guia.pdf' }
test('board PDF references keep identifiers and file paths without file bytes or temporary URLs',()=>{
  assert.deepEqual(boardPdfReference({...reference,blob:'do not copy',url:'blob:temporary'}),reference)
  assert.deepEqual(parseBoardPdfDrag(JSON.stringify(reference)),reference)
  assert.deepEqual(boardPdfReference({...reference,workspaceFileId:null}),{...reference,workspaceFileId:null})
})
test('board PDF drag rejects malformed references, non-PDFs and unsafe paths',()=>{
  for(const value of [null,{}, {...reference,materialId:NaN},{...reference,materialId:-1},{...reference,fileName:'a.png'},
    {...reference,workspaceFileId:'https://evil.test/a.pdf'},{...reference,workspaceFileId:'workspace://teoria/../private.pdf'},
    {...reference,workspaceFileId:'workspace://teoria//a.pdf'}, {...reference,workspaceFileId:'workspace://teoria/a\\b.pdf'}]) assert.equal(boardPdfReference(value),null)
  assert.equal(parseBoardPdfDrag('bad json'),null)
})

test('linked elements reject incomplete drag payloads and carry stable identifiers',()=>{
  assert.deepEqual(parseImportantDrag('{"taskId":"exam"}'),{taskId:'exam'})
  assert.deepEqual(parseBoardLinkDrag('{"boardId":"local:one","name":"Álgebra"}'),{boardId:'local:one',name:'Álgebra'})
  for(const value of ['null','{}','{"taskId":""}','bad','{"taskId":3}'])assert.equal(parseImportantDrag(value),null)
  for(const value of ['null','{}','{"boardId":""}','bad','{"boardId":3,"name":"x"}'])assert.equal(parseBoardLinkDrag(value),null)
})

test('unopened topic drags retain initialization context and reject malformed context', () => {
  const link = {boardId:'local:important-study-new',name:'Theory',topic:{cooperationSubjectId:'subject',cooperationWeekNumber:2,pdfReferences:[reference]}}
  assert.deepEqual(parseBoardLinkDrag(JSON.stringify(link)),link)
  for (const topic of [null, {cooperationSubjectId:3}, {cooperationWeekNumber:-1}, {pdfReferences:[{materialId:1}]}]) assert.equal(parseBoardLinkDrag(JSON.stringify({...link,topic})),null)
  assert.equal(parseBoardLinkDrag(JSON.stringify({...link,boardId:'local:important-../escape'})),null)
  assert.equal(parseBoardLinkDrag(JSON.stringify({...link,boardId:'server-board'})),null)
})

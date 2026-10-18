import assert from 'node:assert/strict'
import test from 'node:test'
import { boardPdfReference, parseBoardPdfDrag } from '../lib/board-library-contract.ts'

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

import assert from 'node:assert/strict'
import test from 'node:test'
import { readStudyLocation, studyLocationPath, studySlug, isStudyPath } from '../lib/study-location.ts'

test('study URLs restore a subject and board together, including cooperative week zero', () => {
  const params = new URLSearchParams({ materia: 'custom-cálculo', fecha: '2026-10-30', seccion: 'theory', alcance: 'semana', pestana: 'tab-a', pizarra: 'container-123', nombrePizarra: 'Cálculo · Diagramas', materiaPizarra: 'coop-a', semanaPizarra: '0', importantes: '1' })
  assert.deepEqual(readStudyLocation(params.toString()), {
    subject: { subjectId: 'custom-cálculo', date: '2026-10-30', section: 'theory', weekly: true },
    board: { boardId: 'container-123', name: 'Cálculo · Diagramas', cooperationSubjectId: 'coop-a', cooperationWeekNumber: 0 }, tab: 'tab-a', important: true,
  })
})

test('malformed URL values cannot become board paths or invalid dates', () => {
  const result = readStudyLocation('?materia=algebra&fecha=2026-02-30&seccion=invalid&pizarra=../../otro&semanaPizarra=-1')
  assert.equal(result.board, null)
  assert.deepEqual(result.subject, { subjectId: 'algebra', date: null, section: 'exercises', weekly: false })
  assert.equal(readStudyLocation('?materia=' + 'a'.repeat(201)).subject, null)
  assert.equal(readStudyLocation('?pizarra=valid&semanaPizarra=NaN').board?.cooperationWeekNumber, undefined)
})

test('short paths use subject, week and visible board title without identifiers', () => {
  const state = readStudyLocation('?pizarra=internal-uuid&nombrePizarra=Base+de+Datos+%C2%B7+temas&semanaPizarra=4')
  assert.equal(studyLocationPath(state), '/pizarra/base-de-datos/4/temas')
  assert.equal(studyLocationPath({ ...state, board: { ...state.board!, cooperationWeekNumber: 5 } }), '/pizarra/base-de-datos/5/temas')
  assert.equal(studyLocationPath(readStudyLocation('?importantes=1')), '/imp')
  assert.equal(studyLocationPath(readStudyLocation('')), '/estudio')
  assert.equal(studySlug('  Álgebra / matrices & vectores  '), 'algebra-matrices-vectores')
  assert.equal(isStudyPath('/pizarra/base-de-datos/4/temas'), true)
  assert.equal(isStudyPath('/pizarra/index.html'), false)
  assert.equal(isStudyPath('/pizarra/'), false)
})

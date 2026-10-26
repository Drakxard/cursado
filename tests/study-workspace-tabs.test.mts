import assert from 'node:assert/strict'
import test from 'node:test'
import { hasMainStudySubjects, removeStudyTab } from '../lib/study-workspace-tabs.ts'

test('Inicio exists only when it owns subjects, including legacy populated workspaces', () => {
  assert.equal(hasMainStudySubjects({}),false)
  assert.equal(hasMainStudySubjects({a:{tabId:'other'}}),false)
  assert.equal(hasMainStudySubjects({a:{tabId:'main'}}),true)
})
test('removing a tab preserves subjects and references without deleting sphere data', () => {
  const tabs={one:{id:'one',name:'One',color:'#000000',createdAt:'',subjectIds:['a','reference']},two:{id:'two',name:'Two',color:'#000000',createdAt:'',subjectIds:['a']}}
  const subjects={a:{id:'a',tabId:'one'},reference:{id:'reference',tabId:'two'}}
  const next=removeStudyTab(tabs,subjects,'one',()=> 'saved-subjects')
  assert.equal(next.workspaceTabs.one,undefined)
  assert.deepEqual(next.workspaceTabs.two.subjectIds,['a'])
  assert.equal(next.customSubjects.a.tabId,'saved-subjects')
  assert.equal(next.workspaceTabs['saved-subjects'].name,'Mis materias')
  assert.equal(next.customSubjects.reference.tabId,'two')
  assert.equal(next.isMainWorkspaceTabVisible,false)
  const withoutMain=removeStudyTab(next.workspaceTabs,{...next.customSubjects,a:{id:'a',tabId:'main'}},'main',()=> 'replacement')
  assert.equal(withoutMain.isMainWorkspaceTabVisible,false)
  assert.equal(withoutMain.customSubjects.a.tabId,'replacement')
  assert.deepEqual(withoutMain.workspaceTabs.replacement.subjectIds,['a'])
})

test('removing the last empty tab leaves no generated default tab', () => {
  const result = removeStudyTab({one:{id:'one',name:'One',color:'#000',createdAt:'',subjectIds:[]}}, {}, 'one')
  assert.deepEqual(result.workspaceTabs, {})
  assert.equal(result.isMainWorkspaceTabVisible, false)
  assert.equal(result.activeWorkspaceTabId, 'cooperative')
})

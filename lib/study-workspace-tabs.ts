export type StudyTab = { id: string; name: string; color: string; createdAt: string; subjectIds: string[]; orderIndex?: number }
export function hasMainStudySubjects(subjects: Record<string, { tabId: string }>) {
  return Object.values(subjects).some(subject => subject.tabId === 'main')
}
/** Removing a navigation tab never removes subject files or other references. */
export function removeStudyTab<S extends { id: string; tabId: string }>(tabs: Record<string, StudyTab>, subjects: Record<string, S>, id: string, createId = () => `tab-${crypto.randomUUID()}`) {
  const owned = Object.values(subjects).filter(subject => subject.tabId === id).map(subject => subject.id)
  const destination = id === 'main' && owned.length ? createId() : 'main'
  const workspaceTabs = { ...tabs }; delete workspaceTabs[id]
  if (destination !== 'main') workspaceTabs[destination] = { id: destination, name:'Mis materias',color:'#111827',createdAt:new Date().toISOString(),subjectIds:owned }
  const customSubjects = Object.fromEntries(Object.entries(subjects).map(([key, subject]) => [key, owned.includes(subject.id) ? { ...subject, tabId:destination } : subject])) as Record<string,S>
  return { workspaceTabs,customSubjects,isMainWorkspaceTabVisible:hasMainStudySubjects(customSubjects),activeWorkspaceTabId:owned.length?destination:Object.keys(workspaceTabs)[0] || (hasMainStudySubjects(customSubjects)?'main':'cooperative') }
}

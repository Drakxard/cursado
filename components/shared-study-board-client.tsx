'use client'
import { useLocalWorkspace } from './local-workspace-provider'
import { StudyTopicBoardOverlay } from './study-topic-board-overlay'

export function SharedStudyBoardClient({roomId,name}:{roomId:string;name:string}) {
  const {rootHandle,isReady} = useLocalWorkspace()
  if(!isReady || !rootHandle) return null
  return <StudyTopicBoardOverlay boardId={`shared-${roomId}`} name={name} rootHandle={rootHandle} sharedRoomId={roomId} onClose={()=>location.assign('/estudio')} />
}

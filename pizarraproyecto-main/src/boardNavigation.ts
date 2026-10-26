import {flushNavigationSaves} from './homeNavigation'
import {getActiveBoardId,getLibrary,selectBoard,loadBoard} from './biblioteca'
import {topicNavigationContext,restoreTopicNavigationContext,suspendTopicNavigation,initializeTopicWorkspace,notifyTopicContext} from './topicWorkspace'
import {workspaceRoot} from './canvas/countdowns'
import {readImportantTasks} from '../../lib/important-tasks'
type View={center:{x:number;y:number};zoom:number}
type Entry={id:string;view:View;topic:ReturnType<typeof topicNavigationContext>}
const history:Entry[]=[]
let pendingView:View|null=null,busy=false
export const hasBoardReturn=()=>history.length>0
export const isBoardNavigating=()=>busy
export function consumeBoardView(){const view=pendingView;pendingView=null;return view}
export async function navigateBoardLink(id:string,view:View,back=false){
  if(busy)return
  busy=true
  window.dispatchEvent(new CustomEvent('board-link:busy',{detail:true}))
  const origin={id:getActiveBoardId(),view,topic:topicNavigationContext()}
  try{
    await flushNavigationSaves()
    origin.topic=topicNavigationContext()
    const entry=back?history[history.length-1]:null
    // Older theory/practice drags stored the file ID instead of its device ID.
    const requested=entry?.id??id
    const target=requested.startsWith('study-')?`local:important-${requested}`:requested
    if(!target)throw new Error('Pizarra inexistente.')
    if(target===origin.id&&!back)return
    const root=await workspaceRoot()
    if(target.startsWith('local:important-')){
      if(!root)throw new Error('Conectá la carpeta de la pizarra.')
      const taskId=target.slice('local:important-'.length),tasks=await readImportantTasks(root)
      if(!/^[a-zA-Z0-9-]{1,100}$/.test(taskId))throw new Error('Acceso a pizarra inválido.')
      const task=tasks.find(task=>task.topicBoardIds?.includes(taskId))
      let snapshot:{name?:string;boardId?:string;cooperationSubjectId?:string;cooperationWeekNumber?:number}|undefined
      try {
        const directory=await(await root.getDirectoryHandle('progreso')).getDirectoryHandle('pizarras')
        snapshot=JSON.parse(await(await(await directory.getFileHandle(`${taskId}.json`)).getFile()).text())
        if(snapshot?.boardId!==taskId)throw new Error('El archivo de la pizarra de destino no es válido.')
      }catch(error){if((error as Error).name!=='NotFoundError')throw error}
      if(!task&&!snapshot)throw new Error('La pizarra de destino fue eliminada o no está descargada en esta carpeta.')
      if(entry?.topic.workspace)restoreTopicNavigationContext(entry.topic)
      else await initializeTopicWorkspace({boardId:taskId,name:snapshot?.name??task!.topics[task!.topicBoardIds!.indexOf(taskId)],rootHandle:root,
        cooperationSubjectId:snapshot?.cooperationSubjectId??(task?.cooperation?`important-share:${task.cooperation.shareId}`:undefined),cooperationWeekNumber:snapshot?.cooperationWeekNumber},true)
    }else{
      const library=await getLibrary()
      if(!library.boards.some(board=>board.id===target))throw new Error('La pizarra de destino fue eliminada.')
      suspendTopicNavigation()
    }
    selectBoard(target,!new URLSearchParams(location.search).has('topicBoard'))
    await loadBoard()
    if(getActiveBoardId()!==target)throw new Error('La pizarra de destino ya no está disponible.')
    if(back){history.pop();pendingView=entry!.view}else{history.push(origin);pendingView=null}
    notifyTopicContext()
    window.dispatchEvent(new Event('board-link:navigated'))
  }catch(error){
    restoreTopicNavigationContext(origin.topic)
    if(getActiveBoardId()!==origin.id){
      selectBoard(origin.id,!new URLSearchParams(location.search).has('topicBoard'))
      await loadBoard()
    }
    throw error
  }
  finally{busy=false;window.dispatchEvent(new CustomEvent('board-link:busy',{detail:false}))}
}

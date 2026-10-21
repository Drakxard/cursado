import {flushNavigationSaves} from './homeNavigation'
import {getActiveBoardId,getLibrary,selectBoard,loadBoard} from './biblioteca'
import {topicNavigationContext,restoreTopicNavigationContext,suspendTopicNavigation,initializeTopicWorkspace} from './topicWorkspace'
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
    const target=entry?.id??id
    if(!target)throw new Error('Pizarra inexistente.')
    if(target===origin.id&&!back)return
    const root=await workspaceRoot()
    if(target.startsWith('local:important-')){
      if(!root)throw new Error('Conectá la carpeta de la pizarra.')
      const taskId=target.slice('local:important-'.length),tasks=await readImportantTasks(root)
      const task=tasks.find(task=>task.topicBoardIds?.includes(taskId))
      if(!task)throw new Error('La pizarra de destino fue eliminada.')
      if(entry?.topic.workspace)restoreTopicNavigationContext(entry.topic)
      else await initializeTopicWorkspace({boardId:taskId,name:task.topics[task.topicBoardIds!.indexOf(taskId)],rootHandle:root},true)
    }else{
      const library=await getLibrary()
      if(!library.boards.some(board=>board.id===target))throw new Error('La pizarra de destino fue eliminada.')
      suspendTopicNavigation()
    }
    selectBoard(target,!new URLSearchParams(location.search).has('topicBoard'))
    await loadBoard()
    if(getActiveBoardId()!==target)throw new Error('La pizarra de destino ya no está disponible.')
    if(back){history.pop();pendingView=entry!.view}else{history.push(origin);pendingView=null}
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

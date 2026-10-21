import {isNativeReadOnly,nativeWorkspaceRoot} from '../../../lib/native-workspace'
import {readImportantTasks, type ImportantTask} from '../../../lib/important-tasks'
import {getTopicWorkspaceRoot} from '../topicWorkspace'
export const countdownTasks = new Map<string,ImportantTask>()
export let countdownReady=false
export async function workspaceRoot():Promise<FileSystemDirectoryHandle|null>{
  if(isNativeReadOnly())return nativeWorkspaceRoot()
  const topic=getTopicWorkspaceRoot();if(topic)return topic
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('local-workspace',1)
    request.onupgradeneeded=()=>{request.transaction?.abort();resolve(null)}
    request.onerror=()=>{if(request.error?.name==='AbortError')resolve(null);else reject(request.error)}
    request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('workspace')){db.close();resolve(null);return}
      const read=db.transaction('workspace').objectStore('workspace').get('root-handle')
      read.onsuccess=()=>{db.close();resolve(read.result?.handle??null)};read.onerror=()=>{db.close();reject(read.error)}
    }
  })
}
export async function refreshCountdowns(){
  const root=await workspaceRoot()
  if(!root){countdownReady=false;countdownTasks.clear();return}
  const tasks=await readImportantTasks(root)
  countdownTasks.clear();for(const task of tasks)countdownTasks.set(task.id,task)
  countdownReady=true
}

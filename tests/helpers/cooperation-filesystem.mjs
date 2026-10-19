export function memoryWorkspace() {
  const directories=new Set(['']), files=new Map()
  const missing=()=>new DOMException('Missing','NotFoundError')
  function dir(path='') {
    const prefix=path?path+'/':''
    return {
      name:path.split('/').at(-1)||'workspace',kind:'directory',
      async queryPermission(){return 'granted'},
      async getDirectoryHandle(name,{create=false}={}) {
        const target=prefix+name
        if(!directories.has(target)){if(!create)throw missing();directories.add(target)}
        return dir(target)
      },
      async getFileHandle(name,{create=false}={}) {
        const target=prefix+name
        if(!files.has(target)){if(!create)throw missing();files.set(target,new Blob())}
        return {name,kind:'file',async getFile(){const blob=files.get(target);if(!blob)throw missing();return new File([blob],name,{type:blob.type,lastModified:1})},async createWritable(){let pending;return {async write(value){pending=value instanceof Blob?value:new Blob([value])},async close(){if(pending!==undefined)files.set(target,pending)},async abort(){}}}}
      },
      async removeEntry(name){if(!files.delete(prefix+name))throw missing()},
      async *entries(){for(const path of directories)if(path.startsWith(prefix)&&path!==path.slice(0,prefix.length)&&!path.slice(prefix.length).includes('/'))yield [path.slice(prefix.length),dir(path)];for(const path of files.keys())if(path.startsWith(prefix)&&!path.slice(prefix.length).includes('/'))yield [path.slice(prefix.length),{kind:'file'}]},
    }
  }
  const root=dir()
  const put=async(path,value)=>{
    const parts=path.split('/');let directory=root
    for(const part of parts.slice(0,-1))directory=await directory.getDirectoryHandle(part,{create:true})
    const writer=await(await directory.getFileHandle(parts.at(-1),{create:true})).createWritable()
    await writer.write(typeof value==='object'&&!(value instanceof Blob)?JSON.stringify(value):value);await writer.close()
  }
  return {root,files,put,json:async path=>JSON.parse(await files.get(path).text())}
}

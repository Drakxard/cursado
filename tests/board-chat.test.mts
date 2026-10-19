import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { boardChatInput } from '../lib/board-chat.ts'
import { isServicesServerRequest } from '../lib/services-config.ts'

test('board chat accepts bounded images and conversation, rejects malformed input', () => {
  assert.deepEqual(boardChatInput({question:'  Explicá esto  ', image:'data:image/png;base64,YQ==',context:[{role:'user',content:'Antes'}]}), {
    question:'Explicá esto',image:'data:image/png;base64,YQ==',context:[{role:'user',content:'Antes'}],
  })
  for(const input of [null,{}, {question:' '},{question:'x',image:'https://external.test/x.png'}, {question:'x',image:'data:image/svg+xml;base64,YQ=='}, {question:'x',context:[{role:'system',content:'x'}]}, {question:'x',context:new Array(22).fill({role:'user',content:'x'})}]) assert.throws(()=>boardChatInput(input))
  assert.equal(isServicesServerRequest('/api/board-chat'),true)
})

test('board chat route requires auth and Azure, passes image/context and cancellation without fallback',async () => {
  const state={auth:false,configured:false,calls:[] as any[],fail:false}
  const bundle=await build({entryPoints:['app/api/board-chat/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'fixtures',setup(builder){
    const mocks:Record<string,string>={
      'ai':`exports.generateText=async options=>{state.calls.push(options);if(state.fail)throw Error('secret');return {text:'Respuesta'}}`,
      '@/lib/authz':`exports.requireAuthSession=async()=>({response:state.auth?null:new Response('',{status:401})})`,
      '@/lib/inscreen-user-config':`exports.withOptionalServicesConfig=(req,handler)=>handler()`,
      '@/lib/server/pdf-explanation-azure':`exports.azureExplanationConfig=()=>state.configured?{deployment:'gpt-5-mini'}:null;exports.azureExplanationModel=()=> 'azure-only'`,
    }
    builder.onResolve({filter:/^(ai|@\/lib\/)/},args=>args.path in mocks?{path:args.path,namespace:'fixture'}:undefined)
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}))
  }}]})
  const module={exports:{} as {POST:(request:Request)=>Promise<Response>}}
  new Function('module','exports','state',bundle.outputFiles[0].text)(module,module.exports,state)
  const request=(body:unknown)=>new Request('https://board.test/api/board-chat',{method:'POST',body:JSON.stringify(body)})
  assert.equal((await module.exports.POST(request({question:'x'}))).status,401)
  state.auth=true
  assert.equal((await module.exports.POST(request({question:'x'}))).status,428)
  assert.equal(state.calls.length,0)
  state.configured=true
  assert.equal((await module.exports.POST(request({question:''}))).status,400)
  const req=request({question:'Duda',image:'data:image/png;base64,YQ==',context:[{role:'assistant',content:'Anterior'}]})
  const result=await module.exports.POST(req)
  assert.deepEqual(await result.json(),{answer:'Respuesta'})
  assert.equal(state.calls[0].model,'azure-only')
  assert.equal(state.calls[0].abortSignal,req.signal)
  assert.equal(state.calls[0].messages[1].content[1].image,'data:image/png;base64,YQ==')
  state.fail=true
  const failure=await module.exports.POST(request({question:'x'}))
  assert.equal(failure.status,502)
  assert.ok(!JSON.stringify(await failure.json()).includes('secret'))
})

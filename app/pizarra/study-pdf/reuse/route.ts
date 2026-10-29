export async function POST(request: Request) {
  if(request.headers.get('Origin') !== new URL(request.url).origin) return Response.json({error:'Origen no permitido.'},{status:403})
  const text = await request.text()
  if(text.length > 4096) return new Response(null,{status:413})
  let data: {roomId?:string;hash?:string;sphereId?:string}
  try { data = JSON.parse(text) } catch { return new Response(null,{status:422}) }
  if(!/^study-[a-f0-9-]{36}$/.test(data.roomId || '') || !/^[a-f0-9]{64}$/.test(data.hash || '') || !/^[a-f0-9-]{36}$/.test(data.sphereId || '')) return new Response(null,{status:422})
  const response = await fetch(`https://pizarra-komuboard.dariorafael2005.workers.dev/study-pdf/${data.roomId}/${data.hash}/reuse`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://cursado.vercel.app',Cookie:request.headers.get('Cookie') || ''},body:JSON.stringify({sphereId:data.sphereId})})
  return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}})
}

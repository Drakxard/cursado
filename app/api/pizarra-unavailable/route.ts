export function GET() {
  return Response.json({ detail: 'El servidor de las pizarras compartidas no está configurado. Podés abrir las privadas y copias de este dispositivo.' }, { status: 503 })
}
export const POST = GET
export const PUT = GET
export const PATCH = GET
export const DELETE = GET

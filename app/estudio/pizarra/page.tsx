import { SharedStudyBoardClient } from '@/components/shared-study-board-client'

export default async function SharedStudyBoardPage({searchParams}:{searchParams:Promise<{room?:string;name?:string}>}) {
  const {room,name} = await searchParams
  if(!/^study-[a-f0-9-]{36}$/.test(room || '')) return <p>El enlace de la pizarra no es válido.</p>
  return <SharedStudyBoardClient roomId={room!} name={name?.slice(0,500) || 'Pizarra compartida'} />
}

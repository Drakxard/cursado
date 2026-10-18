import { getRequestAuthSession } from '@/lib/authz'
import { BoardLibraryClient } from '@/components/board-library-client'
export const dynamic = 'force-dynamic'

export default async function BoardLibraryPage() {
  const session = await getRequestAuthSession()
  return session ? <BoardLibraryClient authSession={session} /> : null
}

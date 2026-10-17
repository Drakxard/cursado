import { handleLibraryRequest } from '@/lib/server/workspace-library'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
type Context = { params: Promise<{ action: string[] }> }
export async function GET(request: Request, context: Context) { return handleLibraryRequest(request, (await context.params).action.join('/')) }
export async function POST(request: Request, context: Context) { return handleLibraryRequest(request, (await context.params).action.join('/')) }

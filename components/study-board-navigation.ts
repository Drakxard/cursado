'use client'

import { createContext } from 'react'
import type { BoardLinkReference } from '@/lib/board-library-contract'

// Libraries embedded in a board delegate navigation to their owning session.
export const StudyBoardNavigationContext = createContext<((reference: BoardLinkReference) => void) | null>(null)

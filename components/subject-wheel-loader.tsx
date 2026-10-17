"use client"

import dynamic from "next/dynamic"
import { StudyImportantTasks } from "@/components/study-important-tasks"

import type { AuthSession } from "@/lib/authz"

type SubjectWheelSearchParams = {
  view?: string
  synthesisMode?: string
  synthesisWeek?: string
  synthesisSubject?: string
  returnToken?: string
}

const DynamicSubjectWheel = dynamic(
  () => import("@/components/subject-wheel").then((module) => module.SubjectWheel),
  {
    ssr: false,
  }
)

export function SubjectWheelLoader({
  authSession,
  initialSearchParams,
}: {
  authSession: AuthSession
  initialSearchParams?: SubjectWheelSearchParams
}) {
  return <StudyImportantTasks><DynamicSubjectWheel authSession={authSession} initialSearchParams={initialSearchParams} /></StudyImportantTasks>
}

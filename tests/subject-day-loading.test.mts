import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

// Exercise the component's real loader with independently delayed local reads.
const source = readFileSync(new URL("../components/subject-wheel.tsx", import.meta.url), "utf8")
const start = source.indexOf("const loadSubjectDayData = useCallback(")
const end = source.indexOf("\n  useEffect(", start)
const javascript = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function setup() {
  const pending = new Map<string, (response: Response) => void>()
  const state = { materials: [] as { id: number }[], entries: [] as { id: number }[], materialLoading: false, entryLoading: false, resolved: false }
  const request = { current: 0 }
  const dependencies = {
    useCallback: (value: unknown) => value,
    isDialogOpen: true, currentSubject: { id: "algebra" }, dialogSelectedWeekNumber: 1,
    isWeeklyExercisesScope: true, subjectDialogDateKey: "2026-03-02", subjectDayDataRequestIdRef: request,
    LOCAL_REQUEST_TIMEOUT_MS: 15_000,
    fetch: (url: string) => new Promise<Response>(resolve => pending.set(url.includes("entries") ? "entries" : url.includes("pinned") ? "pinned" : "week", resolve)),
    withTimeout: (promise: Promise<unknown>) => promise,
    parseJsonResponse: (response: Response) => response.json(),
    getErrorMessage: (_payload: unknown, fallback: string) => fallback,
    setEntriesError: () => {},
    setIsEntriesLoading: (value: boolean) => { state.entryLoading = value },
    setIsMaterialsLoading: (value: boolean) => { state.materialLoading = value },
    setHasResolvedSubjectDayData: (value: boolean) => { state.resolved = value },
    setEntries: (value: typeof state.entries) => { state.entries = value },
    setMaterials: (value: typeof state.materials) => { state.materials = value },
    sortSubjectDayEntries: (value: unknown) => value,
    mergeSubjectDayMaterials: (...groups: unknown[][]) => groups.flat(),
  }
  const load = new Function(...Object.keys(dependencies), `${javascript}\nreturn loadSubjectDayData`)(...Object.values(dependencies)) as () => Promise<void>
  async function finish(key: string, value: unknown) {
    pending.get(key)!(Response.json(value))
    await new Promise(resolve => setImmediate(resolve))
  }
  return { load, finish, state, request }
}

test("shows weekly PDFs before delayed entries and merges pinned PDFs when ready", async () => {
  const { load, finish, state } = setup()
  const loading = load()
  await finish("week", [{ id: 1 }])
  assert.deepEqual(state.materials, [{ id: 1 }])
  assert.equal(state.materialLoading, false)
  assert.equal(state.resolved, true)
  assert.equal(state.entryLoading, true)
  await finish("pinned", [{ id: 2 }])
  assert.deepEqual(state.materials, [{ id: 1 }, { id: 2 }])
  await finish("entries", [{ id: 3 }])
  await loading
  assert.deepEqual(state.entries, [{ id: 3 }])
})

test("responses from a previous week cannot overwrite the current view", async () => {
  const { load, finish, state, request } = setup()
  const loading = load()
  request.current++
  await finish("week", [{ id: 1 }])
  await finish("pinned", [{ id: 2 }])
  await finish("entries", [{ id: 3 }])
  await loading
  assert.deepEqual(state.materials, [])
  assert.deepEqual(state.entries, [])
  assert.equal(state.resolved, false)
})

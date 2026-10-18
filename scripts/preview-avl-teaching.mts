import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { structuredLessonHtml } from '../lib/server/pdf-explanation-renderer.ts'
import { avlTeachingFixture } from '../tests/helpers/explanation-avl-teaching-fixture.mts'
const destination = resolve(process.argv[2] || 'avl-explicado.html')
await writeFile(destination, structuredLessonHtml(avlTeachingFixture))
console.log(destination)

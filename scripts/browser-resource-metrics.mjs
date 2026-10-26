import { execFileSync } from 'node:child_process'

export function instrumentResources() {
  window.resourceStats = { decodedBytes: 0, peakDecodedBytes: 0, decodes: 0, originalDecodes: 0, originalSizes: [], longTasks: [], frames: [], lastFrame: 0 }
  const original = window.createImageBitmap.bind(window)
  window.createImageBitmap = async (...args) => {
    const bitmap = await original(...args), stats = window.resourceStats
    stats.decodes++
    if (args[0] instanceof Blob && stats.originalSizes.includes(args[0].size)) stats.originalDecodes++
    const bytes = bitmap.width * bitmap.height * 4
    stats.decodedBytes += bytes; stats.peakDecodedBytes = Math.max(stats.peakDecodedBytes, stats.decodedBytes)
    const close = bitmap.close.bind(bitmap); let closed = false
    bitmap.close = () => { if (!closed) { closed = true; stats.decodedBytes -= bytes }; close() }
    return bitmap
  }
  new PerformanceObserver(list => { for (const entry of list.getEntries()) window.resourceStats.longTasks.push(entry.duration) }).observe({ type: 'longtask', buffered: true })
  window.startFrameSample = () => {
    const stats = window.resourceStats; stats.frames = []; stats.lastFrame = 0; stats.sampling = true
    const tick = time => {
      if (!stats.sampling) return
      if (stats.lastFrame) stats.frames.push(time - stats.lastFrame)
      stats.lastFrame = time; requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
}

export async function resourceSampler(browser, page) {
  const session = await page.context().newCDPSession(page), root = await browser.newBrowserCDPSession()
  await session.send('Performance.enable')
  return async label => {
    await session.send('HeapProfiler.collectGarbage')
    const metrics = (await session.send('Performance.getMetrics')).metrics
    const processes = (await root.send('SystemInfo.getProcessInfo')).processInfo
    const workingSetBytes = process.platform === 'win32' ? Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${processes.map(p => p.id).join(',')} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`], { encoding: 'utf8' }).trim()) : null
    return { label, workingSetBytes, jsHeapBytes: metrics.find(m => m.name === 'JSHeapUsedSize')?.value,
      dom: await session.send('Memory.getDOMCounters'), ...await page.evaluate(() => {
        const stats = window.resourceStats, frames = [...stats.frames].sort((a, b) => a - b)
        return { decodedBytes: stats.decodedBytes, peakDecodedBytes: stats.peakDecodedBytes, decodes: stats.decodes, originalDecodes: stats.originalDecodes,
          longTasks: stats.longTasks.length, longestTaskMs: Math.max(0, ...stats.longTasks),
          frameP95Ms: frames[Math.floor(frames.length * .95)] ?? null,
          canvases: document.querySelectorAll('canvas').length,
          canvasBytes: [...document.querySelectorAll('canvas')].reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0),
          iframes: document.querySelectorAll('iframe').length }
      }), workers: (await root.send('Target.getTargets')).targetInfos.filter(t => t.type.includes('worker')).length }
  }
}

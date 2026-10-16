// Serial, bounded, newest-first job queue for model summaries. One in flight
// (a 0.5B model on a phone CPU), duplicates by key ignored, oldest dropped when full.
export interface SummaryQueue {
  enqueue: (key: string, job: () => Promise<void>) => void
  size: () => number
}

export function createQueue(max = 40): SummaryQueue {
  const waiting: { key: string; job: () => Promise<void> }[] = []
  const seen = new Set<string>()
  let running = false

  const pump = async () => {
    if (running) return
    running = true
    for (let next = waiting.pop(); next; next = waiting.pop()) {
      await next.job().catch(() => undefined)
      seen.delete(next.key)
    }
    running = false
  }

  return {
    enqueue(key, job) {
      if (seen.has(key)) return
      seen.add(key)
      waiting.push({ key, job })
      while (waiting.length > max) seen.delete(waiting.shift()!.key)
      void pump()
    },
    size: () => waiting.length,
  }
}

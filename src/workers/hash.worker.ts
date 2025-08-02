import type { HashJob, HashWorkerIncomingMessage, HashWorkerOutgoingMessage } from '@/types'
import { createMD5, createSHA1, createSHA256, type IHasher } from 'hash-wasm'

let id = -1
let job: HashJob | null = null

async function run() {
  if (null === job) {
    return
  }
  const hasherPromises: Promise<IHasher>[] = []
  for (const algorithm of job.algorithms) {
    switch (algorithm) {
      case 'MD5':
        hasherPromises.push(createMD5())
        break
      case 'SHA-1':
        hasherPromises.push(createSHA1())
        break
      case 'SHA-256':
        hasherPromises.push(createSHA256())
        break
    }
  }
  const hashers = await Promise.all(hasherPromises)
  const stream = (await job.fileHandle.getFile()).stream()
  const reader = stream.getReader()
  let byteCount = 0
  let lastSend = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    byteCount += value.length
    if (byteCount > lastSend + 10 * 1024 * 1024) {
      const message: HashWorkerOutgoingMessage = {
        type: 'hashing',
        workerId: id,
        jobId: job.id,
        processedByteCount: byteCount,
      }
      self.postMessage(message)
      lastSend = byteCount
    }
    for (const hasher of hashers) {
      hasher.update(value)
    }
  }
  reader.releaseLock()
  const results = hashers.map(hasher => hasher.digest('hex'))
  const message: HashWorkerOutgoingMessage = {
    type: 'hashed',
    workerId: id,
    jobId: job.id,
    algorithms: job.algorithms,
    results,
  }
  self.postMessage(message)
}

self.addEventListener('message', (event: MessageEvent<HashWorkerIncomingMessage>) => {
  const message = event.data
  switch (message.command) {
    case 'init':
      id = message.id
      break
    case 'hash':
      job = message.job
      run().catch(e => {
        if (null === job) {
          return
        }
        if (e instanceof Error) {
          const message: HashWorkerOutgoingMessage = {
            type: 'error',
            workerId: id,
            jobId: job.id,
            errorMessage: e.message,
          }
          self.postMessage(message)
        } else {
          console.error(`Unexpected error in hash worker: `, e)
        }
      })
      break
    case 'terminate':
      self.close()
      break
  }
})

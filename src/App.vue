<script setup lang="ts">
import { db, getFileEntityByPath } from '@/db'
import { computed, onMounted, ref, watch } from 'vue'
import ProgressBar from '@/components/ProgressBar/index.vue'
import HashWorker from '@/workers/hash.worker?worker'
import type { HashAlgorithm, HashJob, HashWorkerIncomingMessage, HashWorkerOutgoingMessage } from '@/types'

const totalCount = ref(0) // 文件总数
const totalSize = ref(0) // 文件总大小
const hashAlgorithms = ref<HashAlgorithm[]>(['SHA-256']) // 用户选择的哈希算法
const workerCount = ref<number>(1) // 工作线程数
let workers: Worker[] = [] // 实际的工作线程
let workerJobs: (HashJob | null)[] = [] // 工作线程的任务
let pendingJobs: HashJob[] = [] // 待处理的任务队列
let succeededJobs: HashJob[] = [] // 处理成功的任务
let failedJobs: HashJob[] = [] // 处理失败的任务
let errorMessages: string[] = [] // 错误信息列表
let jobCount = 0 // 任务总数
const fileLoading = ref(false) // 是否正在加载文件
const totalProcessedSize = ref(0) // 已处理文件的总大小
const skippedCount = ref(0)
const skippedSize = ref(0)
const processing = ref(false)

/**
 * 分配任务给空闲的工作线程。
 * 如果没有空闲的工作线程或没有待处理任务，则不进行任何操作。
 */
function dispatchJobs() {
  if (workers.length <= 0) {
    // 如果没有工作线程，直接返回
    return
  }
  if (pendingJobs.length <= 0) {
    // 如果没有待处理的任务，直接返回
    return
  }

  for (let i = 0; i < workers.length; i++) {
    if (null !== workerJobs[i]) {
      // 如果当前工作线程有任务在处理，跳过
      continue
    }
    // 找到了一个空闲的工作线程
    const job = pendingJobs.shift() // 从队列中取出一个任务
    if (undefined === job) {
      // 这里主要是为了类型判断，因为pendingJobs的长度此时是大于0的，所以job不可能是undefined
      continue
    }
    // 分配任务给工作线程
    job.status = 'processing'
    workerJobs[i] = job
    const message: HashWorkerIncomingMessage = {
      command: 'hash',
      job,
    }
    workers[i].postMessage(message)
  }
}

/**
 * 处理工作线程的消息
 */
async function handleWorkerMessage(event: MessageEvent<HashWorkerOutgoingMessage>) {
  const message = event.data
  const job = workerJobs[message.workerId - 1] // 获取当前工作线程的任务
  if (null === job) {
    throw new Error(`Worker ${message.workerId} has no job assigned.`)
  }
  switch (message.type) {
    case 'hashing':
      totalProcessedSize.value += message.processedByteCount - job.processedByteCount // 更新已处理的总字节数
      job.processedByteCount = message.processedByteCount // 更新已处理的字节数
      break
    case 'hashed':
      job.status = 'succeeded'
      job.results = message.results
      totalProcessedSize.value += job.file.size - job.processedByteCount // 更新已处理的总字节数
      job.processedByteCount = job.file.size
      await updateFileHashes(job.file.id, job.algorithms, message.results) // 更新数据库中的哈希值
      workerJobs[message.workerId - 1] = null // 清空工作线程的任务
      succeededJobs.push(job) // 添加到成功队列
      dispatchJobs() // 分配新的任务
      break
    case 'error':
      job.status = 'failed'
      totalProcessedSize.value += job.file.size - job.processedByteCount // 更新已处理的总字节数
      job.processedByteCount = job.file.size
      workerJobs[message.workerId - 1] = null // 清空工作线程的任务
      failedJobs.push(job) // 添加到失败队列
      errorMessages.push(message.errorMessage) // 添加错误信息
      dispatchJobs() // 分配新的任务
      break
  }
  disposeWorkers()
}

/**
 * 清理工作线程
 */
function disposeWorkers() {
  if (workers.length <= 0) {
    // 如果没有工作线程，不必清理，直接返回
    return
  }
  if (fileLoading.value) {
    return
  }
  if (pendingJobs.length > 0) {
    // 如果还有待处理的任务，不清理工作线程
    return
  }
  for (const job of workerJobs) {
    if (null !== job) {
      // 如果有工作线程正在处理任务，不清理工作线程
      return
    }
  }
  for (let i = 0; i < workers.length; i++) {
    const worker = workers[i]
    const message: HashWorkerIncomingMessage = {
      command: 'terminate',
    }
    worker.postMessage(message)
    worker.removeEventListener('message', handleWorkerMessage) // 移除事件监听器
  }
  workers = [] // 清空工作线程数组
  workerJobs = [] // 清空工作线程任务数组
  processing.value = false // 设置处理状态为false
}

/**
 * 深度优先遍历目录结构
 * @param dirPath 父目录路径数组
 * @param dirHandle 当前目录的句柄
 */
async function dfs(dirPath: string[], dirHandle: FileSystemDirectoryHandle) {
  for await (const handle of dirHandle.values()) {
    if ('file' === handle.kind) {
      const fileHandle = handle as FileSystemFileHandle
      const file = await fileHandle.getFile()
      const filePath = [...dirPath, file.name].join('/')
      await db.transaction('rw', db.files, async () => {
        // 先检查文件是否已存在
        if (null !== (await getFileEntityByPath(filePath))) {
          return
        }
        // 如果不存在，则添加到数据库
        await db.files.add({
          name: file.name,
          path: filePath,
          size: file.size,
          lastModified: file.lastModified,
          md5: null,
          sha1: null,
          sha256: null,
        })
      })
      const fileEntity = await getFileEntityByPath(filePath)
      if (null === fileEntity) {
        throw new Error(`File ${filePath} not found.`)
      }
      totalCount.value++
      totalSize.value += fileEntity.size
      const algorithms = hashAlgorithms.value.filter(algorithm => {
        switch (algorithm) {
          case 'MD5':
            if (null === fileEntity.md5) {
              return true
            }
            break
          case 'SHA-1':
            if (null === fileEntity.sha1) {
              return true
            }
            break
          case 'SHA-256':
            if (null === fileEntity.sha256) {
              return true
            }
            break
        }
        return false
      })
      if (algorithms.length <= 0) {
        // 如果所有算法都已计算过，跳过这个文件
        skippedCount.value++
        skippedSize.value += fileEntity.size
        continue
      }
      const job: HashJob = {
        id: ++jobCount,
        file: fileEntity,
        fileHandle,
        status: 'pending',
        algorithms: JSON.parse(JSON.stringify(hashAlgorithms.value)),
        processedByteCount: 0,
        results: null,
      }
      pendingJobs.push(job) // 添加到待处理队列
      dispatchJobs() // 分配任务
    } else if ('directory' === handle.kind) {
      // 递归处理子目录
      await dfs([...dirPath, handle.name], handle as FileSystemDirectoryHandle)
    } else {
      // impossible
    }
  }
}

/**
 * 更新数据库中的哈希值
 * @param id 文件ID
 * @param algorithm 哈希算法
 * @param value 哈希值
 */
async function updateFileHash(id: number, algorithm: HashAlgorithm, value: string) {
  switch (algorithm) {
    case 'MD5':
      await db.files.update(id, { md5: value })
      break
    case 'SHA-1':
      await db.files.update(id, { sha1: value })
      break
    case 'SHA-256':
      await db.files.update(id, { sha256: value })
      break
    default:
      throw new Error(`Unsupported hash algorithm: ${algorithm}`)
  }
}

/**
 * 更新文件的多种哈希值
 * @param id 文件ID
 * @param algorithms 哈希算法列表
 * @param values 哈希值列表（与哈希算法对应）
 */
async function updateFileHashes(id: number, algorithms: HashAlgorithm[], values: string[]) {
  if (algorithms.length !== values.length) {
    throw new Error('Algorithms and values length mismatch')
  }
  for (let i = 0; i < algorithms.length; i++) {
    await updateFileHash(id, algorithms[i], values[i])
  }
}

/**
 * 选择文件夹并开始哈希
 */
async function selectFolder() {
  try {
    totalProcessedSize.value = 0
    totalCount.value = 0
    totalSize.value = 0
    pendingJobs = []
    succeededJobs = []
    failedJobs = []
    errorMessages = []
    jobCount = 0

    const dirHandle = await window.showDirectoryPicker()
    // 先准备工作线程
    workers = []
    workerJobs = []
    for (let i = 0; i < workerCount.value; i++) {
      workers.push(new HashWorker())
      workerJobs.push(null)
      const message: HashWorkerIncomingMessage = {
        command: 'init',
        id: i + 1, // 传递给他分配的ID，方便他发消息过来时识别他是哪个工作线程
      }
      workers[i].postMessage(message)
      workers[i].addEventListener('message', handleWorkerMessage)
    }
    processing.value = true
    fileLoading.value = true
    await dfs([], dirHandle)
    fileLoading.value = false
    disposeWorkers()
  } catch (e) {
    console.error(e)
  }
}

async function clear() {
  await db.files.clear()
  alert('缓存已清空')
}

onMounted(() => {
  let item = localStorage.getItem('hashAlgorithms')
  if (null !== item) {
    hashAlgorithms.value = JSON.parse(item)
  }
  item = localStorage.getItem('workerCount')
  if (null !== item) {
    workerCount.value = JSON.parse(item)
  }
})

watch(hashAlgorithms, newValue => localStorage.setItem('hashAlgorithms', JSON.stringify(newValue)))
watch(workerCount, newValue => localStorage.setItem('workerCount', JSON.stringify(newValue)))
</script>

<template>
  <main>
    <label>
      <input type="checkbox" v-model="hashAlgorithms" value="SHA-256" :disabled="processing" />
      SHA-256
    </label>
    <label>
      <input type="checkbox" v-model="hashAlgorithms" value="SHA-1" :disabled="processing" />
      SHA-1
    </label>
    <label>
      <input type="checkbox" v-model="hashAlgorithms" value="MD5" :disabled="processing" />
      MD5
    </label>
    <label>
      读取线程数：
      <select v-model="workerCount" :disabled="processing">
        <option v-for="count of [1, 2, 4, 8]" :key="count" :value="count">
          {{ count }}
        </option>
      </select>
      <span v-if="1 === workerCount"> 单线程，适合HDD </span>
      <span v-else> 多线程，适合SSD </span>
    </label>
    <button @click="selectFolder" :disabled="processing">选择文件夹</button>
    <button @click="clear" :disabled="processing">清除缓存</button>
    <div>
      <p>总进度：</p>
      <ProgressBar :current="totalProcessedSize + skippedSize" :total="totalSize" />
      <div v-if="processing">
        <template v-for="i of workers.length">
          <p>工作线程{{ i }}：{{ workerJobs[i - 1]?.file.path }}</p>
          <ProgressBar
            :current="workerJobs[i - 1]?.processedByteCount || 0"
            :total="workerJobs[i - 1]?.file.size || 0"
          />
        </template>
      </div>
    </div>
  </main>
</template>

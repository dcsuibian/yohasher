interface FileEntity {
  id: number
  name: string
  path: string
  size: number
  lastModified: number
  md5: string | null
  sha1: string | null
  sha256: string | null
}

type HashAlgorithm = 'MD5' | 'SHA-1' | 'SHA-256'

interface HashJob {
  id: number // 任务的唯一标识符
  file: FileEntity
  fileHandle: FileSystemFileHandle // 文件句柄，用于读取文件内容
  status: 'pending' | 'processing' | 'succeeded' | 'failed'
  algorithms: HashAlgorithm[] // 要处理的哈希算法列表
  processedByteCount: number
  results: string[] | null // 哈希结果列表，按算法顺序存储
}

// 工作线程收到的消息
type HashWorkerIncomingMessage =
  | {
      command: 'init' // 初始化工作线程
      id: number // 工作线程的唯一标识符
    }
  | {
      command: 'hash' // 处理哈希任务
      job: HashJob // 要处理的哈希任务
    }
  | {
      command: 'terminate' // 终止工作线程
    }

// 工作线程发出的消息
type HashWorkerOutgoingMessage =
  | {
      type: 'hashing' // 正在哈希中，更新进度
      workerId: number // 工作线程的唯一标识符
      jobId: number // 任务的唯一标识符
      processedByteCount: number // 已处理的字节数
    }
  | {
      type: 'hashed' // 哈希完成
      workerId: number // 工作线程的唯一标识符
      jobId: number // 任务的唯一标识符
      algorithms: HashAlgorithm[] // 哈希算法
      results: string[] // 哈希值
    }
  | {
      type: 'error' // 错误信息
      workerId: number // 工作线程的唯一标识符
      jobId: number // 任务的唯一标识符
      errorMessage: string // 错误信息
    }

export type { FileEntity, HashAlgorithm, HashJob, HashWorkerIncomingMessage, HashWorkerOutgoingMessage }

import Dexie, { type EntityTable } from 'dexie'
import type { FileEntity } from '@/types'

const db = new Dexie('YoHasher') as Dexie & {
  files: EntityTable<FileEntity, 'id'>
}
db.version(1).stores({
  files: '++id, name, &path, size, createTime, modifyTime, md5, sha1, sha256',
})

async function getFileEntityByPath(path: string): Promise<FileEntity | null> {
  const fileEntity = await db.files.where('path').equals(path).first()
  if (undefined === fileEntity) {
    return null
  }
  return fileEntity
}

export { db }
export { getFileEntityByPath }

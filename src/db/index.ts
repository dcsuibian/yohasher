import Dexie, { type EntityTable } from 'dexie'

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

export type { FileEntity }
export { db }
export { getFileEntityByPath }

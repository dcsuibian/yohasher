<script setup lang="ts">
import { db, getFileEntityByPath } from '@/db'
import { onMounted, ref, watch } from 'vue'
import ProgressBar from '@/components/ProgressBar/index.vue'

const totalCount = ref(0)
const totalSize = ref(0)
const hashAlgorithms = ref<string[]>(['SHA-256'])

async function dfs(parent: string[], dirHandle: FileSystemDirectoryHandle) {
  for await (const handle of dirHandle.values()) {
    if ('file' === handle.kind) {
      const fileHandle = handle as FileSystemFileHandle
      const file = await fileHandle.getFile()
      const filePath = [...parent, file.name].join('/')
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
    } else if ('directory' === handle.kind) {
      // 递归处理子目录
      await dfs([...parent, handle.name], handle as FileSystemDirectoryHandle)
    } else {
      // impossible
    }
  }
}

async function selectFolder() {
  try {
    totalCount.value = 0
    totalSize.value = 0
    const dirHandle = await window.showDirectoryPicker()
    await dfs([], dirHandle)
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
})

watch(hashAlgorithms, newValue => localStorage.setItem('hashAlgorithms', JSON.stringify(newValue)))
</script>

<template>
  <main>
    <label>
      <input type="checkbox" v-model="hashAlgorithms" value="SHA-256" />
      SHA-256
    </label>
    <label>
      <input type="checkbox" v-model="hashAlgorithms" value="SHA-1" />
      SHA-1
    </label>
    <label>
      <input type="checkbox" v-model="hashAlgorithms" value="MD5" />
      MD5
    </label>
    <button @click="selectFolder">选择文件夹</button>
    <button @click="clear">清除缓存</button>
    <ProgressBar :current="totalCount" :total="2401" />
  </main>
</template>

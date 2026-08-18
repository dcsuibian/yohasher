# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

YoHasher 是一个纯前端的文件夹哈希工具（灵感来自 HashMyFiles），所有计算都在浏览器本地完成，没有任何后端。依赖两个关键浏览器 API：File System Access API（`showDirectoryPicker`）和 Web Worker，因此只能在支持这些 API 的浏览器（Chromium 系）中运行，且必须通过 HTTPS 或 localhost 访问。

## 常用命令

```bash
npm run dev          # 启动开发服务器，端口 43671，host: true（局域网可访问）
npm run build        # 并行执行 type-check + build-only
npm run type-check   # vue-tsc --build，唯一的静态检查手段
npm run format       # prettier --write src/
npm run preview      # 预览构建产物
```

项目没有测试框架、没有 ESLint。改动后的验证手段是 `npm run type-check`，加上手动在浏览器里选文件夹跑一遍。

Node 版本由 `.node-version` 固定为 v22.18.0（fnm 管理）。

## 部署

多阶段 Dockerfile：node 构建（`npm ci` + `npm run build-only`，不跑 type-check）→ nginx:alpine 托管 `dist`，监听 80。没有 CI/CD，本地构建后推镜像：

```bash
docker build -t ghcr.io/dcsuibian/yohasher:latest .
docker push ghcr.io/dcsuibian/yohasher:latest
```

注意：

- `xlsx` 依赖来自 `https://cdn.sheetjs.com/...tgz`（不在 npm registry），构建机需要能访问该域名。
- File System Access API 只在安全上下文可用，服务器必须通过 HTTPS 暴露（由外层反代负责），否则「选择文件夹」按钮直接不可用。
- 应用是纯静态的，没有后端接口，nginx 不需要任何反代配置。

## 架构

核心是「主线程调度 + Worker 池执行」的生产者-消费者模型，全部集中在 `src/App.vue`（约 350 行的单文件应用，没有路由、没有状态管理库）。

**数据流：**

1. `selectFolder()` 先按用户选的 `workerCount` 创建 Worker 池，每个 Worker 收到 `init` 消息并被分配一个从 1 开始的 `workerId`；然后调用 `showDirectoryPicker()` 并进入 `dfs()`。
2. `dfs()` 深度优先遍历目录。每遇到一个文件：写入/查询 IndexedDB 得到 `FileEntity` → 过滤出「尚未计算过的算法」→ 若全部算过则计入 skipped 直接跳过（这就是**断点续哈**）→ 否则构造 `HashJob` 推入 `pendingJobs` 并立即 `dispatchJobs()`。
   注意：遍历和哈希是**并发**的，边扫边算，不等扫描完成。
3. `dispatchJobs()` 扫描 `workerJobs` 数组找 `null`（空闲）槽位，把任务 `postMessage` 给对应 Worker。
4. `hash.worker.ts` 用 `fileHandle.getFile().stream()` 流式读取，同一份数据喂给多个 hash-wasm hasher（一次 IO 算多种哈希）；每累积 10MB 回传一次 `hashing` 进度消息。
5. 主线程 `handleWorkerMessage()` 根据 `workerId` 定位任务槽，更新进度/写回哈希到 IndexedDB/清空槽位/再次 `dispatchJobs()`。
6. `disposeWorkers()` 在每次消息处理后被调用，只有当「文件扫描已结束 + 队列为空 + 所有槽位空闲」三个条件同时满足时才真正终止 Worker 并把 `processing` 置回 false。

**关键约定：**

- `workerJobs[i]` 与 `workers[i]` 严格一一对应；Worker 回传的 `workerId` 是 1-based，索引时必须 `-1`。
- 任务队列（`pendingJobs` / `succeededJobs` / `failedJobs` / `workers` / `workerJobs`）是普通变量而非 `ref`，刻意不做响应式以避免大量文件时的开销；模板中通过 `processing`、`totalProcessedSize` 等 ref 的变更来触发重渲染。
- `HashJob` 会被 `postMessage` 结构化克隆传给 Worker，其中的 `fileHandle` 是可克隆的；Worker 里重新 `getFile()` 读取内容。

**持久化：**

- `src/db/index.ts`：Dexie 封装的 IndexedDB，库名 `YoHasher`，单表 `files`，`path` 是唯一索引（`&path`）——去重和续哈都靠它。三种哈希各占一列（`md5`/`sha1`/`sha256`），未计算为 `null`。
  注意 schema 字符串里的 `createTime, modifyTime` 是历史遗留，实际实体字段是 `lastModified`；改 schema 需要提升 `db.version()`。
- `localStorage`：仅保存 `hashAlgorithms` 和 `workerCount` 两项用户偏好，通过 `watch` 自动写回。

**类型定义**全部集中在 `src/types/index.ts`，Worker 双向消息协议用可辨识联合（`command` / `type` 字段）定义，改协议时主线程和 Worker 两侧都要同步。

## 编码风格

- Prettier：无分号、单引号、printWidth 120、箭头函数单参数不加括号。
- 条件判断用 Yoda 风格（`null === job`、`0 === total`），与现有代码保持一致。
- 组件放在 `src/components/<PascalCase 名>/index.vue`，用 `defineOptions({ name: '...' })` 显式命名。
- 路径别名 `@/` 指向 `src/`（vite.config.ts 与 tsconfig.app.json 两处都已配置）。
- 代码注释用中文。

# YoHasher

YoHasher是一个基于最新Web技术的文件夹哈希工具。

受HashMyFiles的启发。

## 特点

* 一切计算皆在用户端浏览器本地进行
* 支持MD5/SHA-1/SHA-256
* 支持多线程并行读取并哈希（适合SSD）
* 支持文件夹断点续哈
* 支持JSON和Excel格式导出
* 支持实时进度显示
* 快

## 浏览器要求

* 支持[File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
* 支持[Web Worker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)

## 第三方

本项目使用以下第三方框架或库：

* [Vue.js](https://vuejs.org/)
* [Vite](https://vite.dev/)
* [hash-wasm](https://github.com/Daninet/hash-wasm)
* [Dexie.js](https://dexie.org/)
* [SheetJS](https://git.sheetjs.com/sheetjs/sheetjs)


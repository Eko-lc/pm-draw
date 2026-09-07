# 来源与重构范围

- **proto-gen**，Copyright (c) 2026 xieluoli，MIT，原许可保留在 `LICENSE`。本项目以其 Skill 架构、TOC / 原型 / PRD 一一对应结构、资产注入机制为基础；`assets/prd-highlight.js` 派生自其同名文件。高保真主题、固定 macOS 外壳、外部字体改为低保真和离线输出。
- **web-access**，作者一泽 Eze（eze-is），原 README 声明 MIT。`scripts/browser-discovery.mjs` 来自其同名文件；新增的浏览器适配器复用其浏览器发现规则与 HTTP Proxy 协议。来源副本未包含独立 LICENSE，故保留作者及来源声明；不引入原 Skill 的通用研究、发布和账号操作范围。
- **create-prd**，用户提供的 `/Users/eko/Downloads/create-prd-SKILL.md` 原文收录于 `references/create-prd-source.md`，作为历史八章模板的来源记录；当前默认使用精简功能 PRD。
- **Mermaid 11.17.2**，Copyright (c) 2014–2022 Knut Sveidqvist，MIT。`assets/vendor/mermaid-11.17.2.min.js` 为 [官方 npm 发布包](https://registry.npmjs.org/mermaid/-/mermaid-11.17.2.tgz) 的 dist/mermaid.min.js，未修改；保留包内第三方许可注释，完整 Mermaid 许可在 `assets/vendor/mermaid-LICENSE.txt`，build 内嵌时附带许可。下载包 SHA-512（base64）：`V6K3C8EBdEsPFZXSKMJe6ppQOENxuHARr9GvHX4hh47lAbhMRD9qf4oEK7LoaRQxULMa80/qt5gHO73aCleBBg==`。仅含图页面内嵌运行时，打开页面无需联网。升级时替换官方 bundle 与许可、更新 render 中版本路径，并检查图示渲染与离线兼容。

上游目录：`/Users/eko/Downloads/proto-gen`、`/Users/eko/Downloads/web-access`。运行本项目无需保留这些目录。

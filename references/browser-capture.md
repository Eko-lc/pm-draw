# 真实页面与截图

仅在用户确认当前计划后执行本节中的浏览器操作。`plan` 完全离线；`open`、`inspect`、`act`、`capture`、live 目标的 `import-shot` 和 `build` 都校验同一份计划确认。清单有改动时重新展示并确认。静态手动截图模式不启动浏览器。用户只确认部分页面时，approve 用 --screens 传入对应 id（逗号分隔），未确认页面的接入与截图会被拒绝。

## 接入方式

优先使用会话已提供的浏览器工具实际完成流程。已有 web-access 服务时可传 `--proxy http://127.0.0.1:3456`；兼容其 `/new`（POST body 为 URL）、`/eval`、`/screenshot` HTTP API。pm-draw 不在未确认时启动或探测 web-access，也不要求全局安装。

没有 web-access 时，内置 CDP 适配器复用其 `browser-discovery.mjs`，支持 Chrome / Edge 的 DevToolsActivePort。用 `--browser chrome` 或 `--browser edge` 指定浏览器；尊重已有 `config.env` 的 `WEB_ACCESS_BROWSER`。需要用户开启远程调试时说明实际缺失条件，不尝试改用户配置。也支持用户明确提供的 `--cdp http://127.0.0.1:9222` 或本机 `ws://...` 调试地址。控制端点限制本机回环；产品地址可以是确认的 HTTP(S) 地址。

## 操作示例

```bash
# 收到用户对计划的确认并执行 approve 后：
node <SKILL>/scripts/pm-draw.mjs open flow.json --screen list-empty --browser chrome
# 输出 targetId。后续命令复用同一个标签，保留真实登录态与流程上下文。
node <SKILL>/scripts/pm-draw.mjs inspect flow.json --screen list-empty --target TARGET --browser chrome
node <SKILL>/scripts/pm-draw.mjs act flow.json --screen list-empty --target TARGET --action click --selector 'button[data-action="add"]' --browser chrome
# 状态切换后使用新状态的 screen id；填写动作只对已观察控件执行。
node <SKILL>/scripts/pm-draw.mjs act flow.json --screen create-form --target TARGET --action fill --selector 'input[name="title"]' --value '示例资料' --browser chrome
node <SKILL>/scripts/pm-draw.mjs capture flow.json --screen create-form --target TARGET --observed '新建弹窗，标题已输入' --browser chrome
```

`open` 不等待业务状态稳定，按复现方式操作后用 `inspect` 核对。`act` 只支持常见 click / fill；原生手势、选择文件、登录验证和复杂控件用可用浏览器工具或由用户完成，不猜测选择器、不承诺通吃全部网站。`capture` 检查产品 origin、可选精确 URL 和计划中的可见选择器 / 文案；失败不保存截图。截取当前 viewport，因此复现方式需注明滚动位置；超长页面应按 PRD 的可见关键区域规划分屏状态，不把未截部分说成已验证。

操作产品时遵守用户已授权流程；涉及发送消息、真实支付、删除真实数据等不因“走查”而默认获准。使用用户提供的测试数据及环境；遇到需要新授权的具体业务动作再说明该动作，不能盲点按钮。

每次命令结束只断开本次 CDP 会话，不关闭用户已有标签。自行创建的走查标签在完成后通过所用浏览器工具关闭，不能批量关闭用户标签或终止用户的浏览器 / Proxy。

## 手动上传 / 外部工具截图

先实际查看图像，识别页面及状态，填写真实的复现方式。没有提供复现信息时标「待确认」，不能把推测写成观察事实。

```bash
node <SKILL>/scripts/pm-draw.mjs import-shot flow.json --screen list-empty --file ./uploaded.png --observed '资料列表，暂无资料'
node <SKILL>/scripts/pm-draw.mjs build flow.json --out review.html
```

外部浏览器工具采集的文件可加 --source browser-tool，如实区分手动上传。支持 PNG / JPEG / WebP，按文件签名验证，文件复制到截图目录后内嵌到单个 HTML。无法连接浏览器时，可继续生成已确认范围的走查草稿、标记缺失截图，或接入用户给的截图；不能声称已完成真实产品走查。

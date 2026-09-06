# 流程 JSON（schemaVersion 1）

路径相对 flow.json 所在目录。Agent 理解 PRD 后写清单，脚本只校验引用、结构与跳转，不能证明语义无遗漏。`build` 生成 `index.html` 和每组一个 `<group.id>.html`，组内屏幕平铺，跨组跳转为相对链接。

清单可整体单文件存放，也可按组拆分：flow.json 的 `groups` 只保留 `{id, title, file}` 索引，每组完整内容存为 `groups/<id>.json`。拆封对校验、渲染与反馈指纹透明；修改某组功能时只读写该组文件与索引，不必加载整个清单。

## 顶层

| 字段 | 说明 |
| --- | --- |
| schemaVersion | 固定 1 |
| project | `{id, title}`，id 跨轮保持不变，用于反馈隔离 |
| round | 从 1 开始；需要完整轮次历史时用 next-round |
| mode / target | 日常设计固定 `prototype` / `{kind: "none"}`；参考截图也用此模式 |
| prd.path | 本轮 PRD 路径；文首状态由 validate 报告并显示在 HTML，草稿会提示仅供讨论 |
| requirements | `{id, text, quote}` 数组；quote 是 PRD 中存在的连续原文，text 不扩展含义 |
| groups | 按用户阅读顺序排列。小清单直接内联 `{id, title, description?, screens}`；大清单用索引条目 `{id, title, file}` 指向 `groups/<id>.json`（内容为完整分组），两种形式可混用 |
| references | 可选截图参考数组，格式见下文；不属于产品需求 |
| history / baseline | next-round 管理，保留历史原话，不手工伪造 |

所有 id 用小写字母开头的 kebab-case；screen id 全局唯一，跨轮保持稳定。新增状态分配新 id，不按顺序重新编号。

## 页面状态

```json
{
  "id": "list-empty",
  "page": "资料列表",
  "device": "desktop",
  "frame": {"width": 1280, "height": 800},
  "state": "无资料",
  "requirements": ["r-list"],
  "reproduce": ["无资料的用户进入列表"],
  "summary": "用户可在这里创建第一份资料",
  "dataFlow": ["读取用户资料；结果为空时显示创建引导"],
  "blocks": [{"id":"title","type":"heading","text":"资料","requirement":"r-list"}],
  "actions": [],
  "pending": ["Q1：创建入口与后续路径待用户决策，此屏仅展示状态"]
}
```

上例为讨论用片段，正式绘制仍需根据 PRD 补充实际操作。除 id / page / state / requirements / reproduce / blocks / actions / pending 外，以下说明字段均可按需省略：

- `device`：desktop / mobile，新方案显式填写；旧清单省略时兼容 PC。两端各用独立 screen id，共用需求引用。
- `frame`：`{width, height}` 整数像素（240–3840），以截图内容视口或目标设备为准；未给时默认 PC 1280×800、移动端 390×844。画布内部布局固定，只整体缩放预览。
- `summary`：本屏任务与进入条件，一句话。
- `layout` / `logic` / `dataFlow`：字符串数组，分别说明模块职责、已确认规则和数据来源／更新／影响去向。
- `actions`：`{id, label, to, outcome, requirement, role?, disabled?}`。to 为 screen id、`null`（确知在当前状态内操作／结束）或“待确认”；role 为 primary / secondary，每屏最多一个 primary。disabled 只有 PRD 明确禁用时才设 true，不能因为原型不执行业务就画成禁用。每个操作有对应 action 组件，HTML 只演示去向，不执行业务。
- `transitions`：自动流转 `{condition, to, requirement}` 数组。to 是目标 screen id 或“待确认”，与点击操作分开。
- `pending`：未确定规则，引用 PRD 的 Q 编号与短问题，完整选项留在 PRD。
- `changeSummary`：本轮实际改动，简短说明即可。
- `annotations`：可选 `{component, requirement, original, change}` 数组，按组件记录旧逻辑与修改点；原逻辑注明观察或用户描述来源。

### 线框组件 blocks

每项 `{id, type, requirement, ...}`，requirement 为 PRD 需求 id 或“待确认”。`note` 可说明关键行为，说明在画布外编号并与组件悬停联动；自明元素省略。

| type | 内容 |
| --- | --- |
| heading / text / notice | text；heading 可用 level 1–3 |
| field | text 为标签，value / placeholder 可选，只读示意 |
| image | text 描述图片，渲染占位块 |
| list | items 字符串数组 |
| table | columns 字符串数组、rows 二维字符串数组 |
| section / columns | children 组件数组，可选 text；分栏子项用 weight 1–4 表示相对宽度 |
| action | action 为本屏操作 id |

顶层组件可用 `region: header / body / footer` 分配固定顶部、滚动内容或固定底部（默认 body，嵌套组件不设 region）。组件可用 `width` 固定宽度，例如 PC 侧栏 240；与 weight 互斥。内部 columns 不随预览窗口自动换列。可用 align（left / center / right）。不接收任意 HTML、脚本或远程图像。线框顶部自动显示页面名与状态，不在 blocks 机械重复。

## 截图参考 references

```json
{
  "id": "ref-create",
  "kind": "competitor",
  "title": "竞品的新建表单",
  "source": "实际浏览器截图；填写真实产品名称",
  "url": "https://example.com/replace-with-observed-page",
  "capturedAt": "2026-09-06T08:00:00Z",
  "observed": "主操作紧随必填字段，补充设置折叠显示",
  "application": "借鉴主次信息分区，用于本方案新建页",
  "screens": ["create-form"],
  "image": {"path": "references/create.png", "sha256": "替换为图片的实际 SHA256"}
}
```

这是格式示例，地址、时间和图片必须替换为实际证据。kind 为 competitor（竞品）或 existing（旧页面）。source 记录直接页面、官方文档或用户上传等来源；url 是实际来源页面，竞品必填，用户上传无地址时可省略。capturedAt 记录实际采集／接入时间，原拍摄时间未知则在 source 说明，不编造。screens 必须关联现有页面状态；image 用本地 PNG / JPEG / WebP 与实际 SHA256（可用 `shasum -a 256 <图片路径>`）。

按用户说明区分两种接入方式：

- **明确说明是旧页面截图**：kind 用 `existing`，并用可选 `changes` 在截图上标记变更点、补充更新逻辑。每条 `{rect 或 pin, original, change}`：rect 为 `[左, 上, 宽, 高]`、pin 为 `[x, y]`，均为 0–100 百分比（同屏幕 annotations 的坐标约定）；original 写旧逻辑并注明观察或用户描述来源，change 写新逻辑修改点。逐组件的更新逻辑仍用屏幕 `annotations` 与 `logic` / `dataFlow` 补充。
- **明确说明是参考图**：kind 用 `competitor`，只写观察与借鉴点，作为页面参考，不使用 `changes`。

build 验证图片摘要并内嵌图片。索引集中显示观察、应用与关联页面；参考图截图及来源按需展开，带 changes 的旧页面截图直接展示并叠加编号变更点，图下列出原逻辑与修改点；分组页链接到相应参考。有效参考跨轮复用，next-round 调整相对路径，不清空参考截图。不用屏幕级 screenshot 字段接入这些参考。

## 大清单分块

```bash
node <SKILL>/scripts/pm-draw.mjs init designs/product/flow.json --prd PRD-product.md --project product --title 产品名
node <SKILL>/scripts/pm-draw.mjs add-requirements designs/product/flow.json --file requirements.json
node <SKILL>/scripts/pm-draw.mjs add-group designs/product/flow.json --file group-a.json
node <SKILL>/scripts/pm-draw.mjs validate designs/product/flow.json
node <SKILL>/scripts/pm-draw.mjs build designs/product/flow.json --out designs/product/site
```

`--prd` 相对 flow 所在目录。先加入需求再逐组追加，最后统一校验覆盖与跨组跳转；参考数组直接写入 flow。片段只是临时素材，无需交付。

`add-group` 会把每组写入 `groups/<id>.json`，flow.json 只保留 `{id, title, file}` 索引；已有的整体清单可用 `split <flow.json>` 一次性拆分。后续修改某组功能时，从 flow.json 索引定位分组文件，只读写该文件即可；改了组标题要同步索引条目。validate / build 自动合并读取，next-round 会把分组文件一并复制到新轮次目录，无需手工拼装。

## 反馈与历史

HTML 按 project id + round 暂存本地反馈；fingerprint 绑定 PRD、清单、参考与历史，同轮内容不匹配或多窗口冲突时暂停静默覆盖并提示导出。`view <site目录或HTML>` 用专用 CDP Chrome 打开页面并启动本机保存服务；用户点击“保存反馈”后，完整 JSON 原子写入 HTML 所在目录。保存失败会在页面提示。

导出 JSON 含 `schemaVersion: 1`、`kind: pm-draw-feedback`、`projectId`、`round`、`fingerprint`、`screens`、`groups`、`history`。每屏含 id、page、state、groupId、contentHash、mark、problem、suggestion；mark 为“符合预期”“需要调整”“严重问题”或空字符串。问题与建议原文保留。每组含 problem / suggestion；任意页面导出全部分组反馈。

需要完整轮次历史时，在修改 PRD / flow 前运行 `next-round`；核对匹配版本后保存历史与上一轮内容摘要，新轮输入为空。新 PRD 另存并修改 prd.path，旧 PRD 与 HTML 保留。原型变化标“已更新”，不要求产品回归。文字反馈也可直接用于局部修改，不强制执行此命令。

旧版 review / target、截图覆盖层和 plan / approve / 浏览器命令仍按原校验兼容，仅处理历史清单；新设计不使用这些字段。可用 CLI --help 查看兼容命令。

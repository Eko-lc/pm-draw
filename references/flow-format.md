# 流程 JSON（schemaVersion 1）

路径均相对流程 JSON 所在目录。结构由 `scripts/model.mjs` 校验，校验器验证来源引用和关系，不能替代 Agent 对完整 PRD 的语义检查。

`build` 的产物是多页面：`index.html` 总索引 + 每个流程分组一个 `<group.id>.html` 子页面（group.id 即文件名），拆分只到分组、单屏不拆页。跨组跳转与导航自动生成 `<group.id>.html#screen-<id>` 相对链接，因此 group / screen id 一旦使用不要随手改名。

| 字段 | 说明 |
| --- | --- |
| schemaVersion | 固定 1 |
| project | `{id, title}`；id 跨轮保持不变，用于本地反馈隔离 |
| round | 从 1 开始的正整数；下一轮用 `next-round` 生成 |
| mode | `prototype` / `review` |
| prd.path | 本轮 PRD Markdown 相对路径；PRD 内容摘要参与确认绑定；文首「状态：草稿 / 待决策 / 已审查通过」行被 validate 报告并呈现在 HTML 头部，未定稿时标注方案仅供讨论 |
| target | `{kind: "none"}`（只有 PRD）；`manual`（已提供截图）；`url` / `runtime` 必须含 `url`，可加启动 / 登录说明 `description` |
| requirements | `{id, text, quote}` 数组；quote 必须是 PRD 中确实存在的连续原文，text 不得扩展含义 |
| groups | 按用户使用顺序排列的流程组 `{id, title, description?, screens}` |
| approval | `approve` 命令管理；包含用户确认原话、时间和当前计划摘要；screenIds 可限制本次授权的页面 |
| history / baseline | `next-round` 命令管理；不要手工改写历史 |

## 分块生成（大 PRD）

PRD 较大、流程分组 / 页面状态较多时，一次性写出整个流程 JSON 容易超出单次输出上限而被截断。改用增量命令分块组装，每个片段文件都足够小、可在单次回复内安全写出：

```bash
node <SKILL>/scripts/pm-draw.mjs init designs/<product>/flow.json --prd PRD-<product>.md --project <id> --title <名称>
node <SKILL>/scripts/pm-draw.mjs add-requirements designs/<product>/flow.json --file requirements.json   # 需求对象数组 [{id,text,quote}]
node <SKILL>/scripts/pm-draw.mjs add-group designs/<product>/flow.json --file group-a.json               # 单个流程分组 {id,title,screens}
node <SKILL>/scripts/pm-draw.mjs add-group designs/<product>/flow.json --file group-b.json
node <SKILL>/scripts/pm-draw.mjs validate designs/<product>/flow.json                                    # 全局校验：需求覆盖 / 跳转闭合
```

- `init` 创建骨架（头部 + 空 requirements / groups），已存在时拒绝覆盖；`--mode` / `--kind` / `--url` 可选，默认 prototype + none。
- `add-requirements` 校验每条 quote 是 PRD 原文、编号不重复后追加。
- `add-group` 校验分组结构、页面编号不重复、引用的需求编号已存在（因此先加需求再加分组）；不校验跨组页面跳转与需求覆盖，这两项留给最后的 `validate`。
- 片段文件是临时素材，组装完成后可删除；flow.json 是唯一权威清单。

## 一屏 = 页面 + 状态

```json
{
  "id": "list-empty",
  "page": "资料列表",
  "state": "无资料",
  "requirements": ["r-list"],
  "reproduce": ["用没有资料的测试账号打开列表"],
  "summary": "用户进入资料管理后看到空状态，引导创建第一份资料",
  "layout": ["顶部为页面主标题", "中部为空状态说明与引导", "底部为主操作区"],
  "logic": ["无任何资料时显示空状态，不显示列表与搜索"],
  "blocks": [{"id":"title","type":"heading","text":"资料","requirement":"r-list","note":"页面主标题，固定文案"}],
  "actions": [],
  "pending": ["空状态的帮助文案未明确"],
  "url": "http://localhost:3000/materials",
  "capture": {"expectText":"暂无资料", "expectSelector":"[data-state=empty]"}
}
```

所有 id 用小写字母开头的 kebab-case。screen id 全局唯一；页面新增状态单独分配 id，跨轮不按顺序重编号。流程位置由数组顺序自动呈现。页面状态应具体，不能用“页面截图 1”代替。

「原型说明」字段（每屏右侧面板，全部可选但正式方案应写齐）：

- `summary`: 本屏一句话说明——用户在此完成什么任务、什么条件下进入本状态；不写 PRD 编号、不复述页面名。
- `layout`: 字符串数组，按视觉顺序说明布局分区及各区职责（如「顶部：标题与全局操作」「中部：列表区，空数据时显示空状态」）。说明区域含义即可，不写像素与颜色。
- `logic`: 字符串数组，条件展示、边界与异常等业务规则（什么条件显示什么、数据为空 / 失败 / 权限不足时怎样）。写成可执行判断句，与 `pending` 区分：已明确的规则进 logic，未明确的进 pending。
- `blocks[].note`: 组件级说明——该组件展示什么、用户能怎么操作、操作后发生什么、数据格式与校验规则。写了 note 的组件在线框中自动获得编号徽标，与说明列表一一对应、悬停联动高亮；纯装饰或自明组件可不写。

- `actions`: `{id, label, to, outcome, requirement, role?}`。`to` 为目标 screen id；确知在当前状态内操作或流程结束用 `null`，未知跳转写 `"待确认"`。`outcome` 解释用户操作后发生什么。`role` 可选 `primary` / `secondary`，表达主次操作；每屏最多一个 `primary`。每个操作必须有对应 action 线框组件，让按钮位置可见。指向页面的操作生成可点击锚点，按钮下方标注跳转目标页面与状态；终点 / 未明确操作显示禁用示意并附说明，HTML 不执行真实业务。
- `transitions`: 可选的自动状态流转数组 `{condition, to, requirement}`，如保存成功进入列表、保存失败进入失败态。`to` 为 screen id 或「待确认」。与用户可执行 actions 区分。
- `blocks`: 每项 `{id, type, requirement, ...}`。`requirement` 引用 PRD 需求 id，未知用 `"待确认"`。支持 heading / text / notice（text）；field（text 为标签，value / placeholder 可选，只读示意）；image（text，永远渲染图片占位块）；list（items 字符串数组）；table（columns 字符串数组、rows 二维字符串数组）；section / columns（children，可选 text）；action（action 为本屏操作 id）。heading 可用 `level`（1–3，默认 1）表达信息层级：1 页面主标题、2 区块标题、3 小节标题。不接收任意 HTML、脚本、彩色主题或远程资源。产品图仅作占位，真实截图走独立字段。可用 align（left / center / right）表达文本对齐，用 weight（1–4）表达 columns 中子区域的相对宽度。线框顶部自动渲染「页面名 · 当前状态」状态条，无需在 blocks 中重复。
- `pending`: PRD 尚未明确的规则列表；没有则 `[]`。未知规则不能伪装成已确定业务逻辑。
- `annotations`: 可选数组 `{component, requirement, original, change, rect?, pin?, arrow?}`。component 指本屏 blocks 的 id；原逻辑只写实际观察证据；change 说明相对 PRD 需要改什么。`rect` 为截图内 `[左, 上, 宽, 高]` 百分比（0–100），渲染红色编号矩形；`pin` 为 `[x, y]` 百分比坐标，渲染红色圆点（无 rect 时带编号）；`arrow` 为 `[x, y]` 百分比坐标，从 rect 中心或 pin 出发画红色箭头连线，必须搭配 rect 或 pin。三者都是截图覆盖层，不修改原图；编号与「原逻辑与修改点」列表一一对应，悬停联动高亮。
- `capture`: 自动截图前纳入计划的状态断言 `expectText` / `expectSelector`，至少一个。选择器必须来自已知运行环境信息或已确认计划；首次未知可先以 PRD 明示文案断言，确认后再使用浏览器检查实际控件。
- `url`: 可选精确页面地址（含查询参数、hash）；提供则截图前逐项校验。未提供时至少校验目标产品 origin，再验证状态断言。
- `screenshot`: 由 import-shot / capture 写入 `{path, sha256, source, capturedAt, actualState, url?, title?, viewport?}`。图像原样复制到本轮目录，构建时验证哈希并内嵌。修改外部图片后必须重新接入。不能在 prototype 模式使用真实截图。
- `blockedReason`: 无法复现或截图的具体原因；走查 HTML 会显示阻塞，不填造假的占位截图。
- `changeSummary`: 新一轮实际修改说明，不参与自动差异哈希，不能用来手工伪造“已修复”。

## 反馈与历史

浏览器自动保存键为项目 id + round。HTML 内记录 PRD 内容与本轮清单共同形成的 fingerprint；同轮内容不同则暂停覆盖既有本地反馈并提示导出。多窗口同时修改也暂停静默覆盖。浏览器无法写入时显式提示 JSON 导出，不谎称已保存。

JSON 导出含 `schemaVersion: 1`、`kind: pm-draw-feedback`、`projectId`、`round`、`fingerprint`、`screens`、`groups`、`history`。每屏记录 id、page、state、groupId、contentHash、mark、problem、suggestion；mark 为 `符合预期` / `需要调整` / `严重问题` 或空字符串。问题和建议保存字符串原文，不 trim、不翻译、不总结。每组含 problem / suggestion。Markdown 同样包含历史原话，适合交给 AI 阅读。

`next-round` 必须在修改原清单前运行，核对项目、轮次、fingerprint、每屏内容摘要和分组完整性，将本轮反馈作为只读快照附加到清单已有历史。它不信任导入 JSON 对旧历史的改写。下一轮清空截图、确认和当前输入；复制 PRD 后可改本轮需求，保留旧清单及 HTML。

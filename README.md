# pm-draw

给 Agent 使用的 PRD、低保真原型与产品走查 Skill。以 proto-gen 的索引 / 原型 / 说明结构和单文件交付为基础，结合 web-access 的浏览器发现与 Proxy 协议；使用用户提供的 create-prd 八章规范。

## 可以做什么

| 输入 | 产出 |
| --- | --- |
| 构思 / 需求资料 | 八章 `PRD-<product>.md`；未确定事项以「问题 + 选项 + AI 建议」请你决策；你标记「已审查通过」后定稿 |
| 已定稿 PRD | `index.html` 总索引 + 按流程分组的子页面：独立页面状态、标题分级信息层级、主次按钮、操作和跳转去向、每屏原型说明（页面 / 布局 / 组件 / 逻辑规则，PRD 原文折叠可追溯） |
| PRD + 产品地址 / 环境 | 先交走查计划，用户确认后实际操作与截图，再生成截图和原型并排的走查页 |
| PRD + 上传截图 | 按页面状态接入 PNG/JPEG/WebP，原图上叠红色编号 / 圆点 / 箭头标注方案，生成走查 HTML |
| 走查反馈 JSON | 下一轮清单与原话历史；重新采集后自动标记改动、新增和不变页面 |

产物按功能流程分组拆分：`index.html` 是总索引，说明每个分组的内容与入口；每个流程分组一个 `<group-id>.html` 子页面，组内屏幕按使用顺序平铺，跨组跳转自动生成相对链接。拆分只到分组、不把单屏拆成独立页面，方便后续修改变更时快速定位。

每屏标清页面名称、流程位置（第几步、上一屏 / 下一屏）、当前状态、可执行操作及操作后进入的页面或状态；右侧「原型说明」面板写清页面任务、布局分区、组件行为（编号与线框联动）、逻辑规则与交互跳转，PRD 原文折叠在「PRD 依据」中可追溯。绘制与原型说明规范见 [wireframe-guide](references/wireframe-guide.md)。

## 协作流程

1. 你给出需求背景和目标；新功能描述逻辑和操作路径，旧功能迭代描述旧逻辑和新逻辑。
2. Agent 编写完善 PRD；未确定事项汇总为决策记录，给出选项和建议请你选择，不擅自假设。
3. 你审查 PRD、回答决策，可来回多轮，满意后在文首标记「状态：已审查通过」。
4. Agent 依据定稿 PRD 绘制原型；有实际页面时先交走查计划，确认后再截图对照。
5. 原型或走查 HTML 中的标记、问题和建议可随时回流：表达问题直接改清单重建，需求变化回 PRD 重新定稿后再重建。各阶段不强制串行，以 PRD 状态和反馈内容为依据推进。

每屏有「符合预期」「需要调整」「严重问题」和问题 / 建议输入框，每组末尾有流程反馈。反馈自动保存在当前浏览器、同轮各页面共享，任意页面导出的 JSON 都包含全部分组反馈，可导出 Markdown、JSON，也可从 JSON 恢复本轮输入。移动文件、换浏览器或清理缓存前先导出 JSON；浏览器存储不是跨设备同步服务。

## 直接试用

运行依赖 **Node.js 22+**，无需安装 npm 依赖。

```bash
node scripts/pm-draw.mjs --help
```

在当前仓库直接告诉 Agent：

> 读取 SKILL.md，按 pm-draw 帮我写一个剧本编辑器 PRD，再生成低保真 HTML。

或者：

> 读取 SKILL.md，根据这份 PRD 走查这个产品。先给我流程分组、页面和状态，等我确认后再截图。

需要在其他项目使用时，把本目录作为完整 Skill 放入你的 Agent 支持的技能目录，不要只复制 SKILL.md；`assets/`、`scripts/` 和 `references/` 都是运行资源。本仓库不自动修改用户全局配置或安装其他插件。

## 可复现的命令流程

PRD 和流程清单由 Agent 根据实际需求编写，脚本不声称能自动理解任意自然语言 PRD。具体格式见 [flow-format](references/flow-format.md)。

```bash
# 大 PRD 建议分块组装（避免一次性写出超长 JSON 被截断）；小清单也可直接手写整个 flow.json
node scripts/pm-draw.mjs init designs/product/flow.json --prd designs/product/PRD-product.md --project product --title 产品名
node scripts/pm-draw.mjs add-requirements designs/product/flow.json --file requirements.json
node scripts/pm-draw.mjs add-group designs/product/flow.json --file group-a.json   # 每个流程分组一个片段，逐个追加
node scripts/pm-draw.mjs validate designs/product/flow.json
node scripts/pm-draw.mjs build designs/product/flow.json --out designs/product/site
# 产物：designs/product/site/index.html 总索引 + 每个流程分组一个 <group-id>.html

# 已有实际页面：先创建 mode=review 的清单，再生成计划；这一步不连接浏览器。
node scripts/pm-draw.mjs plan designs/product/review-flow.json --out designs/product/plan.md
# 收到用户对这份计划的确认后，填入实际摘要和用户确认原话。
node scripts/pm-draw.mjs approve designs/product/review-flow.json --hash PLAN_SHA256 --quote '用户实际确认原话'

# 接入实际截图（也支持 open/inspect/act/capture，见浏览器参考）
node scripts/pm-draw.mjs import-shot designs/product/review-flow.json --screen page-state-id --file screenshot.png --observed '实际页面状态'
node scripts/pm-draw.mjs build designs/product/review-flow.json --out designs/product/site

# 用户导出反馈后，先生成下一轮，再修改下一轮清单。
node scripts/pm-draw.mjs next-round designs/product/review-flow.json --feedback feedback.json --out designs/product/round-2/flow.json
```

确认绑定 PRD 内容和计划语义。更改流程、页面状态、操作、原型或截图验证条件后旧确认失效；确认记录是 Agent 对用户授权的记录，不是身份认证系统，不能虚构确认原话。缺失截图会显示待采集 / 阻塞，不能作为完整走查交付。

浏览器可使用已有 web-access Proxy，也可用内置 CDP；不需要运行 web-access 的其他研究和发布流程。详细命令、条件及限制见 [browser-capture](references/browser-capture.md)。

## 结构

```text
SKILL.md                  Agent 入口与分阶段工作路径
references/               八章 PRD 规范、流程格式、线框与标注规范、浏览器接入、评审清单
scripts/pm-draw.mjs        校验、计划、确认、生成、截图接入、下一轮 CLI
scripts/model.mjs         数据校验、确认摘要、反馈与截图摘要
scripts/browser*.mjs      web-access / CDP 适配与浏览器发现
scripts/render.mjs        离线多页渲染（index 总索引 + 分组子页面）和资产注入
scripts/pm-draw.test.mjs  校验与渲染回归测试（npm test）
assets/                   低保真功能配色组件、PRD 双向高亮、本地反馈运行时
```

修改工具实现后运行 `npm test` 做回归检查。

资产沿用 proto-gen 的单源注入思路，标记改为 `@pm-draw`。`node assets/inject-assets.mjs <HTML或目录>` 可刷新样式和运行时；业务内容改变应从对应清单重新 build，保留旧轮次。

来源和许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

# pm-draw

将粗需求补全为精简功能 PRD，参考竞品页面截图，生成可反馈的低保真 HTML 原型方案。支持新功能与旧功能迭代，流程可跨轮、可局部修改，无需产品走查。

## 怎样协作

| 你提供 | Agent 完成 |
| --- | --- |
| 背景、目标、新功能逻辑与操作路径 | 编写 PRD；关键未知项给问题、选项和建议 |
| 竞品地址与研究范围 | CDP 观察页面、采集证据，输出竞品 PRD、PC／移动端线框与方案建议 |
| 旧功能页面／截图、旧逻辑与新逻辑 | 观察旧页面，整理变化与影响范围，再补全 PRD |
| 对决策问题的回答或审查意见 | 同步修改正文、流程和验收；你明确通过后标记“已审查通过” |
| 已审查通过的 PRD | 调研相关竞品截图，绘制原型并写清逻辑、交互、数据流向、状态及异常路径 |
| HTML 中的标记、问题、建议 | 按页面局部修改；业务变化先改 PRD，你要求预览才同步草稿原型 |

默认 PRD 只保留背景目标、功能规则、流程状态、验收和决策项。没有必要的内容省略，已决策记录折叠保留。回答问题不自动批准整份 PRD。

原型按「功能流程 → 页面状态 → 原型与说明」组织：`index.html` 总索引，每个流程组一个 HTML。参考截图集中展示，每屏可追溯相关参考和 PRD；明确说明的旧页面截图在图上标注变更点并列出原逻辑与新逻辑，参考图只作页面参考。关键组件与画布外的说明悬停联动。方案为低保真页面状态与跳转演示，不执行真实业务。

支持用 Mermaid 显示交互、控制流或数据流：PRD 写标准 Mermaid 代码块，HTML 自动展示图示；流程组和页面可用 `diagrams` 引用 PRD 图或补充说明图。支持缩放、源码查看与复制，内嵌本地 Mermaid 保持离线可读。写法见 [mermaid-guide](references/mermaid-guide.md)。

线框分 PC 和移动端两种样式：按各自画布定位导航、内容和操作区，两端分别设计，不预设终端优先级；预览只整体缩放，不自动改变画布内部位置。可设置准确视口尺寸、PC 侧栏宽度以及固定顶部／底部区。画布内只放产品内容；尺寸、状态、编号、交互说明与反馈置于画布外。

每屏保留标记、问题与建议，支持当前浏览器保存、JSON / Markdown 导出。只改一个页面时不必重做全部流程；要保留完整轮次历史时再用 `next-round`。跨浏览器或清理缓存前导出 JSON。

## 使用

需要 Node.js 22+，无 npm 运行依赖。在仓库中告诉 Agent：

> 读取 SKILL.md。我要给资料列表增加批量归档，背景和目标是……先帮我完善 PRD，不确定的给问题和选项。

> 这份 PRD 已审查通过，请调研相关竞品页面截图并生成原型方案。

> 按这份 HTML 反馈，只调整列表页的信息层级。涉及业务规则的先更新 PRD，等我审查。

在其他项目使用时，将整个目录安装为 Agent 的 Skill；`assets/`、`scripts/` 与 `references/` 都是运行资源。

竞品独立研究使用 [competitor-analysis](references/competitor-analysis.md) 和 `scripts/research.mjs`，无需走查计划或 PRD 审批前置。竞品分析草稿与本产品正式方案分开。

## 生成与迭代

PRD、流程清单和研究参考由 Agent 编写，脚本负责校验与渲染。格式见 [flow-format](references/flow-format.md)。

```bash
# --prd 路径相对 flow.json 所在目录
node scripts/pm-draw.mjs init designs/product/flow.json --prd PRD-product.md --project product --title 产品名
node scripts/pm-draw.mjs add-requirements designs/product/flow.json --file requirements.json
node scripts/pm-draw.mjs add-group designs/product/flow.json --file group-a.json
node scripts/pm-draw.mjs validate designs/product/flow.json
node scripts/pm-draw.mjs build designs/product/flow.json --out designs/product/site

# 用专用 CDP Chrome 打开页面，同时启动页面反馈保存服务
node scripts/pm-draw.mjs view designs/product/site

# 有匹配本轮 HTML 的反馈 JSON、需要保留完整历史时，在修改 PRD / flow 前执行
node scripts/pm-draw.mjs next-round designs/product/flow.json --feedback designs/product/site/product-round-1-feedback.json --out designs/product/round-2/flow.json
```

浏览器命令默认启动或复用 `127.0.0.1:9223` 的专用 CDP Chrome，数据目录与日常 Chrome 隔离；多个 Agent 任务复用该专用 Profile 的登录态与 Cookie。只有显式传 `--browser` 时才连接日常浏览器。

页面输入自动暂存在浏览器。用户点击“保存反馈”后，本机保存服务校验页面版本并将完整 JSON 原子写入 HTML 所在目录，文件名为 `<projectId>-round-<轮次>-feedback.json`；保存动作由页面完成，不依赖 Agent 读取 textarea。小清单可直接写完整 JSON；大清单逐组追加，每组存为 `groups/<id>.json` 独立文件，flow.json 只保留索引，局部修改某组只需读写对应文件。截图研究方法见 [browser-capture](references/browser-capture.md)，原型表达规范见 [wireframe-guide](references/wireframe-guide.md)。旧版 review 与截图 CLI 保留兼容，日常设计使用 prototype，无需调用走查命令。

修改脚本后运行 `npm test`；涉及渲染／交互时，实际打开生成的索引和分组页检查相关布局、跳转、截图展开与反馈保存／导出。资源支持 `node assets/inject-assets.mjs <HTML或目录>` 刷新；业务内容变更从 flow 重建。

来源和许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

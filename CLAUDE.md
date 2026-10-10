# Closure Call — Hack Midwest 2026

团队：Chris + Zoe。比赛 10/10 9:30am – 10/11 8:00am（提交截止），9:00am 起 demo。
**Fresh Code 规则：开赛前不写任何应用代码、不建 repo、不 commit。**

**配套文档**：`GOALS.md`（完成定义 + 验收，开发时逐项自检）· `PROTOTYPE_PLAN.md`（原型施工图）· `KICKOFF.md`（开幕清单 + 10/9 晚实况）· `DEMO.md`（3 分钟脚本）

## 项目
USDA "Closure Call"：恶劣天气下帮 USDA 设施管理员决定办公楼是否关闭，并通知对的员工。
**AI 不做决定，人做决定。** 系统负责集中信息、给出建议、生成通知、留下记录。

## 目标奖项
1. USDA Challenge（主题本身）
2. AWS — Best Use of Strands Agents SDK（Python）
3. Akamai — 后端部署在 Akamai Cloud (Linode)，可能用其 AI 推理端点（开幕时公布）。见优先级 P1

## 优先级
- **P0**：USDA 题 + Strands agent，完整流程跑通。后端先部署在最省事的平台
- **P1**：周六 19:00 checkpoint 时若 P0 全通，再花约 2 小时把后端迁到 Akamai Linode；否则放弃 Akamai

## 分工
- **Zoe**：阈值依据（OPM/NWS 标准）、demo 开场故事与讲解、在 iPad 上对 prototype 截图标注修改
- **Chris**：与 CC 协作实现和部署，把 Zoe 的标注转给 CC 迭代

## 时间表与检查点
**周六**
- 9:30 开幕：记录 AWS/Akamai 的账号、模型、凭证信息，交给 CC
- 9:45–11:00：CC 一口气搭出完整 prototype，跑在 localhost（前端 + 后端 + 真实 NWS 数据 + 规则 + 假员工数据）
  - 同时 Zoe：查阈值依据（OPM/NWS），准备 demo 开场故事
- 11:00 起：Zoe 在 iPad 上对 prototype 截图标注修改，Chris 转给 CC 迭代
- **12:30 检查点 1**：真实预警 → 建议等级显示；Strands agent 已接上模型（AWS 部分）
- 13:00–17:00：通知包、决策记录、第二种灾害、两段式通知
- 17:00：第一次部署上线
- **19:00 检查点 2**：五项交付物全通 → Akamai 迁移 + 时间回放；否则只修核心

**周日**
- 6:00 冻结功能
- 6:00–7:30 排练 + 录屏备份
- 7:30 提交（截止 8:00）

## 技术栈
- 前端：React (Vite) → GitHub Pages，PWA，手机可用
- 后端：FastAPI + Strands agent → 先部署在最省事的平台，P1 再迁 Akamai Linode。**必须 HTTPS**（前端是 HTTPS）
- 模型：Bedrock / Anthropic API / Akamai 推理，开幕后决定

## 架构原则
- **关闭等级由确定性规则代码判定，LLM 不判断**（一致性、可解释性）
- Agent 流程：调用工具收集数据 → 调用规则函数 → 写理由段落和通知草稿

## 技术规格
结构：`/frontend`（React + Vite）、`/backend`（FastAPI）

### 数据
- `facility.json`：一个地点、一栋楼——虚构「USDA County Service Center」，上班时间 8:00–16:30。
  位置预设：佛罗里达 Panhandle、德州（休斯顿一带）、1 个备用。**仅为 demo 找真实预警而切换**，不是多设施
- `employees.json`：约 15 人，其中 3–4 名 field 外勤。字段：
  `name, role, essential`（必要岗位）`, work_location`（office / field）`,
  weekly_onsite_days`（如 周一/二/四）`, today_status`（onsite / teleworking / on_detail / leave）`,
  channel`（sms / email / phone）`, accessibility_needs`

### 外部数据（全部免 key）
- NWS：`/points/{lat},{lon}` 取区域；`/alerts/active?point={lat},{lon}` 取预警；逐小时预报。**必须带 User-Agent header**
- 补充信号：USGS 河流水位（与洪水对应）。开赛时先确认 USGS 当前推荐的 API
- 每条数据都记录 `source` 和 `fetched_at`

### 规则矩阵（`rules.py`，确定性代码，不用 LLM）
**飓风**（提前多天可预报，适合两段式）
- Watch：前一晚/提前发「可能关闭，X 点确认」
- Warning：正式通知。外勤最先通知（停止作业、尽早返回）；楼里的人提前下班；通勤者不要出行

**洪水 / 山洪**
- 通勤者最紧急（不要驾车涉水）；外勤远离低洼和河道；道路受影响时楼里的人提前下班或远程

**兜底**：其他预警类型按 NWS severity / urgency 给通用等级，保证任何真实预警都能跑通全流程

**输出**
- 设施五级：`OPEN / DELAYED_ARRIVAL / EARLY_DEPARTURE / UNSCHEDULED_TELEWORK / CLOSED`（对应 OPM 运营状态公告类别）
- 按员工分组（外勤 / 楼内 / 通勤者）的行动指令和通知紧急度，与设施等级分开输出
- 越过哪条阈值、超出多少、置信度（来自 NWS certainty）、什么变化会改变结论
- 每条阈值在代码中注明依据来源

### 通知规则（以公司排班表为准）
- **核心：同一场天气对不同员工的影响不同**
- 今天排班到岗 → 通知；内容必须说明**是否适用于本人、本人该做什么**
- 今天没排班（远程日、出差、休假）→ 不通知，记录中写明排除理由
- 员工临时自行到岗不在系统责任范围内
- 渠道只在通知包中标注，不实际发送

### Agent（Strands Agents SDK）
- 工具：`get_nws_alerts, get_forecast, get_river_gauge, get_roster, evaluate_rules, draft_notifications`
- Agent 负责收集数据、调用规则、写可复制的理由段落、写通知草稿
- **Agent 不得改动规则给出的等级**
- 模型通过环境变量配置（开幕后定）

### 决策记录
- 追加写入（append-only），每条：时间、所有输入快照（含来源和时间）、规则结果、
  agent 文字、管理员最终决定、决定人、决定时间、若推翻建议则写理由

### API
- `GET /facility`, `PUT /facility/location`
- `POST /assess` → 建议 + 依据 + 理由
- `POST /decision` → 管理员确认或推翻
- `GET /notifications/preview` → 通知谁、不通知谁及原因、草稿、渠道
- `GET /records` → 决策记录

### 前端 3 个页面
1. **建议总览**：当前预警、五级建议、依据和阈值、理由段落、「确认 / 推翻」按钮
2. **通知包**：收件人列表（含排除理由）、消息草稿、渠道
3. **决策记录**：时间线，可点开每条看当时的完整快照

无登录，打开即用。

### 测试场景（都要能演示）
- 两个预警同时生效 → 取最严重
- NWS API 失败 → 显示数据缺失、低置信度，**绝不默认 OPEN**
- 预警被取消 → 生成更正通知，写入决策记录
- 管理员推翻建议 → 必须填理由，写入记录
- 有行动不便需求的员工 → 避险通知中单独提醒

## 范围
- 一个地点、一栋楼；位置可切换仅为 demo 找真实预警
- 2 种灾害：**飓风 + 洪水（含山洪）**；其他预警走兜底。不扩展
  - 飓风参考：本周末飓风 Isaias（佛罗里达 Panhandle 登陆）
  - 洪水参考：德州
- **开幕后先查 `api.weather.gov/alerts/active`，确认 demo 地点**

## 产品需求
（待补：Zoe 写的题目说明文档，10/10 开赛后贴入此处）

## 差异化亮点（候选，开赛后定）
- **时间回放**：选一场历史真实天气事件，拖动时间轴看每个时刻的建议，体现决策记录
  （NWS API 只保留近期预警；历史事件需另找存档，如 Iowa Environmental Mesonet）
- **一致性**：同样条件必得同样结论，并展示依据
- **通知精准**：按排班表通知，明确显示每个未通知员工的排除理由
- **外勤人员优先通知**：飓风 Warning 时外勤最先收到「停止作业、尽早返回」，洪水时收到「远离低洼和河道」

## 必须交付（官方 5 项）
1. **能跑的系统**：现场调用真实 NWS API，不用 mock
2. **五级建议**（正常 / 推迟到岗 / 提前下班 / 远程 / 关闭）+ 每个输入的来源和时间戳 + 越过哪条阈值、超出多少 + 置信度 + 什么会改变建议 + 一段可复制进邮件的理由
3. **通知包**：通知谁、为什么不通知谁、消息草稿、渠道
4. **决策记录**：当时知道什么、何时、决定了什么，可事后还原
5. **阈值依据**：引用 NWS severity/certainty/urgency、OPM 运营状态类别等

## Demo 约束
3 分钟，无 PPT，无登录页，打开即进核心功能。讲清问题 → 现场演示 → 点名用了 Strands / Akamai。
最后阶段冻结代码，只练 demo。

**开场故事（备用，demo 时再细化）**
- Zoe：学校 snow day 通知太晚
- Chris：人在北京却收到圣路易斯龙卷风警报电话

# PROTOTYPE_PLAN — 9:45–11:00 一口气搭出的原型

CC 的施工图。开赛前只写文档；收到「开始」指令后按此执行。

## 原则
1. **先竖切一条完整链路，再加宽**：真实预警 → 规则 → 页面，先通；再加 agent、通知、记录
2. **Agent 可插拔**：没有模型凭证时，同一套工具直接调用 + 模板文字，整条链路照样能跑。凭证到手后切换为 Strands agent
3. **每一步都可自检**：后端用 curl 验证接口，规则用 pytest，前端起 dev server 看页面

## 目录
- `/backend`：`main.py`（FastAPI 路由）、`sources/`（nws、usgs/nwps）、`rules.py`、`roster.py`、`notify.py`、`agent.py`（Strands）、`records.py`（append-only JSONL）、`data/`（facility.json、employees.json、records.jsonl）、`tests/`
- `/frontend`：Vite + React，3 个 tab + 顶部栏

## 施工顺序（时间盒）
| 时间 | 产出 | 自检 |
|---|---|---|
| 9:45–10:00 | 骨架 + `facility.json` / `employees.json`（15 人，含外勤、排班、不在岗、行动不便） | 后端起得来，前端能拉 `/facility` |
| 10:00–10:15 | `sources/nws`：points → zone/county → active alerts + hourly forecast；每条带 source/fetched_at；失败返回显式 missing | curl 真实位置返回预警 |
| 10:15–10:35 | `rules.py` 规则矩阵 + 兜底 + 多预警取最严重 + 置信度 + 「什么会改变」 | pytest 每条阈值 |
| 10:35–10:50 | `notify.py`：排班过滤 → 分组排序 → 每人草稿（模板版）；`records.py` | curl `/notifications/preview` |
| 10:50–11:00 | 前端 3 页可用 + 位置切换 + 回放模式开关 | 浏览器走一遍完整流程 |
| 11:00 后 | 接 Strands agent（凭证到手即接），按 Zoe 标注迭代 | 见 GOALS |

## 规则矩阵（草案；阈值依据由 Zoe 核实后定稿）
等级从低到高：`OPEN < DELAYED_ARRIVAL < EARLY_DEPARTURE < UNSCHEDULED_TELEWORK < CLOSED`。多预警取最高。
| 触发 | 等级 | 依据 |
|---|---|---|
| Hurricane Watch（48h 内可能） | OPEN + 前晚预告「可能关闭，X 点确认」 | NWS 产品定义 |
| Hurricane Warning（36h 内预期） | CLOSED | NWS 产品定义；OPM Closed |
| Tropical Storm Warning | 起始时间在工作时段内 → EARLY_DEPARTURE；在上班前 → UNSCHEDULED_TELEWORK | NWS 39–73 mph 定义 |
| Storm Surge Warning 且设施在风暴潮区 | CLOSED | NWS |
| Flash Flood Emergency | CLOSED | NWS |
| Flash Flood Warning 覆盖通勤时段 | DELAYED_ARRIVAL 或 UNSCHEDULED_TELEWORK | NWS「Turn Around Don't Drown」 |
| Flood Warning + 附近水位 ≥ 洪水位 / ≥ 中度洪水位 | UNSCHEDULED_TELEWORK / CLOSED | NWPS 洪水分级 |
| 逐小时预报：持续风 ≥40 mph 或阵风 ≥58 mph 落在通勤时段 | DELAYED_ARRIVAL | NWS High Wind Warning 标准 |
| 兜底：Extreme + Immediate / Severe + Immediate·Expected / 其他 | CLOSED / UNSCHEDULED_TELEWORK / OPEN（附提示） | CAP severity·urgency |
| NWS 数据缺失 | 不给 OPEN；保留上次已知等级，置信度 LOW，提示人工判断 | 赛题要求 |
- 置信度：certainty Observed/Likely → HIGH，Possible → MEDIUM，其余或数据缺失 → LOW
- 注：OPM 另有「Shelter in Place」类别；就地避险作为**通知紧急度**处理，不进五级

## 通知逻辑
1. 按排班表：今天 `weekly_onsite_days` 包含今天且 `today_status=onsite` → 通知；teleworking / on_detail / leave → 不通知，记录理由
2. 分组 + 排序：外勤（最先）→ 通勤者 → 楼内；按灾害给不同指令（见 CLAUDE.md 规则矩阵）
3. 每条草稿必含：**是否适用于你**、**你该做什么**、何时再更新；行动不便者附加单独提醒
4. 渠道：按员工 `channel` 标注，紧急度高的外勤标注 sms+phone；不实际发送
5. Watch 阶段生成「预告」，Warning 阶段生成「正式」，取消时生成「更正」

## Agent 设计（Strands）
- 工具：`get_nws_alerts, get_forecast, get_river_gauge, get_roster, evaluate_rules, draft_notifications`
- 后端从工具调用结果中直接截取 `evaluate_rules` 的输出作为等级，**不解析 LLM 文字里的等级**
- Agent 只产出：理由段落 + 通知草稿润色；把工具调用轨迹返回给前端展示
- 模型由环境变量选择：Bedrock（`BedrockModel`）/ Anthropic（`AnthropicModel`）/ Akamai（OpenAI 兼容则用 `OpenAIModel` + base_url）
- 超时 30s 或出错 → 模板兜底，标注「模板生成」

## 回放模式（差异化亮点，也是 demo 保险）
- NWS `/alerts`（非 active）可查过去 7 天历史预警。Isaias 的 Watch → Warning → 过期全过程都在里面
- 回放 = 选时间点 T，把「T 时刻生效的预警」喂给同一套规则 → 拖动时间轴看等级和通知如何变化
- 这仍是真实 NWS 数据，不是 mock

## 前端
- 顶部栏：设施名 + 位置切换 + 模式（实时 / 回放：Isaias）+「重新评估」
- **建议总览**：大号等级卡（颜色）、置信度徽章、触发的阈值表（输入·来源·时间·阈值·超出量·依据）、「什么会改变」、理由段落 + 复制按钮、agent 工具调用轨迹（可折叠）、确认 / 推翻（推翻必填理由）
- **通知包**：已通知（分组、排序、每人草稿、渠道图标）/ 未通知（排除理由）
- **决策记录**：时间线，点开看快照
- 移动端优先布局；无登录

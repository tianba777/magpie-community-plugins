# Magpie Factory multi-agent 插件验证 — 2026-10-02

**当前目标版本 `0.1.5-fork.3` 保留 Factory 身份前缀和三种 API 格式适配，
移除两条客户端特征串替换；普通消息和工具返回文本保留原文。`.3` 的独立验证结果见下方。**
下文记录 `.2` 的历史验证：31 条模型路由全部 HTTP 200，三种 API 的真实
SSE 工具调用均通过。这些结果不能直接作为 `.3` 的实测证据。

范围为 Magpie 的 Factory 插件。上游基线是
`magpie-community/plugins@bd5e91ee00cd02d1f4293df2d95af1ceb303ecba`，
当前文档目标版本为 `0.1.5-fork.3`。npm 包名
`@magpie-community/opencode-factory-auth` 暂时保留，用于匹配 Magpie 官方迁移；
使用目标为多个 agent 共用的 Magpie 网关，不限定客户端。
历史 `.2` 独立环境验证如下；后续生产换装另行记录在用户的部署目录，未发布 npm 包。

## 当前 `.3` 补丁

在 Magpie 使用的 `auth.loader.fetch` 层保留三种 API 的请求格式适配：

- 三种 API 的系统提示以精确的
  `You are Droid, an AI software engineering agent built by Factory.` 开头。
- Anthropic 保留 `cache_control` 和块结构；Responses 将文本 instructions
  转成字符串；Chat 合并 system/developer 文本并放在首条字符串 system 消息。

`.3` 移除 `.2` 中的两条字符串标点替换，不按客户端名称或模型描述改写普通消息。
普通消息、工具返回文本、工具参数及 schema、工具 ID、图片/base64、
thinking/signature、Responses 的 function-call output 保持原状。
身份前缀、指令文本容器和 Chat 系统指令位置仍会改变，因此不宣称全部请求字节原样转发。
只处理三个 Factory LLM JSON 路径，未知路径和
无效 JSON 透传。重复整形不重复添加身份句。未知非文本 instructions 保守透传，
Chat 含非文本块的指令消息保留，避免丢失内容。

保留上一版的 GPT-6.1 Sol、Haiku 和 Opus/Sonnet 5.5 模型信息修复，以及取消信号、
二进制 view 偏移、即时 SSE 转发。整形后删除旧 Content-Length，让 fetch 重算长度。
账号认证、刷新流程、区域/模型路由和客户端版本号保持上游行为。

## 当前 `.3` 离线验证

- `bun test packages/factory`：**51 pass，0 fail，192 assertions**。
- `bun scripts/check.mjs`：**11 个包通过**。

验证三种 API 的系统指令适配，同时逐字段检查普通消息、工具结果、图片、
工具参数与签名内容保留。旧的两条完整特征串也保留原样，不再替换标点。
`check-factory-magpie-agents.mjs` 使用代表性 agent 提示词测试三个 API；
这不等于运行 Hermes、Claude Code 或其他 agent 客户端完整流程。

## 当前 `.3` 生产验证

已在现有 Magpie v0.1.604 网关换装 `.3`，保留正式迁移后的 `factory/<model>`
前缀、唯一账号、调用密钥、31 个显式模型选择、账号级台湾代理和原配置。

- 三组代表性提示词（Hermes、Claude Code、自定义 WorkflowAgent）分别走
  Messages、Responses、Chat：**9/9 返回 200 和精确标记**。
- 三种 API 的真实流式 `echo` 工具调用：**3/3 参数正确并正常结束**。
- 重启后 `.3` 仍生效，31 个模型选择保留，Haiku、GPT-6.1 Sol、DeepSeek 再次
  生成 `OK`，原配置和调用密钥保持一致。
- 原台湾出口为 TW，其他 8 个容器状态与本次基线一致。

脱敏证据：[factory-magpie-multiagent-live-20261002.json](factory-magpie-multiagent-live-20261002.json)。
这是模拟提示词兼容性验证，未运行各 agent 客户端的完整工作流；本次 `.3`
没有重测全部 31 条路由，`.2` 的完整扫描仍仅代表历史 `.2`。

## 历史 `.2` 离线验证

- `bun test packages/factory`：**49 pass，0 fail，189 assertions**。
- `bun scripts/check.mjs`：**11 个包通过**。

原有 16 项测试保留；整形用例验证三种 API 的格式、精确前缀、幂等、单对象
文本块、未知输入透传。请求用例用独立手写的 expected JSON 验证修改后的实际内容，
并覆盖工具/图片/签名保留、取消、二进制偏移、请求长度与即时 SSE。
这些统计属于 `.2`，当前 `.3` 的结果另列于上方。

## 历史 `.2` Magpie Docker 真实调用

使用与生产相同的 **Magpie v0.1.604** 镜像，创建独立容器、配置目录和调用密钥。
通过 `/magpie plugin add /test-plugin` 安装 fork，确认已登录且识别 31 个模型，
再显式选中全部 31 个。测试容器中的 `index.mjs` hash 与当时 `.2` 的源码一致，
记录在结果 JSON；该 hash 不代表后续 `.3` 源码。

只复制同一现有账号尚未过期的 access token，不复制或使用 refresh token。
全部请求经过实际 Magpie 网关，使用 `factory-plugin/<model>`，未调用内置
`factory/<model>` 路由。真实提示词为 `Reply exactly OK.`，输出上限 2048，
`stream: false`。Nikki 捕获测试容器到 `api.factory.ai` 经过台湾节点，出口地理查询为 TW。

| 路径/池子 | 路由数 | 真实结果 |
|---|---:|---|
| `/v1/messages` | 10 | 全部 200 且生成内容 |
| `/v1/responses` | 12 | 全部 200 且生成内容 |
| `/v1/chat/completions` | 9 | 全部 200 且生成内容 |
| Standard | 21 | 全部返回内容 |
| Droid Core | 10 | 全部返回内容 |

逐路由结果含 HTTP 状态、实际返回模型名、输出文本、延迟、镜像、源码 hash 和代理证据：
[factory-magpie-shaped-live-20261002.json](factory-magpie-shaped-live-20261002.json)。

**模型名例外：请求 `minimax-m2.7` 时，返回的是
`accounts/fireworks/models/minimax-m3`。** 该路由能生成内容，但不能据此证明
M2.7 本身可调用；尚未确定是 Factory 的别名、替换还是返回元数据问题。
其他路由也保留了原始返回名称，包括厂商命名空间及带日期的版本，便于核对。

### 流式工具调用

为三种原生 API 分别请求一次 `stream: true`，强制调用 `echo` 工具，参数为
`{"value":"magpie-check"}`。验证 SSE 增量形成完整工具参数、工具名正确、
正常结束且无 SSE error；不是只检查 HTTP 200。

| 代表模型 | API | SSE 事件数 | 工具参数/正常结束 |
|---|---|---:|---|
| Haiku 4.5 | Messages | 11 | 通过 |
| GPT-6.1 Sol | Responses | 13 | 通过 |
| DeepSeek V4.1 Flash | Chat | 30 | 通过 |

详见 [factory-magpie-stream-tools-20261002.json](factory-magpie-stream-tools-20261002.json)。
该检查验证工具调用生成与流式传输，不执行模型生成的工具，也不等同于完整多轮任务验收。

### 重启、基线对照与清理

重启独立容器后，全部 31 个模型恢复。用上一版基线相同的提示词及 **128 输出上限**
再次请求 Haiku、GPT-6.1 Sol、DeepSeek，三者均返回 200 和内容，结果写入上述 JSON。

上一版 `0.1.5-fork.1` **没有实现报告的核心请求整形**，31 个请求均为 403。
不能用该结果否定报告方法；此前据此给出的不可用结论已纠正。
基线保存在 [factory-magpie-live-20261002.json](factory-magpie-live-20261002.json)。

测试结束后删除本次临时容器、配置和临时凭据。生产容器 ID、镜像及账号/设置文件
校验值保持原状。结果仅证明本次账号、代理、Magpie 版本和时间下的上述调用，
不保证未来上游规则或其他账号的表现。

## 安装与复测

fork 位于 [tianba777/magpie-community-plugins 的 factory-transport-models 分支](https://github.com/tianba777/magpie-community-plugins/tree/factory-transport-models)。
Magpie 使用本地包目录；Docker 需挂载该目录并使用容器内路径。
新建独立插件登录时使用以下步骤：

```sh
git clone --branch factory-transport-models https://github.com/tianba777/magpie-community-plugins.git
magpie plugin add "$PWD/magpie-community-plugins/packages/factory"
magpie plugin login factory
```

已有内置 Factory 账号时，安装后用 `magpie plugin move factory` 正式迁移，
无需重新登录；客户端继续使用 `factory/<model>`。回滚命令为
`magpie plugin move-back factory`，会带回插件持有的最新凭据。
没有迁移的并存插件使用 `factory-plugin/<model>`。
多个 agent 按各自支持的 API 使用同一 Magpie 网关及 caller key，
请求路径为 `/v1/messages`、`/v1/responses` 或 `/v1/chat/completions`；
agent 无需持有 Factory 的登录凭据。

Magpie v0.1.604 在未显式选择时，较长列表默认展示前 24 个模型。
`magpie provider models factory-plugin all` 会清空显式选择并回到默认行为，
测试全部 31 个需要指定明确的模型 ID 列表。

网关检查脚本为 [check-factory-magpie.mjs](../scripts/check-factory-magpie.mjs)。
调用密钥通过 `MAGPIE_TEST_KEY` 环境变量提供，脚本不读取 Factory 登录文件：

```sh
MAGPIE_TEST_URL=http://127.0.0.1:3425 \
MAGPIE_TEST_PROVIDER=factory-plugin \
MAGPIE_TEST_MAX_OUTPUT_TOKENS=2048 \
MAGPIE_TEST_RESULT=/tmp/factory-magpie-results.json \
bun scripts/check-factory-magpie.mjs
```

`MAGPIE_TEST_MODELS` 可指定逗号分隔的模型 ID，未设置时逐一请求全部模型。
每条路由需返回内容才算成功；403、超时、空输出均使脚本返回失败状态。
`usable` 表示路由返回内容，不保证返回模型名等于请求名，应同时检查 `returned_model`。
流式工具检查脚本为 [check-factory-magpie-tools.mjs](../scripts/check-factory-magpie-tools.mjs)，
使用相同网关 URL 和调用密钥，可用 `MAGPIE_TEST_TOOLS_RESULT` 保存结果。
正式迁移后的两个脚本均设置 `MAGPIE_TEST_PROVIDER=factory`。

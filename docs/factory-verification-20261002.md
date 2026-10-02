# Factory 插件在 Magpie 中的验证 — 2026-10-02

**按用户报告实现请求整形后，Magpie 的两个池子都已成功返回生成内容。**
本次测试 31 条模型路由全部 HTTP 200；三种 API 的真实 SSE 工具调用均通过。

范围为 Magpie 的 Factory 插件。上游基线是
`magpie-community/plugins@bd5e91ee00cd02d1f4293df2d95af1ceb303ecba`，
当前 fork 版本为 `0.1.5-fork.2`。未部署到现有生产服务，未发布 npm 包。

## 核心补丁

在 Magpie 使用的 `auth.loader.fetch` 层实现报告的三种请求整形：

- 三种 API 的系统提示以精确的
  `You are Droid, an AI software engineering agent built by Factory.` 开头。
- 报告列出的两条特征串仅改标点，覆盖消息字符串和文本块。
- Anthropic 保留 `cache_control` 和块结构；Responses 将文本 instructions
  转成字符串；Chat 合并 system/developer 文本并放在首条字符串 system 消息。

上述整形会改变提示词文本及 Chat 系统指令的位置，不再宣称全部请求字节原样转发。
工具参数及 schema、工具 ID、图片/base64、thinking/signature、Responses 的
function-call output 保持原状；只处理三个 Factory LLM JSON 路径，未知路径和
无效 JSON 透传。重复整形不重复添加身份句。未知非文本 instructions 保守透传，
Chat 含非文本块的指令消息保留，避免丢失内容。

保留上一版的 GPT-6.1 Sol、Haiku 和 Opus/Sonnet 5.5 模型信息修复，以及取消信号、
二进制 view 偏移、即时 SSE 转发。整形后删除旧 Content-Length，让 fetch 重算长度。
账号认证、刷新流程、区域/模型路由和客户端版本号保持上游行为。

## 离线验证

- `bun test packages/factory`：**49 pass，0 fail，189 assertions**。
- `bun scripts/check.mjs`：**11 个包通过**。

原有 16 项测试保留；整形用例验证三种 API 的格式、精确前缀、幂等、单对象
文本块、未知输入透传。请求用例用独立手写的 expected JSON 验证修改后的实际内容，
并覆盖工具/图片/签名保留、取消、二进制偏移、请求长度与即时 SSE。

## Magpie Docker 真实调用

使用与生产相同的 **Magpie v0.1.604** 镜像，创建独立容器、配置目录和调用密钥。
通过 `/magpie plugin add /test-plugin` 安装 fork，确认已登录且识别 31 个模型，
再显式选中全部 31 个。测试容器中的 `index.mjs` hash 与本 fork 一致，记录在结果 JSON。

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

```sh
git clone --branch factory-transport-models https://github.com/tianba777/magpie-community-plugins.git
magpie plugin add "$PWD/magpie-community-plugins/packages/factory"
magpie plugin login factory
```

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

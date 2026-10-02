# Factory 插件在 Magpie 中的验证 — 2026-10-02

本次只验证 Magpie 的插件安装、模型配置和网关调用。上游基线是
`magpie-community/plugins@bd5e91ee00cd02d1f4293df2d95af1ceb303ecba`，
Factory 原包版本为 `0.1.4`，本 fork 为 `0.1.5-fork.1`。

结论：**插件成功加载，但当前测试账号的 31 个模型均被 Factory 返回
403，未生成内容，尚未实现可用的模型调用。**

## 实际修改

- 加入 `gpt-6.1-sol`，使用 Responses/OpenAI 路由，提供五档 reasoning
  effort，以及 1,050,000 / 128,000 的 context / output。
- 补齐 Haiku 4.5 的 200,000 / 64,000 限制；将 Opus 5.5、Sonnet 5.5
  的 context 改为完整的 1,000,000，output 保持 128,000。
- 保留 `Request.signal`，遵循显式 `init.signal` 覆盖（包括 `null`），
  已取消的请求不会继续发送模型请求。
- 用 `buffer / byteOffset / byteLength` 解析二进制 body view，修复
  DataView、Uint16Array 的 MiniMax M2.7 路由误选 Anthropic 问题。
- 增加通过 Magpie 网关运行的独立测试脚本；不直接调用插件的 fetch
  hook 作为集成验证。

保留原始请求内容、角色顺序、工具参数、图片及返回流；没有添加报告提出的
身份替换或特征串改写。GPT-6 temperature 配置保持上游行为，本次不宣称修改了它。

## 自动测试

`bun test packages/factory`：**36 pass，0 fail，138 assertions**。
原有 16 项测试保持不变，新增 20 项验证模型配置、取消信号、二进制输入、
请求内容保留及三种 API 的即时 SSE 转发。

`bun scripts/check.mjs`：**11 个包通过**。该检查只证明 hook 和配置加载正常，
不证明账号或模型可用。

## Magpie Docker 集成与真实调用

使用与现有服务相同的 Magpie **v0.1.604** 镜像，创建独立的测试容器和
配置目录。通过 `/magpie plugin add /test-plugin` 安装本地 fork；实际输出
`factory-plugin (Factory, 31 models) signed in as fork-test`。
`/api/plugins`、`/api/providers` 和 `/v1/models` 的读取结果确认安装路径、
插件提供者和模型目录。容器中的入口文件 SHA-256 与本 fork 一致，见结果 JSON。

测试目录只持有现有账号的 access token，不复制 refresh token，不执行刷新；
核对账号记录确认 access token 在此次测试期间尚未到期。
测试不使用内置 `factory/<model>` 路由，全部请求指定 `factory-plugin/<model>`。
真实提示词为 `Reply exactly OK.`，输出上限 128，`stream: false`。

Nikki 的连接记录确认测试容器到 `api.factory.ai` 的请求经过
`kiro-17-tw` 的台湾节点；出口地理查询为 TW。

| Magpie API | 模型数 | 结果 |
|---|---:|---|
| `/v1/messages` | 10 | 10 × 403，`permission_error` |
| `/v1/responses` | 12 | 12 × 403，`permission_error` |
| `/v1/chat/completions` | 9 | 9 × 403，`permission_error` |
| Standard 池 | 21 | 全部 403 |
| Droid Core 池 | 10 | 全部 403 |

逐模型结果、延迟、镜像版本、插件文件 hash 和路由证据保存在
[factory-magpie-live-20261002.json](factory-magpie-live-20261002.json)。
这些结果证明测试账号的上述请求遭到拒绝，不能确定具体原因是账号权限、
组织策略、客户端限制或其他上游规则，也不能推及所有 Factory 账号。
真实工具调用和生成内容的 SSE 尚未验证，因为没有成功的推理响应。

重启独立容器后，账号登录状态及全部 31 个模型恢复；再次调用 GPT-6.1 Sol
仍收到 403。测试结束后删除临时容器、配置与临时凭据；现有生产容器、镜像、
账号和服务配置保持原状。没有发布 npm 包或创建上游 PR。

## 复测与模型选择

Magpie v0.1.604 在未显式选择模型时，较长模型列表默认只展示前 24 个；
本次测试显式选择了全部 31 个。`magpie provider models factory-plugin all`
会清空显式选择并回到默认行为，应使用明确的模型 ID 列表；
Web 的等价操作是 `POST /api/provider/save`，body 为
`{"id":"factory-plugin","models":["模型ID", "另一个模型ID"]}`。

将本地包目录通过 `magpie plugin add /绝对路径/packages/factory` 加载后，
可复用 [check-factory-magpie.mjs](../scripts/check-factory-magpie.mjs)：

```sh
# MAGPIE_TEST_KEY 需已在环境中设置为测试网关的调用密钥。
MAGPIE_TEST_URL=http://127.0.0.1:3425 \
MAGPIE_TEST_PROVIDER=factory-plugin \
MAGPIE_TEST_RESULT=/tmp/factory-magpie-results.json \
bun scripts/check-factory-magpie.mjs
```

脚本每个模型发出一次真实请求，使用实际 Magpie 网关，不读取 Factory
登录文件；有模型未返回生成内容时以状态 1 退出，不能把 403 当作测试通过。

## 报告核对与来源

用户提供的报告没有附带逐模型原始请求/响应记录；其模型组计数、MiniMax M2.7
所用协议，以及非首位 system 消息的结果存在不一致，无法据此认定成功已复现。
本次 fork 不复制该报告的成功结论，以 Magpie 网关实测为准。

- [Factory 模型目录](https://docs.factory.com/models)
- [Haiku 4.5 限制](https://platform.claude.com/docs/en/models/haiku-4-5/overview)
- [Claude 模型规格](https://platform.claude.com/docs/en/models/overview)
- [GPT-6.1 Sol 规格](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [Magpie 插件提供者 ID](https://github.com/yetone/magpie/blob/v0.1.604/internal/provider/plugins.go#L34-L45)
- [Magpie 默认展示数量](https://github.com/yetone/magpie/blob/v0.1.604/internal/provider/models.go#L465-L502)
- [Magpie 显式模型选择](https://github.com/yetone/magpie/blob/v0.1.604/providers_cli.go#L446-L462)

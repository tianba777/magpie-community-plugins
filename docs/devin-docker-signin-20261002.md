# Devin 远程 Docker 登录修复 — 2026-10-02

版本为 `0.1.6-fork.1`，目标是 Magpie v0.1.604 的 Devin 社区插件登录。
原登录在容器内监听随机 loopback 端口，电脑浏览器访问自己的 loopback，
因而网站授权后无法把结果送回插件。此修复保留原浏览器及 CLI 登录方式，
在方法列表首位新增 `Devin (remote/Docker: paste callback URL)`。

## 实际改动

- 新方法返回 `method: "code"`，使用 Magpie 已有的验证码输入框接收完整
  回调 URL；仍使用 Devin 的 PKCE 流程及同一个授权/兑换 redirect URI。
- 不启动监听端口，也不访问粘贴的 URL；只从中取出校验后的授权码，
  向固定的官方兑换接口发送 POST。
- 校验 scheme、host、port、path、state 和唯一非空 code，拒绝 userinfo、
  fragment、重复 code/state 参数和其他流程的地址。十分钟过期；重复/并发提交同一码
  共用一次兑换，其他码被拒绝，错误不回显 URL、code、state 或 token。
- 认证格式、provider ID `devin` 和推理流程保持上游实现，因此现有认证
  记录保持兼容；npm 包名不变。

## 验证

- 新增回调测试：**27 pass、263 assertions**。
- Devin 全套：46 pass；Factory 回归：51 pass；合计 **97 pass、0 fail、511 assertions**。
- 全仓 `bun scripts/check.mjs`：11 个包通过。
- 测试使用本地 fetch mock 或依赖注入，没有真实账号和公网调用。旧的
  usage 测试要求临时 homedir，通过临时 Bun preload mock 隔离，未修改 HOME。
- 生产安装后，`POST /api/plugin-signin` 返回 `pasteCode: true`；无效回调
  被返回 HTTP 400 / `state: failed`，错误文案不包含提交的测试 code/state。
- 重启后新方法仍在，原 Factory 登录、31 个模型选择、调用密钥和设置保留。

- 用户已通过新入口完成真实授权，Magpie 保存了一个账号。
- 该账号使用独立的 Nikki 台湾线路代理，country.is 查询结果为 TW；
  Nikki 观察到 `server.codeium.com` 经台湾节点连接。
- 真实 `devin-plugin/swe-2` 请求返回 HTTP 200，`returned_model: swe-2`，
  生成文本为 `OK`。
- 登录后的容器重启保留账号、16 个模型选择及账号代理；重启后同一路由
  再次返回 HTTP 200、模型 `swe-2` 和文本 `OK`。

离线测试和无效回调测试与上述真实登录、推理验证分别记录；真实成功结果
仅覆盖本次账号、台湾代理和 `swe-2` 请求，不代表全部模型都已实测。
Devin 的 87 个模型是插件目录数，不是账号实际可调用数量。

## 使用

1. 在 Magpie 中进入 Devin 插件登录，选择新增的 remote/Docker 方法。
2. 在 Devin 网站完成授权，浏览器最后的 loopback 页面可以无法连接。
3. 把该页面地址栏的完整链接粘到 Magpie 的“验证码”框，点击“完成登录”。
   使用本次授权的地址，不能复用先前失败流程的链接。

现有 npm 插件与本地目录是不同注册项：先添加本地 package，再仅移除
原 npm spec，避免留下两份 Devin 注册。认证文件不需要删除，Factory
插件不需要迁移或重新登录。

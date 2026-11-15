# GSVI 实例配置

声明 `configurationProjection: "gsvi@1"` 并绑定 `speech:gsvi@1` 后，实例页可同时编辑业务配置和 Core 托管连接。这个投影只用于固定 GSVI 协议，不提供通用 HTTP 能力。

| 字段 | 用途 |
| --- | --- |
| `api_base` | 服务地址，可包含反向代理路径前缀 |
| `version` | `v1`、`v2`、`v4`，决定目录与合成协议 |
| `api_key` | Core 托管凭据，用于自动 Bearer 认证 |
| `request_headers` | secret JSON；大小写不敏感合并，显式 Authorization 优先 |
| `download_headers` | secret JSON；只用于下载 URL 的初始 origin |
| `timeout_ms` | 目录、合成和下载共用的服务总期限，至少 1000 ms |
| `text_lang`、`emotion` | 非秘密合成参数 |
| `prompt_text_lang` | 可空；空字符串不发送该字段 |
| `refresh_voices` | 保存时请求一次有界目录刷新，随后复位 |
| `preset.voice` | 新渠道政策使用的默认音色，可从缓存选择或手填 |
| `preset.max_chars` | 新渠道政策的 Unicode 码点上限，必须为正整数 |
| `preset.probability` | 新渠道政策的转换概率，0–100 |

端点、Key、两组 Headers 和刷新开关由 Core 管理，Worker 只收到语言、emotion 和 preset 等非秘密参数。secret 读取只显示是否已设置，省略表示保留，替换或清除需显式提交。

编辑实例绑定会为本实例建立独立服务，不覆盖其他实例。安装和保存停用实例不会请求上游；服务被其他配置引用时不能直接删除。

目录刷新在保存、启用或初始化时异步调度，不阻塞配置保存。实例或执行后端停用时跳过网络请求；后一次刷新会取消同一实例的前一次刷新。缓存按服务地址和版本区分，读取缓存不会发起 HTTP，没有缓存时仍可手填音色。

固定协议使用 `/models/{version}`、`/infer_single` 和返回 URL 下载。重定向时重新计算方法和认证；未知合成或丢失响应不自动重试。RIFF/WAVE 内容校验、RPC、Artifact 和调用期限继续生效。

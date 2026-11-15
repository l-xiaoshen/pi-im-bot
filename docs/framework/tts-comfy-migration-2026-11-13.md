# AstrBot 语音与 ComfyUI 迁移 — 2026-11-13

> Historical validation note: ${VALIDATION_DIR} is a placeholder, not a published location. Local logs, patches and orchestration inputs are not included in this Git repository.

来源/审核会话 （内部会话标识保留在本机）。实施为 NAS 本机默认模型单会话，无子 Agent。Core 基线 `bc9faa4bb040e5769567e8414895319e5944ad7f`；插件基线 `0313cb7a3eb452630d8d662a5db53ade64ff93ab`，进入时均干净。WSL 主会话独立审核、回修与普通用户提交。本文保留T审计/回修历史；T已独立接受提交，C于2026-11-14完成源码与离线验证，并经WSL主审核者复审、回修和独立接受。C补丁基线为接受T后的两个实际HEAD，见文末C交付节。

## 状态与约束

T：WSL主审核者已独立接受并提交。C：具名服务/资源、业务包、真实离线链路及文档已由WSL主审核者独立接受；源码阶段完成，未部署、未应用生产配置或旧数据。历史T收据保留，C收据全部在任务c目录。已读全局、workspace、两仓库及源目录适用规则，无发现目标目录 override；读 foundation 与 layering 文档及两仓库 API/迁移文档。

没有 root/sudo、容器修改、Docker 设置、正式状态转换、部署/push、QQ 发送、计费模型/TTS/Comfy 请求或模型复制。没有执行/扩展 Python。所有 HTTP 合成和模型请求仅访问自编本地 fixture。正式三份配置不可读，未绕过、未索取密码、未从容器读取。

审核者提供的 Bun SQLite readonly（包含 WAL、不用 immutable）脚本再次执行：17 项全局禁用记录中两个目标均不在，只能称“当前未全局禁用”。未据此推断每个 profile/渠道启用或 runtime 健康。旧 KV 未导出/应用，历史输出图片和对话正文未读/复制。

## 来源、许可与脱敏

完整逐文件 SHA-256/字节数见 [来源清单](tts-comfy-source-inventory-2026-11-13.json)。四个根分别为部署 TTS v1.4.1、部署 Comfy v2.4.2、维护 TTS 参考和维护 Comfy 参考。清单不含 cmd_config/正式配置、缓存、输出图片或模型；Python 仅静态阅读。

| 来源 | 作者/许可 | 使用方式 |
| --- | --- | --- |
| `gsvi-deployed-1.4.1` v1.4.1 | wsure；未发现 LICENSE，不推断许可 | 按 README 与协议独立编写 TypeScript；不复制 Python 实现 |
| `gsvi-reference-1.4.1` | wsure；同上 | 维护参考，与部署来源分别记 SHA |
| `comfy-deployed-2.4.2` v2.4.2 | lumingya，MIT，Copyright 2025 lumingya；WsureDev 维护 fork | 业务/协议只读审计后独立TS实现；MIT静态词库按NOTICE适配 |
| `comfy-reference-2.4.3` v2.4.3 | 同上 | 批交付修复参考，不能冒充部署 v2.4.2 |

部署持久 workflow 目录 `source:comfy-workflows`：19 个 JSON（含 6 个 .lora.json）。逐文件只读解析并统计 URL、疑似宿主绝对路径、秘密字段候选，当前自动检查均为 0；未把正文或 manifest 复制到 Git/模型。该自动统计不是未来导入的安全批准，C 仍须按允许字段/节点重新验证、剔除/替换潜在秘密、签名 URL 和宿主路径，保持原文件不动。无宿主模型目录扫描。

## T 行为矩阵

| 部署 v1.4.1 行为 | 本轮实现与可验证边界 |
| --- | --- |
| /usetts 状态、on/off、引号音色/正整数/0–100、实时 list | 全部实现；status/off 不调用上游；错误不覆盖政策；on 首次校验音色与情绪 |
| 新渠道默认关闭、首次复制预设 | 实现；已有 A voice.json 优先作为未初始化音色，永不据此开启自动语音 |
| 群共享、跨 /new 与重启 | 使用原实例/聊天私有数据；不按群成员建 Persona；不增加 KV/数据库 API |
| 源来源约束 | Core producer 识别 final、计划/后台 Agent、明确 Agent 通知；插件/普通指令/control/unknown 不转换 |
| 整条纯文本、Unicode 码点、一次概率 | trim 后按 Array.from 计数，0/100 不抽样，中间概率一次；完整逻辑回复一次决策；不是模型 delta |
| 任意非文字整条跳过 | 当前出站文本+Artifact 中任一附件整条跳过；现 API 没有结构化引用/mention/forward，不虚构覆盖；未来扩展必须标 mixed |
| 发送副本与失败回退 | rawReply/Pi 历史保留原文字；已知失败保留原文；未知合成不重提，只交付一次文本并保留 outcome_unknown |
| 主会话与后台独立 | 呈现受理后主 run 完成，后台合成；委派 Agent 自有结果可独立呈现；唯一 Outbox 所有者 |
| 同步工具 ACK | chat_send/插件 delivery.send 保留真实 ACK 并跳过自动语音；新 chat_present 显式返回 delivered:false/jobId 或真实 ACK |
| 修改运行中政策 | 已持久决定固定音色/参数/概率，后续 /usetts 只影响新决定；stop/new/切换/权限与绑定撤销取消待呈现 |
| 旧运行时 monkeypatch/二次推理 | 不迁入；Pi 继续负责请求级 fallback、工具循环、压缩和历史 |
| 旧配置与 KV | 正式文件不可读且未更改；导出转换仅提供可审查 dry-run，不自动应用 |

完整 Core 契约见 [受管呈现](../plugins/managed-presentation.md)。呈现计划保存在 Outbox，含 Core 固定接纳快照；Job request 幂等衔接避免保存决定后重复抽概率。Job dispatching 检查点阻止中断后重发无 receipt 的 GSVI POST。发送完成、部分、未知、suppressed/cancelled 沿用原账本；停止覆盖 plan→admission 窗口。根 run/UI 与 Agent 工具明确区别 accepted 和 sent。

## C 已审计范围与待实施矩阵（T阶段历史，当前以文末C交付为准）

| 已部署功能/源位置 | C 迁移决策与缺口 |
| --- | --- |
| workflow 目录/静态模型，workflow_info.py；usage/workflows/txt2img | Bot 具名 Comfy 服务与受管 workflow 快照；只读 catalog/usage，不增加 LLM。尚缺资源登记、输入输出/参数绑定和允许变换 schema |
| /画图、/画图no、workflow 选择、步骤覆盖 | 同 operation 的工具与命令入口；真实 API-format 编译由模板绑定驱动，不能逐 workflow 硬编码 Core。命令负词/步骤节点等解析待迁移 |
| LoRA 名称/禁用/触发词选项/默认清除 | 源有本地名称解析、禁用文件及 !clear_defaults、选中提示词注入；迁移优先已有显式 MCP、Comfy object catalog 或脱敏 manifest；不得给 Worker host scan path |
| 负词合并、随机 seed/noise_seed、多图 1–16、批次 | 静态默认与请求负词合并、种子/节点覆写、每次实际提交独立项；尚缺版本化参数编译、批部分提交/部分结果恢复账本 |
| 敏感词 none/lite/full、白名单、冷却、管理锁 | 权限由 Core 可信 actor 与范围决定，不能用昵称/Mock ID 管理员；实例范围动态锁需要最小命名空间 CAS/版本/额度状态（公共 pi-durable doc），T 未先造通用 KV |
| comfy_history 群共享持久开关 | 源 channel_state.py 用 history_channels.json；迁移状态生命周期与业务历史/模型投影分层，跨 /new 保留。正式旧文件不自动改 |
| comfy_record 最近20条实际提交 JSON，list/pop | 源记录 /prompt 前 payload，失败尝试也占位；FIFO pop，重启清空、不同于历史开关。迁移时业务记录与核心审计分离，不能将记录当作成功回执 |
| /prompt → prompt_id → /history/{id} → /view | POST 不可盲重放；Bot 须持久保存所有者/原服务/模板与参数版本/远端 receipt/未知状态，Worker 丢 checkpoint 仍能按 Core 原 receipt 恢复。T 的 GSVI 没有远端 ID，不能冒充解决此协议 |
| 输出校验与下载 | 只读本任务 prompt_id 所属输出；严格 file/subfolder/type、来源、体积/MIME 校验，不能 Worker 任意 URL 或宿主文件 |
| 取消 | 不得全局 /interrupt；仅确认本任务排队 ID 时准确 delete；运行中无 per-prompt 取消则仅停止本地等待并保留未知/待核对 |
| 维护2.4.3批交付修复 | _start_batch_delivery 用独立任务避免依赖调用方流水线；可参考其意图，不搬 Python 后台任务。新实现用 Core Jobs/Outbox，部署仍是2.4.2 |

C 不执行真实 POST、上传、delete、interrupt 或生产 GPU 任务验证。后续必须自编假 Comfy 完成 receipt 丢失恢复、批次部分交付/取消、workflow/manifest 脱敏导入、实例状态及真正可信管理鉴权测试；完成后再整体分层复审。

## 验证和交回

本节记录最终检查、离线 UI 和从固定基线回放补丁的收据。临时目录 `${VALIDATION_DIR}`；正式 dist 不改。没有本地提交，HEAD 保持指定基线。

### 第一轮草稿验证收据（未获接受，以下回修收据优先）

| 检查 | 结果 |
| --- | --- |
| Core `bun run check`、`bun test tests`、`WEB_DIST_DIR=${VALIDATION_DIR}/web bun run build` | 通过；161 tests / 1186 assertions / 0 fail |
| 插件 `bun run check`、`bun test tests`、`bun run build`、`bun run format:check` | 通过；28 tests / 311 assertions / 0 fail |
| T 新增真实链路 | 12 个插件行为组；另1个 Core 呈现账本回归，未新增数据库测试 |
| 附加既有回归 | 原160 Core及16插件测试继续通过；含状态插件、显式语音、media-inspect、来源传播与控制受理边界 |
| 包 | gsvi-tts/status/media-inspect 各 pack 两次，逐字节相同；精确 bytes/SHA 在 package-verification.json |
| UI | 共享 CDP，实际 createChatView + 隔离假数据；受理不显示发送成功、待呈现时停止可用、模拟ACK后显示已确认发送。两张截图与 ui-verification.json 留档；只关本任务 page，临时服务已结束并核实端口关闭 |
| 导出预检 | 自编非秘密 fixture 跑 migrate-gsvi.ts：dryRun:true/applied:false，不打印目的地ID，不读/写正式KV或配置 |
| 补丁回放 | core-final.patch / plugins-final.patch 含所有新文件；replay.ts 从各指定基线 git archive 解出后 git apply --check/apply，完整文件集合与逐字节 SHA 比较相等；无需 index/提交/安全策略修改 |

核心改动集中在可信 Delivery View、Outbox 呈现接纳/恢复、Job 结果回到原交付所有者、operation actions/data:none、Agent 通知入口及 UI。待呈现查询使用单独的 pendingPresentations，不受普通 Outbox 最近200条 UI 投影截断，避免旧待呈现决定越过 stop 或启动恢复。插件改动集中在 gsvi-tts 的 policy/automatic 模块，及只读来源/迁移文档与 API 快照；没有引入依赖或新的生产执行后端。

精确改动路径与最终源码 SHA：`${VALIDATION_DIR}/core-final-changes.json`、`plugins-final-changes.json`；完整源码文件集合见 `core-final-files.json`、`plugins-final-files.json`。补丁、包、日志与回放收据的 SHA-256 在同目录 `SHA256SUMS`，避免报告自引用摘要。`replay-verification.json` 证明从两固定基线回放为最终源码；一个累计补丁构成本轮 T 的可回放阶段，后续审核回修应追加新阶段，不能覆盖已被审核引用的版本。

### 限制与下一步

T 交回独立审核，尚未部署，正式后端/凭据/旧KV未转换。同步 chat_send/插件 delivery.send 采用真实ACK原文契约，新 chat_present 承接受管异步语音。当前无结构化出站 mention/引用/forward，只能验证现有完整文本+Artifact 契约；未知来源一律跳过。GSVI 没有远端句柄，因此未知结果不能自动核对或确认远端取消；采用一次文本回退并保留未知任务状态，不接受迟到音频。

C 仍待 T 独立接受：资源/schema/LoRA编译、实例状态与可信管理、/prompt持久receipt恢复、严格输出验证、批部分结果和精确排队取消均未在本轮实现，详见前述矩阵和插件工作区 `docs/migration/comfyui-pro/MIGRATION.md`。C 完成后再整体分层复审。两个仓库 HEAD 未改变，无本地Git提交、push、部署或生产操作。

服务预算边界：政策字数为正整数，不额外限制初始化阈值；实际 GSVI RPC 继续沿用 A 的 2000 UTF-16 单元输入和 16 KiB 请求预算。超出服务输入契约时按已知本地拒绝保留整条原文，不切片合成，也不把校验拒绝冒充远端未知提交。Unicode 政策统计仍按码点。

## T 第一轮独立审核回修

三项均复现后回修，C 源码未开始、来源审计仍有效。首轮草稿补丁/校验清单保留于任务目录 round1-draft/；新的累计补丁替代未提交草稿，同时保留 round2 相对首轮的增量补丁供连续审查。

| 审核问题 | 回修与证据 |
| --- | --- |
| JobActivity 全局容量已满导致成功正文丢失 | JobRequests 持久存储结构化明确拒绝；原 Outbox 封存 renderFallback 后发一次原文。全局/范围/每run三组均断言 run completed、rawReply 原文、零POST、无renderJobId；清配额后重启不再发送。拒绝响应丢失也复用原拒绝回执 |
| 未知接纳不能笼统回退 | 一般异常经当前取消/授权复核后保留待核对，run completed + presentation unknown；工具回执含 admissionUnknown/outboundId。原键已接纳时，即使当前容量满仍返回同一Job，原POST仅一次；原键已拒绝时恢复原文。取消/撤权发生在拒绝响应之后的回归确认不晚发 |
| 1 Worker 在途语音阻塞 off | maxWorkers=1 接纳前保存 worker_capacity 拒绝，零POST；SDK容量元数据显示上限0，/usetts 明示至少2 Worker。未暗增总槽或内存。max2 串行 stateless，保留前台活动余量；max4 两POST明确正在等待时跨范围/冷范围 off 全部通过，实际创建的 Worker 峰值不超过4；空闲回收后政策读取继续通过 |
| 无Hook也枚举全部能力 | 无消费者零额外鉴权。选择器显式 inspectCapabilities 最多16项；TTS只声明两项。100/500/1500目录基准均与目录无关：无消费者0次；真实Worker消费者5次总鉴权（含Hook前后检查），RPC诊断2项，撤权后1项。冷Worker启动约49ms、热调用约1–3ms，性能断言用次数/载荷而非脆弱耗时门限 |

审核者的 review-render-capacity.ts 早期2 Worker实验未满足“两次POST正在等待”前提，不作为双任务饥饿复现证据。本轮 max4 测试独立明确验证两次POST前提；max2 设计上只允许一个 stateless 活动合成，第二Job等待，不混淆两种情形。

同步 chat_send 的真实平台ACK、普通scope私有状态隔离、rawReply/Pi历史、已持久概率/未知GSVI不重POST、取消/撤权、部分/未知交付及父run/Job状态沿用原契约。受理拒绝和未知服务执行是两个阶段：后者已有Job所有者且按原协议保留 outcome_unknown；前者没有Job时只核对原请求键，不提交新的呈现意图。详细限制与调用格式见 managed-presentation.md。

第二轮最终检查、包与回放精确收据见任务目录 round2-*.log、package-verification.json、replay-verification.json 和 SHA256SUMS；无新增依赖或数据库测试。正式配置/容器/服务状态与sandbox权限均未修改，原基线HEAD不变。

### 第二轮最终验证收据

- Core check/tests/build（隔离 WEB_DIST_DIR）通过：162 tests，1210 assertions，0 fail。
- 插件 check/tests/build/format 通过：37 tests，399 assertions，0 fail。首轮161/28回归全部保留；新增的1个Core计数/载荷基准、9个插件受理/容量行为组均使用自编本地fixture，无新增数据库测试。
- max4明确两POST等待的实测 Worker峰值为4，三个范围off耗时约8.37/8.24/57.26 ms，均在1秒指令预算内；max2只一个stateless活动合成，第二Job等待；max1在POST之前持久拒绝并显示容量诊断。不是“同一配置两POST饥饿”的误报。
- 共享浏览器实际聊天组件验证 accepted 与未知接纳均不显示已发送、pending期间停止可用、模拟真实ACK状态后显示已确认发送；任务page和临时HTTP进程已清理。ui-accepted/ui-unknown/ui-confirmed.png 与 ui-verification.json 留档。
- gsvi-tts/status/media-inspect 各构建并pack两次，字节一致；包摘要见 package-verification.json。docs/plugins 与插件SDK快照已同步。
- 新累计 core-final.patch / plugins-final.patch 从两指定基线完整回放相等；round1-draft 原补丁 + core-round2.patch / plugins-round2.patch 连续回放也相等。精确文件集合/新增文件/源码SHA、补丁及包SHA在 final-*.json、replay-verification.json、round2-sequential-verification.json、SHA256SUMS；所有Git元数据均只读。

T 再次交回独立审核，未自行宣称已接受。C 只读审计及原来源记录保留，尚未开始C实现；本次不提交、不部署、不修改正式配置/既有容器/真实上游或sandbox权限。


## 当前 T2：隔离/调度分类与非 render 载荷（第三次交付）

前一轮 quota 拒绝原文交付、prepared fallback 无 parent Run 重启两项独立验收结果已保留。本轮另修复单 Worker 合法 foreground + data:none 被错误计入后台预算，以及没有 render 仍复制完整恢复快照的问题。Core/插件HEAD仍为本文最初两个指定基线；第二次累计补丁和收据保留于任务目录 round2-draft/，本轮交付新的累计补丁及 round3 增量。

| 当前契约 | 实现与验证 |
| --- | --- |
| 数据隔离与执行预算独立 | Core 读取固定操作的 execution、真实 Job/观察上下文和父调用调度类别；不使用插件业务字段或 SDK origin 选预算。background 父调用的 foreground 依赖仍受后台预算限制。data:none 只决定无私有卷，foreground 可用单 Worker；后台无数据仍最多 maxWorkers-1 |
| 解析、重入与清理 | 操作解析器保留关联操作的数据隔离，前台解析不被误判为后台执行。Core 与 manager 使用一致实际隔离 Worker key 检测重入；T阶段曾共用无数据scope串行锁；C第二轮已改为可信前后台lane独立，仍共享原总预算。单 Worker 取消后排队前台调用能在清理完成后继续，实测容器峰值1 |
| noData 文件边界 | 有并发scope Worker持有自编私有文件时，foreground与background的noData操作均在Core拒绝 artifact.publish，两个隔离Worker计划均无/data挂载。独立file-boundary脚本继续 privateDataExposed:false |
| 容量诊断字段 | SDK 改为 invocation.limits.backgroundStatelessConcurrency，精确表示后台无数据上限。原 statelessConcurrency 名称不再使用，避免把0误读成前台noData不可用；语音状态回执已同步 |
| 惰性呈现接纳 | DeliveryPresentation.captureAdmission 小回调只在真正选中允许发送的异步render时调用一次；普通/同步/跳过/混合附件/隐藏结果不保存renderAdmission，也不为呈现创建配置快照或克隆原input。已有render恢复只读原快照，不重选或再捕获 |
| 非render性能 | 独立review-no-render-payload：1500项能力、普通文字，hasRenderAdmission:false，snapshotCalls:0，outboundBytes:602；自编回归统计原input克隆0次、603字节（ID长度不同）。断言为无快照、调用次数及字节上限，不依赖耗时 |
| 正常Hook与恢复 | 真实visibility/text/sync/receipt仍执行；登记的持久receipt观察器可为自身任务保存必要快照，与renderAdmission独立。真实render的明确拒绝、接纳未知及发送前重启回归继续通过；捕获一次、复用原权限/版本与原Outbox |

### T2 最终验证

- 六个有效独立脚本全部通过：review-stateless-foreground、review-stateless-file-boundary、review-render-capacity-one、review-capability-cost、review-render-admission（含无parent Run prepared恢复）、review-no-render-payload。逐脚本日志与机器断言见 round3-review-*.log、round3-review-verification.json。没有重跑无效旧2 Worker脚本。
- Core check/tests/build（隔离WEB_DIST_DIR）通过：168 tests / 1259 assertions / 0 fail。新增4个执行预算/隔离行为组、2个非render载荷/真实Hook行为组；无数据库测试。
- 插件 check/tests/build/format 通过：37 tests / 399 assertions / 0 fail。gsvi-tts/status/media-inspect 各pack两次逐字节相等，包SHA见 package-verification.json。
- managed-presentation、async-and-data 与 SDK快照已更新；插件 docs/migration/README.md 的旧自动TTS属于C backlog句子已更正：T实现待接受，C仅审计，后续仍需实做。C来源及workflow审计未改。
- 新 core-final.patch / plugins-final.patch 含新文件，从两指定基线完整回放等于最终源码。round2-draft累计补丁 + core-round3.patch / plugins-round3.patch 连续回放同样相等；收据为 replay-verification.json、round3-sequential-verification.json，SHA在 SHA256SUMS。没有Git元数据写入。

本轮没有产品UI布局/交互修改，上一轮共享浏览器的accepted/unknown/ACK证据仍适用；本轮语音容量回执由真实Worker/RPC离线测试验证。没有正式配置、既有容器、生产调用、模型、sandbox权限或部署变更，也没有提交Git。T再次交回主审核者独立接受；C实现仍待T独立接受后接续里程碑。

## WSL 主审核者独立接受 T

主审核者复核实际源码及回放收据，并以普通用户独立运行六个有效边界脚本、Core check/tests/build、插件 check/tests/build/format 和三包双次 pack；结果为 Core 168 tests / 1259 assertions、插件 37 tests / 399 assertions、零失败。日志位于任务目录 reviewer-final/ 与 reviewer-final-checks.log。另验证快速合成在父 Run 活跃时等待报告，父 Run 完成后 Run/Outbox/Job 同为 sent，无晚到 accepted 覆盖。

已确认修复：明确受理拒绝正文不丢、无 parent Run 的 prepared 回退重启、控制响应/后台预算、前台无数据隔离与嵌套继承、无消费者零逐项鉴权，以及非render无快照/输入克隆（1500能力样例42274→602字节、快照调用0）。已有取消、撤权、未知提交不重POST和真实平台ACK契约保留。

T 源码阶段接受不代表部署或两个迁移完成。C 仍须实际实施并独立审核；正式配置、旧KV、生产容器和真实上游均未变更。接受后的确切提交与最终包摘要见任务交接和 accepted-t.json，避免报告自引用提交哈希。

## C 源码与离线交付 — 2026-11-14，待主审独立接受

C实际起点Core `b3e9097ca167693264c21abf1ee82b960bfe453b`、插件 `9995e8bb9524d5cd6cb5e84a985901d40ca53cd5`，进入C时两仓库干净。当前HEAD仍为上述值；没有本机Git提交。最初bc9/0313只属于T历史，不用于C补丁。T接受收据accepted-t.json及旧补丁完全保留。

### 已实现的交付

- 可安装构建的comfyui-pro：manifest/schema/README/MIGRATION/MIT/NOTICE/Zod许可、词库、usage和自编模板示例；没有复制Python实现、真实模型/历史图/对话。完整源业务与差异矩阵在插件MIGRATION，部署来源仍为2.4.2，2.4.3仅批交付修复参考。
- Core具名comfy@1：正常资源表单/HTTP/实例绑定，凭据仅Core。受管API-format图、内容摘要、允许参数/编码/偏移、模型/LoRA声明；插件不传宿主路径或URL，不硬编码每个workflow业务。真实13workflow+6sidecar只读dry-run，输出待operator审查候选在c/import-proposals，未自动应用、未GPU验证。
- 业务：usage/workflows/txt2img适配、画图/画图no两格式；-n为负词、-c为次数；workflow选择、每workflow/node步骤覆盖；LoRA保留默认/空槽/禁用/去重/容量拒绝/明确触发词与注入开关；负词合并、随机seed、1..16批；scope政策、敏感级别/白名单/冷却、可信管理instance锁和history、ring20/FIFO pop完整JSON导出。
- Core使用pi-durable最小instance/scope CAS、版本/额度和回执登记原子标记；没有暴露数据库或跨实例数据。Comfy逐item写前登记原服务/模板/参数摘要/请求Artifact；Core保存prompt_id后才回Worker。恢复不依赖Worker handle，未知不重POST。原服务A/B、凭据/权限撤销、精确排队delete转running竞态与abandoned事实核对均有实际离线证据；不提供interrupt。
- Job的businessStatus/factsComplete/items与delivery分离。部分成功仍有未知项保持outcome_unknown，可手动核对原事实/Artifact，不重发原Outbox。typed forward由adapter翻译，真ACK/分part账本保留；未知forward不fallback重发。Artifact/forward整条mixed，保留TTS跳过与rawReply/Pi历史。
- history开关是公共model.history@1请求投影：直接generate及实际start_job归属过滤，Worker不拿原始历史；无匹配大历史不深克隆。真实Pi on/off各2调用验证，不是空bool；原审计/用户输入/提交receipt和已压缩摘要不会被删除。不迁入旧二次LLM/monkeypatch。
- 网络和资源预算由Core持有：HTTP全局4/每服务2，下载2跨保存阶段，目录分页不扩大512KiB RPC帧。data:none/可信调度分离、前台预留容量、惰性renderAdmission、按消费者权限诊断、stop/control边界全部保留。pending presentation部分索引DDL与查询谓词一致，仅核对源码，无新增数据库测试。

### 离线验证收据

| 检查 | 本次结果/证据（任务c目录） |
| --- | --- |
| Core check/tests/build | 通过；175 tests / 1310 assertions / 0 fail；WEB_DIST_DIR=c/web，正式dist未改；core-check/tests/build.log |
| 插件docs:sync/check/tests/build/format | 通过；63 tests / 645 assertions / 0 fail；docs-sync、plugins-check/tests/build/format-check.log |
| T有效独立脚本 | 六个全部exit0；stateless foreground/file-boundary、render-capacity-one、capability-cost、render-admission、no-render-payload；t-review-verification.json。未重跑无效旧2worker脚本 |
| 真实C链路 | 双图和count16全部ACK、部分未知手工核对、同进程丢RPC/无handle核对与取消/重启、原服务快照、queued/running/delete竞态、stop/new/撤权、未知提交不重提、恶意路径/MIME/体积、每key12并发只一份输出、CAS/冷却、ring20/pop与receipt分离、源LoraManager/steps及合法大目录分页，均由自编fixture实际执行 |
| 模型/媒体 | Pi直接工具及start_job history on/off真实后续请求、原审计保留/无额外LLM；无匹配2MiB历史共享引用；可信Agent纯文字typed forward在Mock降级前mixed，自动TTS零POST；OneBot作者自编socket未知forward仅一次动作 |
| 管理UI | 共享CDP实际资源/插件配置/任务组件；导入、创建/掩码编辑服务、实例绑定、partial+unknown和真part回执；ui-verification.json及三张截图。任务page已关闭，两个临时HTTP端口已确认关闭 |
| 依赖 | 新workspace仅复用既有zod4.6.7/MIT，无新增第三方版本；锁文件新增workspace登记，offline frozen-lockfile校验通过。初始在线锁解析因代理403未完成，随后只登记本地workspace并离线验证，不改系统代理 |
| 发布包与回放 | comfyui-pro/gsvi-tts/status/media-inspect四包各build/pack两次，逐字节比较见package-verification.json；新包解包检查静态资产/许可/schema/入口。C累计core-final.patch/plugins-final.patch、完整源码SHA与T实际HEAD回放收据在c目录，SHA256SUMS汇总 |

### 限制、差异与分层复审

正式root0600配置/旧KV/管理员和群映射均未自动读取或应用，源13图仅转换候选，生产节点/模型/GPU兼容性未验证。不能把源码检查、离线fake和UI组件验证等同生产启用或部署。原件SHA与摘要保留，不把真实workflow正文/LoRA sidecar带进Git。

取消运行中prompt只能停止本地等待，无法确认GPU取消；未知无ID只能保留事实。手动核对没有发送所有权。平台仍有总媒体20MiB等预算；目录和完整JSON用scope Artifact，不把大结果塞模型。C第一稿的同scope无数据串行设计已被独立复审拒绝，第二轮以可信前后台lane/key分开；Comfy管理/catalog可使用预留前台容量，data:scope与同lane继续串行。Core stop/new和T语音容量/隔离边界保留。没有任意HTTP、宿主scan、upload/img2img、WS输出、跨服务接管或通用效果DSL。

源测试/宿主写配置/重绘控制标签等入口在MIGRATION明确适配或不公开；Pi按需用typed tools发新请求，不盲重放未知旧提交。history off不擦除审计；停用Hook会停止模型投影。动态业务设置影响新准备决定，已有任务保留原参数；撤销/停止走Core。

整体分层复审草稿见 [T/C后分层草稿](review-layering-c-2026-11-14.md)，列已补的Bot/Plugin契约、实际证据和真实剩余缺口。C代码交回WSL主会话独立审核、回修与普通用户Git提交，尚未自行接受；无root、生产容器/配置/服务变化、真实上游写操作、push或部署。

## C第二轮独立复审回修 — 待主审接受

C第一稿未获接受，原完整补丁/源码清单/检查/包/UI/回放收据已按SHA验证后保存在 `c/round1-handoff/`：core d8e081e74156fd325949e7731c1102f00a56757a183f285be1c55737a29b8436、plugins f05956794156bafaaa4e4b5e652efeec45837e8c9a3a823958ed8bbdbb6a05b7。C补丁基线仍为接受T的b3e9097/9995e8b两个实际HEAD，没有Git提交或元数据变更。

| 确认问题 | 本轮修复与实际验证 |
| --- | --- |
| pending手动核对清空已有partial结果 | Core外部结果合并保留无新result时的旧结果；按item保留已确认终态和Artifact引用，未解决事实保持outcome_unknown。finish/cancel/recover/reconcile相同入口均复用；JobFacts用合并后事实刷新，不恢复自动等待/交付。真实包两阶段review：local stop后1图+unknown → pending查询仍1图/factsComplete:false → 完成核对2图；始终2 POST、0新增聊天 |
| 同scope无数据后台锁抵消前台余量 | Core可信execution进入无数据Worker key与scope锁，前后台各lane、同lane串行，共用原maxWorkers/内存/排队预算。nested背景继承和实际key重入一致；data:scope不分lane，Validators独立。真实包max2/max4在假服务POST等待时usage/catalog/授权管理解析器+操作均在1秒预算内响应；前台空闲回收后冷启动仍通过，容器峰值<=配置上限、Comfy无数据Worker无/data挂载 |
| 保留取消、隔离和T边界 | Core stop/new仍先封存交付；释放假HTTP响应及重启不复活取消任务。noData私有文件发布拒绝、maxWorkers1前台合法/自动TTS POST前拒绝、后台依赖不能升格、scope私有数据串行均有真实Worker回归；没有增加业务Worker/内存预算 |

最终规定检查通过：Core check、178 tests / 1333 assertions / 0 fail、隔离c/web build及format:check；插件docs:sync、check、66 tests / 709 assertions / 0 fail、build、format:check。新增测试使用memory/JSONL和自编服务/FixtureBackend，无新增数据库测试。原source LoRA/-n/empty/incomplete语义、16 POST/Artifact/ACK/part与0模型调用、typed forward mixed/0TTS、T六条有效脚本继续通过；11个有效review脚本日志/exit码见round2-review-verification.json。

UI没有新产品布局；共享CDP真实Job组件+实际reconcile路由验证pending仍显示partial/未知提示与1个产物，完成后显示2个，原聊天消息数不变，未伪造ACK。任务page和临时服务监听已清理；round2-ui-verification.json及两张截图留档。上一稿资源/实例绑定UI证据保存在round1-handoff。

四包两轮build/pack、解包完整性及字节一致收据更新为package-verification.json。API文档与SDK快照已同步。新C累计core-final.patch/plugins-final.patch从T实际HEAD完整回放相等；另有core-round2.patch/plugins-round2.patch相对第一稿增量，以及T基线→第一稿累计→第二轮增量的连续回放证明round2-sequential-verification.json。完整源码集合/新增文件/SHA与SHA256SUMS在c目录，第一稿与T旧收据不覆盖。

不再将“同scope无数据前台必被后台阻塞”视为可接受设计。前后台可在总预算内并发；同lane或data:scope同scope长调用仍串行，总容量被其他前台业务占用时不承诺无条件延迟上限。Comfy业务和原范围约束不扩展；正式配置/旧数据/凭据/后端/容器/模型均未应用或变更，无真实GPU/TTS/QQ/付费模型请求、sudo/root、push/deploy。新稿再次交回主审核者集中独立复审与普通用户提交，尚未自行接受。

## WSL 主审核者最终接受 C

主审核者独立复测11个有效T/C边界脚本、Core check/tests/build、插件check/tests/build/format，以及四包双次pack：Core 178 tests / 1333 assertions，插件66 tests / 709 assertions，均零失败。日志为任务c/reviewer-final/及reviewer-final-checks.log。P1 pending查询抹除partial结果和P2同scope无数据后台阻塞前台均已复测通过，包含最终补齐两图、总POST不增加、群消息不再发，以及真实预留前台容量。

最终整体分层结论见 [独立分层复审](review-layering-final-2026-11-14.md)。Pi/Bot/Plugin职责保持；当前两个闭环未发现剩余阻塞问题。插件生命周期/状态迁移、插件拥有的订阅与计划、完整有效编排诊断和通用效果/资源声明等列为后续真实迁移需求，不当作已实现API。

主会话完成普通用户Git提交与最终SDK快照同步。确切提交、最终包SHA及完整源码回放以accepted-c.json、accepted-replay-verification.json和最终SHA清单为准；此前final-checks.json等交回稿保留历史结果，不能覆盖本节及最终接受收据。没有生产配置/旧状态应用、root、容器或服务修改、真实上游请求、push或部署。

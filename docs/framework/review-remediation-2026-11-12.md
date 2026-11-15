# Pi Bot review remediation

> Historical validation note: ${VALIDATION_DIR} is a placeholder, not a published location. Local logs, patches and orchestration inputs are not included in this Git repository.

Source session: （内部会话标识保留在本机） (WSL reviewer).
Task: `pi-review-remediation-20261112`.
Core: `../pi-im-bot`. Plugins: `../pi-im-bot-plugins`.
Scope: offline implementation review. Local orchestration inputs are not published.
Date: 2026-11-13 Asia/Shanghai.

Status: pass2 failed independent review; round 1 corrections are implemented and locally validated, awaiting re-review. Both baselines are established. Core/plugin repair commits are performed by the independent reviewer over ordinary-user SSH under the user's existing authorization. No protected-metadata write or security-policy change was attempted during this review round. No deployment or container change was performed.

The requested record at `.codex/handoffs/pi-review-remediation.md` could not be updated: apply_patch returned `patch rejected: writing outside of the project; rejected by user approval settings`. That existing file remains unchanged. This ordinary documentation path is the alternate durable task record; no protected directory or security policy has been modified.

## Rules and scope

Read `本机开发约定`, `工作区开发约定`, both project AGENTS.md files, plugin `docs/bot-api/README.md` and `docs/migration/README.md`, and the source task prompt. No applicable AGENTS.override.md was found. One local implementation session only; no sub-agents, model changes, root operations, container changes, running-service changes, real model calls, QQ sends or credential changes.

## Stage 0: audit and baseline

- Core baseline SHA: `9cc61202fc6c2471e7a1991c3e52bdab53e3e725`, established by the independent reviewer after this session's sandbox denied Git writes.
- Plugin baseline SHA: `a521f3c2c9b2bfd70a70850e5949045c78b7282a` (`chore: establish reviewed plugin workspace baseline`). Its working tree was clean immediately after the baseline; final six-file changes await reviewer commit as recorded below.
- Reviewed all nonignored candidate files: 407 core files and 54 plugin files. No matches for private-key blocks, credential-token patterns or long literal JSON credential fields. This is a pattern audit, not a guarantee against every possible secret representation. Candidate files above 2 MB: none. Actual credential/configuration files were not opened for the audit.
- Core excluded actual configuration filenames: `config/bot.json`, `config/framework.json`, `config/providers.json`, `config/resources.json`. Also excluded data/, dist/, plugin-data/, plugins/, node_modules/. Kept `.env.example` and `config/*.example.json`.
- Plugin excluded .dev-source/, artifacts/, plugin generated dist/, renderer.wasm and API-SNAPSHOT.json, and node_modules/. Existing source/font/license files retained.
- Only ignore hardening was added before the baseline: `.env*` with `.env.example` exception, `*.pem`, `*.key`, all core config entries except example JSON, and plugin config/data/plugin-data/dist directories. No existing application settings were changed. No forced add was used.
- Core command `git add .` failed with exit 128: `fatal: Unable to create '../pi-im-bot/.git/index.lock': Read-only file system`. The subsequent `git commit -m 'chore: establish reviewed source baseline'` failed with the same error. `git rev-parse --verify HEAD` still reports `fatal: Needed a single revision`.
- Filesystem mode of both .git directories is `drwxrwxr-x (local owner/group omitted)`; the core error is a read-only filesystem/sandbox restriction, not an application permission policy. No attempt was made to modify sandbox policy, relocate Git metadata, use an alternate index, or bypass this restriction.
- At the initial blocked attempt, the task-owned changes pending baseline were `.gitignore` hardening and the alternate handoff file; implementation had not yet started. The two baselines above were established before the separately grouped repairs. All original user files were preserved.
- Audit helper: `${VALIDATION_DIR}/audit.ts` (prints only filenames/counts, never secret values).

## Existing baseline validation (not remediation verification)

All commands used the respective project's `node_modules/.bin/bun` with that directory added to PATH. No dependency upgrades or downloads.

| Project | Check | Result | Task log |
| --- | --- | --- | --- |
| Core | `bun run check` | pass | `${VALIDATION_DIR}/core-check.log` |
| Core | `bun test tests` | 129 pass, 0 fail, 961 assertions, 49 files, 26.95 s | `${VALIDATION_DIR}/core-test.log` |
| Core | `bun run build` | pass; `WEB_DIST_DIR=${VALIDATION_DIR}/web-build` | `${VALIDATION_DIR}/core-build.log` |
| Plugins | `bun run check` | pass | `${VALIDATION_DIR}/plugin-check.log` |
| Plugins | `bun test tests` | 4 pass, 0 fail, 42 assertions, 2 files | `${VALIDATION_DIR}/plugin-test.log` |
| Plugins | `bun run build` | pass | `${VALIDATION_DIR}/plugin-build.log` |
| Plugins | `bun run format:check` | pass | `${VALIDATION_DIR}/plugin-format.log` |
| Plugins | `bun run pack status <task-output>` twice | both pass, identical SHA-256 | `${VALIDATION_DIR}/plugin-pack-first.log`, `plugin-pack-second.log` |

Both package outputs (`status-first.zip`, `status-second.zip` in task /tmp) hash to `70d4d7d92c579c639386818294e5b46ec6b52f22fdd684f3d769fdf6c27882ec`. Build output and temporary test/package data are excluded from Git. Existing tests run authored fixtures and local synthetic providers; no production execution backend was enabled.

## Stage 1 — inbound admission (proposed commit group)

- Message archives now carry explicit pending/dispatching/accepted/unknown/expired admission state. Pending dispatches are bounded by `agent.maxQueuedRuns` and `queueMaxAgeMs`. New overload rejects before archival; existing archived inputs remain retryable. Accepted and uncertain deduplication lasts as long as the message archive, including legacy messages with no admission metadata (these are conservatively never replayed).
- Run creation and batch append atomically save the run and source-message associations in the existing StateStore transaction. No run is registered as active before that save succeeds. A restart or completion retries safe pending admission; stale conversations, recalls and expiry prevent old inputs from running.
- Direct commands claim dispatch before their first side effect. A failure or process exit during dispatch is explicit `unknown`/`uncertain`, never automatically retried. This deliberately favors avoiding duplicate command effects when the external outcome cannot be proven. OneBot releases its short-lived receive cache on rejection.
- Five memory/fixture behavior tests pass (23 assertions): queue-full retry, concurrent duplicates, pre-admission crash/recovery, uncertain direct-command side effect, bounded backlog/expiry, and OneBot retry. No database tests added.
- Proposed core commit: `fix: persist inbound admission before dispatch`. Files and incremental patch will be recorded under `${VALIDATION_DIR}/phase1-*` for independent staging. Core commits are not claimed until the reviewer records their SHAs.

## Stage 2 — cancellation and delivery (proposed commit group)

- Core final delivery checks abort, scope and deadline before transport and every part. Run completion rechecks abort and absolute deadline after delivery, so a late receipt cannot turn a cancelled run into completed.
- System failure notices can still explain an execution timeout, while user stop/shutdown and invalidated scopes prevent further notices. The assistant payload and the system failure notification have separate operation keys.
- Local pre-part veto is distinct from unknown transport failure. A cancelled outbound is terminal and never automatically resent; confirmed earlier parts remain recorded as `partial`. A fully confirmed late receipt remains `sent` while the run records cancellation. Jobs and UI expose partial delivery accurately; existing unknown transport outcomes remain conservative.
- Five new cancellation behavior tests plus existing media-delivery test pass: plugins enabled/disabled, stop before send, stop after actual send, partial-part veto/no replay, and deadline/failure-notice behavior. No database tests added.
- Proposed core commit: `fix: enforce cancellation across delivery boundaries`. Incremental patch and file list: `${VALIDATION_DIR}/phase2.patch`, `phase2-files.json`.

## Stage 3 — bounded hot indexes, archived history and resource recovery

- Job hot state holds only outstanding work (including terminal work awaiting delivery). Normal admissions scan this activity set, bounded by global/per-scope admission limits, rather than all completed history. Revising a terminal Job also checks outstanding capacity. Legacy data above current limits is preserved and blocks new admission instead of being discarded.
- Completed summaries live in fixed 128-item global and room pages. `GET /api/rooms/:id/jobs/history?beforePage=N` returns `{jobs,nextPage?}`; omit beforePage for newest. The first pass incorrectly reused the original archive slot across revisions; review round 1 below replaces that behavior with moving the current revision into the latest history page when it finishes. The default list combines activity with recent completed entries (at most 1000 requested); this limit is not a storage limit. Room cancellation reads only activity.
- Permanent request receipts are separate keyed durable documents; per-run admission budgets are separate keyed documents. They have **no automatic expiry**, as do Job records and history pages: the existing durable journal can still replay tools. No request is removed based on age or completed status. Disk archives and configuration snapshot files are intentionally retained until a future lifecycle mechanism can prove that every owner/replay reference is retired. Activity/cache bounds do not imply bounded total disk storage.
- The old singleton JobIndex is converted atomically on first use: copy every summary, request key (including colons), and run budget; then replace only the superseded projection with empty maps. Job bodies, durable tasks and source records are preserved. A failed/interrupted transaction leaves the legacy index intact. This one-time migration reads the old full index; hot paths no longer do so. Very large legacy installations should budget migration memory/time before deployment; the microbenchmarks below do not measure migration.
- Platform ID lookup uses a rebuildable `(room_id,platform_id,message_id)` projection with a message-ID reverse index. The initial transaction rebuilds it from existing messages without deleting messages. SQLite triggers keep insert/update/delete and echo merge consistent, even if an older Bot binary writes after initial creation. Lookup no longer expands same-room history JSON. Global message/run/trace time ordering has a direct time index. Startup handles all unfinished coding runs, instead of truncating recovery to the latest 100.
- Configuration snapshot caches retain at most 128 known hashes and 32 restored configurations, with LRU eviction and retry after failed loads. Eviction never deletes an archive. Worker/fault/lock maps were already bounded or released; the confirmed leak was a rejected cleanup promise permanently preventing retry. Cleanup now retries failed stages, retains capacity until successful release, and avoids repeating already successful destruction/release stages. Durable bindings/provider registrations and model scope counters already have release paths; no speculative redesign was made.
- Added behavior verification: 300 legacy summaries paginate without loss; an active item stays outside archive results; request receipts/run budgets survive journal reopen; evicted configuration snapshots remain readable; repaired snapshot reads retry. Worker transient-cleanup test passes. Existing 23 Job/schedule/external-operation tests pass, including restart without duplicate side effects. No database tests were added.

### Reproducible performance evidence

Run with the project Bun 1.4.4: `bun scripts/benchmarks/job-history.ts` and `bun scripts/benchmarks/platform-messages.ts`. Data is entirely synthetic; no deployed data, services, credentials, plugins or models are used. Each hot operation uses 5 warmups then the median of 20 samples. Raw results: `${VALIDATION_DIR}/benchmark-history.jsonl` and `benchmark-platform.jsonl`.

| Historical entries | Old Job list selection ms | Paged selection ms | Old admission scan ms | Activity scan ms | Old last-ID lookup ms | Indexed last-ID ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 0.03740 | 0.00822 | 0.00998 | 0.00012 | 0.17668 | 0.00147 |
| 10,000 | 0.37321 | 0.00374 | 0.07148 | 0.00018 | 1.81331 | 0.00159 |
| 100,000 | 6.09377 | 0.00349 | 1.60166 | 0.00011 | 20.22250 | 0.00192 |

The Job benchmark is an authored in-memory projection substitute using 16 outstanding Jobs and 128-item pages; it measures selection only, excluding SDK transaction/storage/migration cost. At 100k the old serialized hot document is 23,622,284 bytes; new activity is 2,961 bytes and one sampled history page is 21,521 bytes. These byte counts describe the projections, not an assertion that every prior write serialized the entire document.

The platform benchmark uses an isolated synthetic SQLite `:memory:` database for timings and EXPLAIN only, outside the test suite. Missing-ID lookup at 100k changes from 20.15076 ms to 0.00121 ms. Rebuilding 100k projection rows took 95.351 ms. EXPLAIN uses the projection primary key and messages primary-key index; ordering is over matching IDs only. This is not an end-to-end Bot throughput claim or a production migration timing guarantee.

Proposed core commit: `perf: separate active jobs from durable history and index platform messages`. Incremental patch/file list: `${VALIDATION_DIR}/phase3.patch`, `phase3-files.json`.

## Stage 4 — documentation and reproducible API snapshot

- README/framework overviews now separate schema defaults, dated acceptance records and current deployment observations. Historical stage pages qualify their closed/unready states; migration docs no longer claim that the current formal backend is closed. No configuration was altered to match documentation.
- Read-only observation: `GET http://127.0.0.1:19335/api/plugins/observers` at `2026-11-12T17:22:22.970Z` (2026-11-13 Asia/Shanghai) returned `enabled:true`. Only that boolean and observation time were printed. This agrees with the supplied 2026-11-12 deployment evidence; no credentials or full runtime payload were exposed.
- Plugin handbook documents admission outcomes, cancellation/partial delivery, history pagination and permanent deduplication retention. The plugin workspace synchronizes this handbook and hashes the newly affected domain/Job/delivery contracts as well as existing plugin APIs.
- Snapshot metadata now records the real core Git base and dirty flag, instead of claiming there are no Git commits. Repeated sync with identical contracts/base/dirty state preserves the snapshot timestamp, allowing reproducible builds and packages.
- Proposed core commit: `docs: distinguish plugin defaults from deployment observations`. Incremental core patch/file list: `${VALIDATION_DIR}/phase4.patch`, `phase4-files.json`. Plugin workspace documentation/sync changes are committed separately after full validation.

## Stage 5 — additional evidence and architecture inventory

- A further unbounded resident projection was found in the durable ConversationIndex: every root/background conversation binding stayed in one hot document. It now uses keyed bindings with one atomic legacy conversion; native conversations, their history and ownership IDs are preserved. A journal reopen test confirms that an old key still resolves to the same native conversation. This removes resident cardinality growth from that singleton; no throughput measurement is claimed for this change.
- An additional integration test replays an actual JobService request after legacy conversion and journal reopen: the original Job is returned, the list contains one Job, and the synthetic model receives zero requests. This tests the recovery invariant beyond merely inspecting copied request maps.
- The existing presentation-ledger test now distinguishes a user/shutdown veto (terminal cancelled, never reset) from an independent process-exit fixture whose presentation committed before transport was claimed (prepared, safe to resume without rerendering).
- Shared-browser CDP verification used an isolated ephemeral fixture server and authored synthetic data. Chat partial-delivery, Job partial-delivery and OneBot uncertain-admission labels were visible at 1366×768 and 390×844, with no page errors. Screenshots/JSON: `${VALIDATION_DIR}/ui-*.png`, `ui-check.json`. Visual inspection led to making the Job partial-delivery notice a separate paragraph. No production page mutation, real send or production service restart was used.
- Proposed core commit: `fix: preserve durable bindings and verify recovery invariants`. The phase5 patch/file manifest also includes final reporting and the presentation test adjustment. The reviewer may fold these followups into phases 2–3 when making the independently reviewed commits.

### 当前已有的 Bot/Plugin 分层

Pi 仍拥有对话、压缩、模型循环和工具循环。Bot 提供可信身份、权限、消息归档、受理、配置快照、Job、产物、发送账本和隔离执行。插件在 Worker 中实现业务，不取得 Bot/Pi 对象、宿主文件系统、正式凭据或网络权限。

`pkgs/plugins/src/host.ts` 实际注册 `system.status`、`history.read`、`artifact.read/write/publish`、`delivery.send`，在相应调用范围内提供 `delivery.recall`。`connectors.ts` 提供绑定 MCP RPC，`operations-rpc.ts` 和 `points.ts` 提供授权的跨插件 operation/自定义切入点。六个核心 Hook 有真实调用位置、模式、schema、可写路径与 before/after/requires 排序。指令与 Pi 工具复用 operation；后台 execute/pending/poll/cancel 已接入持久 Job。operation 的 execute 输入与可选 outputSchema 确实由 Worker 校验；不能误报为“尚未实现 schema”。

以上是**当前存在**的能力。本轮修复的归档/受理丢失、取消/交付越界、历史索引增长和清理失败无法重试属于**已有实现缺陷**。下面列出的服务与声明是**尚未实现的能力**，没有在此次修复中偷偷增加权限或空 API。

### Bot 仍缺少的受管 RPC/服务

| 缺口 | 具体迁移阻塞 | 现有边界 |
| --- | --- | --- |
| 受管 HTTP/领域服务连接器，含服务名、凭据代管、期限、响应/大小约束及远端任务协议 | gsvi_short_tts 的语音目录/合成、搜索、视频和绘图等外部 API | Worker 仍无网络；当前 connector 只调用明确绑定/授权的 MCP。可以先封装成受管 MCP 服务，不能把 Header/密钥交给 Worker |
| 按用途绑定的模型/视觉、TTS/STT/embedding 服务 RPC | 视频/日报/状态二次分析、语音、画像与知识检索 | Pi 自己的模型调用与工具循环已存在，但插件没有 llm.generate 或任意 Provider 枚举/调用接口；配置选择器的引用不代表已有服务 |
| 本范围入站媒体读取与受限分页历史/覆盖游标 | kuang、参考图/视频、每日群分析、群流水的增量处理 | message 观察可见 mediaId/附件描述；artifact.read 只读已发布产物。history.read 只返回最近的有界投影，无完整增量扫描/补齐保证 |
| 插件拥有的 Cron/定时触发、受管外部事件订阅、持久用户交互/恢复 | 状态月流量采样、视频订阅、HAPI 等交互、外部推送 ACK | Bot Cron、Job 和本次消息/回执观察已实现；插件不能自注册计划、持有守护计时器，或把任意 WS/SSE 变成可靠事件源 |
| 结构化消息、显式多目标路由、平台事件/交互构造 | 合并转发、@/引用、跨范围提醒、批量撤回的完整原功能 | 当前发送是绑定范围内文字与 Artifact，撤回限定本次已确认回执。原始 adapter/任意目标群发送均未开放 |
| 渲染/知识库等受管领域服务，以及必要的隔离页面/路由/配置文件资源上传 | HTML 卡片、RAG、扫码/确认页面、背景文件等 | 状态插件自带 WASM 渲染可用；没有 render.html、知识库 RPC、自定义插件页面/宿主 Web 路由或通用配置文件上传 |

依据：`pkgs/plugins/src/host.ts`、`connectors.ts`、`rpc/services.ts`、`sdk/index.ts`、`manifest.ts`、`hooks/points.ts`、`runtime/config.ts`，以及已维护的 `installed-plugin-map.md` 和状态插件 `MIGRATION.md`。目录功能盘点不是当前启用清单；这里没有重新读取其他系统的正式凭据或执行第三方插件。

### Plugin 声明、生命周期与编排契约缺口

| 尚未实现的契约 | 当前已存在的部分 | 对编排的影响 |
| --- | --- | --- |
| 数据版本与迁移/回滚声明、受管初始化/销毁/升级排空生命周期 | 包版本/固定 generation、私有卷跨代码版本保留、Worker 超时/空闲回收 | 不能把模块 import 或 Worker 存活期当作实例生命周期；旧数据兼容和迁移现在由业务自管 |
| operation 的明确只读/幂等/可重试/资源租约声明，以及 pending handle/poll/cancel 的专门 schema | operation 输入/可选输出 schema、前后台选择、timeout、grants、poll/cancel handler 名称；通用 outcome 协议 | 恢复只能保守地标未知；Core 无法仅凭某个 handler 名判断提交/取消是否可重放。handle 当前必须由插件自己用 Zod 校验 |
| 更丰富的命名服务类型、服务契约/版本和共享资源所有权声明 | connections 只有 mcp/plugin；绑定和 grant 隔离、嵌套调用深度/重入限制已存在 | UI 的资源引用不能自动成为 HTTP/语音/模型服务；多个插件争用同一个领域资源仍缺显式所有者/租约语义 |
| 模型/工具前后、入站接管和原生传输准备等真实切入点与仲裁契约 | 六个核心点、可写路径、拓扑关系、优先级、自定义 point 调用已实现 | 配置更多优先级不能产生缺失调用位置；message.recorded 是异步观察，不是阻断 Agent 的输入 claim |
| 通用持久交互与跨 operation 的数据流/恢复契约 | 同步跨插件 RPC、Artifact ID、Job/子任务、消息回执已存在 | 复杂领域流程应先复用 Job 与显式 operation/Artifact，再按迁移证据补接口；当前没有通用 DAG 编排器，也不应在本次 bugfix 中新造一套 |

这些是未来逐项实现和验收的建议，不是已经可调用的 API。优先顺序宜从真实启用需求选择：先有受管语音/HTTP 服务和入站媒体，再补与具体迁移相关的定时/交互契约；模型循环继续归 Pi，权限和凭据继续由 Bot 代管。

## Pass2 validation and handoff (review round 1 supersedes this result)

| Project | Required validation | Final result |
| --- | --- | --- |
| Core | `bun run check` | pass |
| Core | `bun test tests` | **144 pass, 0 fail**, 1029 assertions, 52 files, 28.07 s |
| Core | `bun run build` | pass; output isolated via WEB_DIST_DIR to task /tmp |
| Core | Prettier check over src/apps/web/src/scripts/tests/example configs | pass |
| Plugins | `bun run check`, `bun test tests` | pass; **4 pass, 0 fail**, 42 assertions |
| Plugins | `bun run build`, `bun run format:check` | pass |
| Plugins | build → pack → rebuild → pack | both pass, ZIP files byte-identical |
| Plugin API snapshot | two consecutive `bun run docs:sync` | second run unchanged; digest `df52284e7b70ed8551ddcc537548709a00f0be11f12da528631f0ba64fd80004` |
| UI | shared-browser, isolated authored fixture | 6 visible states, no page errors; task pages closed and fixture stopped |

Final package SHA-256: `e1306680d1fa0613229b6b560b196d869f2238bbe96757ec1af85d70409f6116`, for both `${VALIDATION_DIR}/status-final-first.zip` and `status-final-second.zip`. The earlier baseline package hash in this report refers to the pre-remediation snapshot. Final command logs are `final-core-*.log` and `final-plugin-*.log` in local validation artifacts. No database tests, dependency upgrades, real paid model calls, QQ sends, root actions or production container/service changes were introduced.

The final plugin `git add` and `git commit` both failed: `fatal: Unable to create '../pi-im-bot-plugins/.git/index.lock': Read-only file system`. This differs from the initial successful baseline operation. No retry through alternative metadata paths or changed policy was attempted. The six changed plugin files are `docs/bot-api/README.md`, `docs/bot-api/async-and-data.md`, `docs/bot-api/snapshot.json`, `docs/migration/README.md`, `plugins/status/MIGRATION.md`, and `scripts/sync-docs.ts`. Proposed plugin commit: `docs: sync remediation contracts and deployment facts`; patch: `${VALIDATION_DIR}/plugins-remediation.patch`.

| Core proposed group | Subject | Review artifacts |
| --- | --- | --- |
| 1 | fix: persist inbound admission before dispatch | phase1.patch, phase1-files.json |
| 2 | fix: enforce cancellation across delivery boundaries | phase2.patch, phase2-files.json |
| 3 | perf: separate active jobs from durable history and index platform messages | phase3.patch, phase3-files.json |
| 4 | docs: distinguish plugin defaults from deployment observations | phase4.patch, phase4-files.json |
| 5 | fix: preserve durable bindings and verify recovery invariants | phase5.patch, phase5-files.json |

All incremental artifacts are under `${VALIDATION_DIR}/`. They include new files and sequential deltas for shared files, including this report. Repair commit SHAs remain **pending independent reviewer commits**; do not mistake proposed groups or patch hashes for Git commits. The only existing commits at this handoff are the two recorded baselines. The reviewer can stage patches sequentially without changing the final working files, or regroup the small phase5 followups with their corresponding fixes. The core original .codex handoff remains reviewer-maintained.

Patch verification exports ordinary source files from the two baselines, applies all five core patches in sequence and the plugin patch independently, then compares every changed/new file against the working sources. All **49 core files and 6 plugin files** match byte-for-byte. `patch-verification.json` records each patch SHA-256 and file count. This uses no temporary Git repository, alternate index or protected-metadata writes. The isolated UI server was also confirmed stopped after validation.

Remaining practical limits: direct commands interrupted after dispatch need manual outcome verification; legacy archive-only messages are never guessed safe to replay; historic records/receipts/snapshots and each Job's revisions remain on disk; the one-time legacy conversions need deployment-scale memory/time assessment. Rolling back to baseline binaries after index conversion requires reverse projection/export of keyed receipts and bindings, rather than deleting the journal or pretending old empty projections are complete. No production data was converted or deleted in this development session. The architecture service/contract gaps above are deliberately unimplemented. Deployment and real platform verification remain outside the authorized scope.

## Original blockage and continuation

The initial attempt stopped before implementation because core .git was read-only. The independent reviewer established the core baseline through ordinary-user SSH under the user's existing authorization, and performs the reviewed commits the same way. There was no request to change permissions, no additional authorization prerequisite, and no security policy change. This report replaces the earlier task-owned `docs/handoffs/pi-review-remediation.md`. Production deployment remains outside scope.

## Independent review round 1 — corrections after pass2

The reviewer rejected the first implementation on two reproduced P1 boundaries and a P2 history behavior. The earlier 144-test result describes pass2, not review approval. This round continues in the same implementation session, with no extra Agent, deployment, Git/.codex write attempt or permission-policy change.

- **P1 control admission:** the original capacity check blocked `/stop` behind business pending. Exact core help/status/stop/new/skills and Job list/status/cancel commands now have up to 16 independent immediate dispatches. They persist dispatch before effects, retain platform-message deduplication and existing trusted-identity authorization, and cannot start Agent work through that path. Plugin business commands and Job updates remain subject to business admission limits.
- **P1 stop boundary:** StateStore atomically marks that room's existing pending inputs cancelled; queued/running run cancellation is persisted too. Recovery reads the latest stored admission rather than trusting a captured pending object. Scope stop captures existing active entries, so later input can wait for capacity and then run. Completed runs waiting only for resource release keep their completed status, verified with a gated release test. Job cancellation captures admitted IDs/revisions on the durable mutation line; shutdown awaits those cancellation promises before closing the session, avoiding the newly reproduced `Session is closed` cleanup race. All paths that use scope stop inherit pending cancellation, including `/new`, conversation/mode changes and target disabling.
- **P2 revised history:** activating a revised Job removes its previous summary projection. Finishing places the current revision in the latest global/room page; same-revision receipt updates retain its position. Empty pages are unlinked from the traversal chain; normal history/list operations touch pages and neighbors instead of sorting/scanning all history. Old pass2 pages acquire links once per scope without dropping their rows. Job bodies, previous revisions and permanent request/admission receipts are preserved. List output excludes IDs already captured as active.
- **Old Job command lookup:** the review reproduction also demonstrated that a complete old Job UUID existed but `/job UUID` searched only recent list results. Complete UUID commands now use a scoped direct get, including update/cancel. Short prefixes still use the bounded recent/activity list and explicitly advise the complete ID for older work.
- **Behavior verification:** new tests cover business congestion and the control allowlist, denied platform authority, persistent command deduplication, `/new`, stop before/after a captured recovery read, restart without revival, and a fresh post-stop input arriving while the original run is still winding down. A real JobService/command path revises an old Job beyond the first page, checks active/archive separation, current-revision pagination in both scopes, empty-page traversal, legacy page-link conversion and journal reopen.

The unchanged reviewer script `${VALIDATION_DIR}/review-control.ts` is rerun with project Bun and only its authored local model: first case now reports `stopError:""`, `pending:0`, `activeStatus:"cancelled"`; the stopped-gate case reports `calls:1` and only the cancelled original run. Logs are under `${VALIDATION_DIR}/review-round1/control-*.log`. Performance figures above remain algorithm microbenchmarks and isolated SQLite query timings; they are not SDK transaction end-to-end timings. No receipt was deleted to claim bounded disk storage.

Review artifacts are incremental **after pass2**: apply original core `phase1.patch` through `phase5.patch`, then `review-fix.patch`; in the plugin repo apply the original `plugins-remediation.patch`, then `plugins-review-fix.patch`. Each incremental patch includes new files. File manifests, checksums, validation logs and full baseline-to-final replay comparison are kept under `${VALIDATION_DIR}/review-round1/`. Original five-stage artifacts are preserved unchanged. Core and plugin commits remain the independent reviewer's ordinary-user SSH responsibility.

### Review round 1 final validation

| Check | Result |
| --- | --- |
| Core check / tests / build | pass; **150 pass, 0 fail**, 1089 assertions, 54 files, 28.79 s |
| Core changed source formatting | pass; exact changed TypeScript files including new files |
| Plugins check / tests / build / format:check | pass; **4 pass, 0 fail**, 42 assertions |
| Plugin build → pack → rebuild → pack | both pass; byte-identical ZIPs |
| Repeated docs:sync | unchanged; digest `613288907f33732e98bdb3c5ea2f438e5209f75b8bd951c8ff60a0f1e1ee0758` |
| Reviewer control reproduction | stop succeeds with pending=0; stopped old input never executes (calls=1); complete old Job ID resolves |

Review-round package SHA-256: `8bd4b0f0c29b17ad7c4f2ae478ab840c89a50deda0a3a742b41e8897fe8112dd` for both `review-round1/status-first.zip` and `status-second.zip`. Browser verification was not repeated because no previously verified page changed in this round. Command logs and the unchanged reviewer reproduction output are in that review-round directory. No database tests, dependency changes, formal configuration changes, real QQ sends or paid model calls were added.

The core review patch includes the new `pkgs/jobs/src/history.ts`, `tests/inbound-control.test.ts`, and `tests/job-history-revision.test.ts`. Nonempty-page links are a derived projection, lazily added to old page records; they do not expire receipts or remove old Job revision bodies. Revised history freshness is a behavioral correction, not a documentation-only redefinition. The original permission policy was neither requested to change nor changed.

Replay coverage is **15 core files (3 added) and 3 plugin files** relative to pass2; cumulative baseline-to-final changes are **54 core files and 6 plugin files**. The complete exported source trees compare byte-for-byte after applying the original patches and these increments. `review-round1/replay-verification.json` records the comparison and checksums; `review-fix-files.json` / `plugins-review-fix-files.json` list exact paths and add/modify status. The original five stages and original plugin patch retain their recorded SHA-256 values. No commit SHA is invented for these uncommitted source patches.

The reviewer maintains the original protected .codex handoff. The implementation session only writes ordinary source/documentation paths and /tmp artifacts; no root or security policy changes are needed.

## Independent reviewer acceptance — 2026-11-13

The WSL reviewer independently read the final source changes, rejected pass2 on reproduced control/stop/history boundaries, and verified the corrected implementation in the original NAS Codex session. Independent core verification passed: 150 tests, 0 failures, typecheck, isolated UI build and Git whitespace checks. The three authored reviewer scenarios now demonstrate available chat stop under congestion, no pending revival after stop, and direct lookup of an old complete Job UUID. No production deployment or data conversion was performed.

The reviewer reran both performance scripts: with 100k synthetic entries, platform lookup was about 19.68 ms before and 0.00189 ms after; the in-memory Job list selection was about 5.73 ms before and 0.00354 ms after. The Job measurement excludes SDK storage, transactions and migration. Persistent archives and receipts are deliberately retained.

Implementation-stage commit proposals and package hashes above are historical validation records. The reviewed core repair commits are:

- `cf841862fc71c85295f7a6d8c10c48bb6bc74a44 fix: persist inbound admission before dispatch`

- `4d573640ae55c264bfc40f4735bde77adc0b04a3 fix: enforce cancellation across delivery boundaries`

- `b7b2c31f8e8839151c2a770528602458460cf20b perf: separate active jobs from history and index platform messages`

- `e85e63e70b7c30470b18e7f39647996f97706d90 docs: distinguish plugin defaults from deployment observations`

- `b20b2ba72820c34d5656572ba22d8851615ad57c fix: preserve durable bindings and verify recovery invariants`

- `7e029d9ec3cb61d191b38905ba2a8e3b0a1b86b9 fix: preserve stop boundaries and recent job revision history`

The final core documentation commit also includes the reviewer's [independent layering analysis](review-layering-2026-11-13.md) and durable handoff. The plugin API snapshot is synchronized to that final committed core revision before the separately reviewed plugin documentation commit. Final commit/package receipts are retained in the reviewer handoff, avoiding a self-referential package-hash update in its own inputs. No outstanding confirmed blocker remains in this reviewed change set; the unimplemented capability roadmap and deployment-time migration considerations remain explicitly documented.

# 安装管理 PATCH 修复与 L3 验收

> Historical validation note: ${VALIDATION_DIR} is a placeholder, not a published location. Local logs, patches and orchestration inputs are not included in this Git repository.

本轮基线：Core 1f7da02e298b1a4b2a1978118ee6722f88248e5d；插件6caee0df3dd346452456f185dbf972a214b87461。T/C源码迁移与离线业务验证已由主审核者接受，本轮修复随后真实安装smoke发现的管理字段损失。修复已由主会话独立复核并提交，未部署到正式实例。

## 修复

原ManagePluginSchema从带default的实例schema执行pick().partial()，只PATCH enabled时仍产生grants:[]与三种映射{}，Object.assign清掉已保存配置。现在单独声明无default的可选PATCH字段，复用原类型/长度/ID/grant限制，外层与patch均strict拒绝未知字段。editor直接调用也校验同一schema，并仅合并非undefined值。

省略与内部undefined保持原值；显式grants:[]或映射{}可合法清空指定字段；映射按字段替换，settings/release等不由管理PATCH改写。前端无需完整metadata绕过。首次安装默认值逻辑保持，文档/API快照同步。

## 行为与真实安装验证

插件工作区新增两包真实ZIP上传的回归（memory/JSONL、后端关闭）。保存设置、授权和三种映射后，仅PATCH enabled false/true/重复、name、grants及单个映射，完整比较其他实例字段；显式清空、混合undefined/合法修改/明确清空的editor调用、未知字段和非法约束均覆盖，没有新增数据库单元测试。

规定检查通过：Core check、178 tests / 1333 assertions、隔离web build、format；插件docs:sync/check、68 tests / 819 assertions、build/format。四包各两次build/pack逐字节相同，未更改第三方依赖。GSVI仍0.2.0、Comfy仍0.1.0；输入SHA与source revision独立记录，不把旧accepted-c SHA硬编码成未来复核条件。

全新task子目录运行真实services/bot/src/main.ts应用及其临时SQLite，经HTTP multipart安装两包，核对默认disabled、schema/默认值/manifest版本/release；真实资源/实例configuration路由保存假服务、模板、设置与绑定。随后每包21次只提交目标字段的管理PATCH验证，无完整payload绕过；仅重启此应用后除乐观锁revision外的全部字段、服务、release和schema保持。导出不含实例值/服务凭据；共享浏览器真实表单/disabled-backend提示通过。两个应用进程均正常退出，监听与task页面已清理，上游trap零请求，后端和两实例最终仍停用。

上一阶段问题已在本轮实现和L3中关闭；历史失败报告/缺陷/收据保存在任务history/l3-before-fix，不作为当前未关闭项。原迁移已接受的结论保持。

## 收据和边界

完整结果、HTTP矩阵、截图、input SHA、包和累计补丁/基线回放位于${VALIDATION_DIR}/fix-20261114。L3脚本支持显式--root、--gsvi-zip、--comfy-zip和可选--expect-gsvi-version/--expect-comfy-version，校验实际输入manifest并记录SHA，可供主审提交后用干净HEAD重跑。

正式19335/API插件元数据及正式dist保持不变，未对PID924999发送信号；主SSH已确认它是无watch/hot的裸Bun进程。两仓库HEAD未改，无Git元数据写入。没有真实TTS/GPU/LLM/QQ、正式配置/旧KV或服务变化。

L4真实容器仍未授权/未执行。仅更新固定本地镜像digest、当前release/room/owner计算的精确候选容器名、runner摘要、资源/挂载/网络/回滚方案。FUSE条件需在后续授权范围确认，没有容器或FUSE变更、root/sudo、审批submit、依赖安装或部署。

## 主审核查与后续收据

主审复核了无default的PATCH字段schema及editor非undefined合并，并独立执行两包实际上传后的HTTP/editor行为回归：2 tests / 110 assertions / 0 fail。NAS完整回归为Core178、插件68，真实L3每包21次目标字段修改、重启/导出/表单通过，未使用旧完整payload绕过。最终干净HEAD和新包的再次L3验证以任务accepted-install.json及对应results为准。

主SSH只读确认宿主/dev/fuse可读写，/usr/sbin/mke2fs、/usr/sbin/e2fsck及/usr/bin/fusermount3存在，但默认/usr/bin/fuse2fs缺失。未安装依赖或执行root/FUSE/container操作；L4计划需在后续具体授权和前置条件满足后执行。正式19335仍仅旧system-status，本轮没有安装两包到正式实例。

# Plugin foundation A — 2026-11-13

> Historical validation note: ${VALIDATION_DIR} is a placeholder, not a published location. Local logs, patches and orchestration inputs are not included in this Git repository.

Source/reviewer session: （内部会话标识保留在本机）. NAS implementation uses the current default model, one session, no other agents. Core baseline `8855f7e2b5d50e778eb91cd6068ced75a0bc0b9c`; plugin baseline `ac69c165f0c53b63c431d86a4f0df9a45d72d0b1`. Both were clean on entry. Reviewer owns commits; no push/deployment is authorized.

## Status and scope

- A: independently accepted and committed after three review rounds. Core 160 and plugin 16 tests pass; six authored reviewer cases, isolated UI and reproducible packages pass. No deployment performed. See the final independent acceptance section below.
- B: backlog after independent A acceptance: event → owned Job, passive sampling/subscriptions, plugin-owned schedules/triggers, disable/upgrade ownership.
- C: backlog after B: effect/idempotency/reconciliation declarations, resource dependencies, asynchronous presentation with text/attachment preservation, explainable effective composition. No general workflow engine in A.

## Source audit and small design

Read global, workspace and both repository AGENTS.md, applicable overrides (none found), layering/reliability review reports, and plugin API/migration docs. Preserve previous reliability repairs and all persistent data. Pi retains its agent loop; Bot owns identity, authorization, execution resources, artifacts, persistent jobs and delivery. Third-party business remains in isolated Workers.

Current source already has background plugin operations, dispatch-before-effect checkpoints, conservative unknown outcomes, fixed configuration/generation, cancellation, artifact quotas and a single delivery ledger. MCP bindings support actual MCP servers, not raw GSVI HTTP. There is no existing managed GSVI MCP wrapper. A adds the narrow `gsvi@1` named service contract (`voices`, `synthesize`), rather than introducing a wrapper daemon or an arbitrary URL proxy. Bot owns endpoint/headers, bounded HTTP and WAV validation; Worker only sees a bound alias, domain input and artifact references. Existing MCP/plugin bindings remain unchanged.

Inbound media uses the existing MediaService. New `media.read` grant is distinct from business `media_read` authority. RPC exposes scoped metadata and bounded byte slices, never platform URLs, signatures, host paths or the backing input artifact ID. Track input provenance through publication/delivery, recheck recalls, scope, cancellation and authority. Media-inspect is a new PNG/WAV/text diagnostic/export consumer, not a kuang migration. Command and Pi tool share each operation; long synthesis and media processing use existing Jobs and final delivery, not synchronous hooks.

GSVI source: read-only `gsvi-reference-1.4.1`, metadata v1.4.1, author wsure, repository https://github.com/WsureDev/astrbot_plugin_gsvi_short_tts. Protocol fields and behavior derived from README, schema, metadata and Python source; Python is never executed. No LICENSE is declared in the source metadata/root; do not infer an upstream reuse license or copy its implementation. New TypeScript implementation is independently authored, attribution retained. Deployed kuang rules/README/metadata and processor/model source inspected read-only: v0.9.0, WsureDev, Pillow/NumPy/ONNX and model-backed detection; no suitably independent low-dependency processing operation selected. No deployed data/config/secrets read.

## Acceptance checklist

- [x] Managed GSVI service configuration, private credentials, instance binding/grant and separate business authorization; requests/deadlines/cancellation/size/redirect-origin rules and sanitized failures implemented.
- [x] TTS voice list/selection and explicit synthesis via shared command/tool operation, valid WAV artifact and one Job delivery; no automatic retry after uncertain submission.
- [x] Scoped mediaId metadata/chunk RPC backed by MediaService, source/history discovery and real Worker processing/export artifact; source recall, cross-scope, errors/expiry, cancellation, MIME/size and concurrent download constraints.
- [x] SDK helpers, configuration UI/diagnostics and docs distinguish installed/enabled/bound/callable; existing connectors/status remain functional.
- [x] Authored local HTTP + managed Worker fixture exercise SDK/RPC/Job/Artifact/delivery and failure boundaries, including unknown outcomes, cancellation, revocation and text fallback; no new database tests.
- [x] Core check/tests/build (`WEB_DIST_DIR=${VALIDATION_DIR}/web`); plugin check/tests/build/format and reproducible packs; shared-browser isolated UI verification.
- [x] Stage patches include new files with SHA-256 manifests; final replay procedure and receipts are recorded in the handoff section below.

## Initial migration matrix

| Old GSVI behavior | A decision |
| --- | --- |
| GET models, select voice/emotion, POST infer_single + WAV | Implement narrow managed protocol and explicit operations |
| API key / custom headers / download authentication | Bot-owned service config only, never Worker settings |
| per-channel voice policy | Use scoped plugin data/settings; platform identity remains Bot authority |
| short text probability and channel on/off gate | Deferred; no claim of parity |
| automatic refresh/schema mutation | Explicit voice-list operation; immutable package schema |
| automatic final/stream/tool/background presentation | Deferred to C; no long synchronous Hook |
| failure text fallback | Explicit synthesis retains requested text on known failure; cancellation/uncertainty remain explicit |
| old KV/Python package data | Untouched; no automatic migration |

## Safety and implementation budget

Only ordinary source/docs and scoped `${VALIDATION_DIR}` artifacts change. No root/container/system dependency/production configuration/backend toggle/service restart, real QQ/model/TTS request, or Git metadata write. No new local access gate. No dependency upgrade planned. Bounded service payloads and media byte slices avoid unbounded RPC messages; existing global/per-scope Job and Worker limits apply. Measured validation and limitations follow below.

## Inspected source fingerprints

No formal secret/configuration file was inspected. SHA-256 is for the listed source document/module only; upstream code was not executed or included in the new packages. TTS source root is `gsvi-reference-1.4.1`; kuang source root is `kuang-deployed-0.9.0`.

| Source | File | SHA-256 |
| --- | --- | --- |
| TTS 1.4.1 | README.md | `196ceafa61d0e849eddd402114686e0ae96ed1811520e1b2e50c3d9e31ac8683` |
| TTS 1.4.1 | _conf_schema.json | `0b88c985a1a448caadd123f2bbadf7d4f3e947b5b3a47e74620bb25c3f1bcb1d` |
| TTS 1.4.1 | metadata.yaml | `1b11bb774b7bae7913b5b1e232df6bc9145a7feb8572d59e861cbc40218fd7fc` |
| TTS 1.4.1 | gsvi.py | `e6e9b151645c0b072c350bac5838c1290a437e412ed77e79014718bb2df17a8b` |
| TTS 1.4.1 | settings.py | `4fd60e421d2657c6a966b6b1bbff22437476e082674f0e0ce4eb762434d66053` |
| TTS 1.4.1 | main.py | `84b8d607f6a4a946e4050943712bb799cae14f25b6ad4612632eacd291d531da` |
| TTS 1.4.1 | commands.py | `848e7b229f4a2430a6714aafd40dea761325a110d164798362f99cd5c542e761` |
| TTS 1.4.1 | channels.py | `6d83acd079a97f7e2b8a925b510ff4d9d9397aa7e7bc9ce4703f309932f62539` |
| TTS 1.4.1 | outgoing.py | `64869b9b3e9ae6f15976ea6fe53853999d546218bb428ac1af97384e1f4ea25d` |
| TTS 1.4.1 | origins.py | `238c2827fb7b4d1b68a8683f3c5aef67798beea8b4adcb8fdd4c4c4a0aff4a6b` |
| TTS 1.4.1 | reply_gate.py | `09de23c0659d8dabb94f5abf3877372dedaa59bd452a47da2ba675dfefe39b21` |
| TTS 1.4.1 | streaming.py | `8f6d2c65e2ec29a4476bb96666d97841e45b2f9a66abb9e9e1609da1ef6e2d2d` |
| TTS 1.4.1 | pyproject.toml | `b4ce69f2ca8f3e035bc31222c643ea0c8ef1ddf0d65e3a5fb72feafc515cf1f6` |
| kuang 0.9.0 | AGENTS.md | `7a7b73b24a1d203bff18d61eb2ae604682049449b9554405d23a679d4869c4d1` |
| kuang 0.9.0 | README.md | `2f94db75382e2feeb9782d52d2eff93ae3a73c74b3dd6ed74942d294a97d3932` |
| kuang 0.9.0 | metadata.yaml | `efeaed4681637e9412d01b704697c3c4c0509eb259c697b69d91b6663603ef1a` |
| kuang 0.9.0 | requirements/runtime.txt | `75c4c676b4e2b9cd56c90a3f2de4add651a9a14476193eb0b201b8d8b71bc0fe` |
| kuang 0.9.0 | core/processor.py | `81ee81e8a4aafa9debd0e8b2e1a6945397b92c85909d0ec101a8f2c705f5235d` |
| kuang 0.9.0 | core/models.py | `049ccefbecc81be303f3cfeafea2983e602fcdf5ec9f4f2bb37d275d0f4d6875` |

## Implemented contracts and ownership

The complete public contract is [managed media and speech](../plugins/managed-media-and-speech.md). Configuration examples in that document are examples only; no formal configuration was edited.

- `resources.services[]` currently supports only `kind: gsvi`; `connections` declares `kind: service, service: gsvi@1`, and instance `services` maps an alias to a named resource. No arbitrary URL/HTTP method RPC, new daemon, shell, fetch object, provider credential or host environment reaches Worker code. Existing mcp/plugin mappings retain their original behavior.
- `service:<alias>` has voices/synthesize actions with typed SDK `gsvi`. Both operation declaration and instance grant apply; synthesize also requires **that operation's** artifact.write before POST. Business authorization uses tts_voices/tts_synthesize and preserves the original Bot identity/authority ceiling, including background execution. Protocol, HTTP, configuration, identity/fingerprint and WAV validation are separate modules.
- One operation accepts at most four service calls / one synthesis; global service concurrency is two. The execution fingerprint excludes only display name. Enabled state, actual binding, headers, download origins, timeout and size policy remain authoritative. The request uses a private copy of its fixed execution configuration. Display rename succeeds while policy/credential changes, disable and revocations fail safely.
- `media.read` / typed `readMedia` return scoped metadata/byte chunks. Each invocation admits at most 16 unique direct/indirect sources, 128 reads and 8 MiB requested slices. Reservations are synchronous before I/O and retained after failure/cancellation until invocation end; same-ID blocks do not double-count. MediaService retains platform URL/MIME/image/expiry rules and two-request download concurrency. Shared download cancellation now respects individual readers and aborts the underlying request only when the last reader leaves.
- New media backing artifacts and produced artifacts carry source dependencies. Managed artifact.read merges them before asynchronous reading, checks again afterward, and propagates through current-call cross-plugin operations and subsequent MCP outputs. Pi's artifact_read/media_read and publication store use the same bounded source tracking. New publication, Worker completion and each delivery part recheck sources/authority. HTTP archived reads only check scope/source availability; disabling/removing a producer or changing service credentials does not make an old ordinary card/WAV unreadable. New delivery retains the in-flight checks.
- `gsvi-tts` provides /voices, /voice and /tts, with the same operations exposed as Pi tools. Scoped voice selection is stored in Worker private data using temporary write/rename. Synthesis uses an existing Job and Bot's delivery ledger; original text and a real audio Artifact are delivered once. Known synthesis failure preserves text; cancelled/uncertain submission is not quietly retried.
- `media-inspect` is a new consumer: explicit mediaId or recent normalized attachment/history → bounded chunks → Worker PNG/WAV/UTF-8/JSON structural inspection → exact-byte export and JSON report → Job delivery. Local temporary files are cleaned. Deterministic size/MIME/format/encoding refusal before publication returns failed. Host/authorization/source errors and cancellation propagate; after publication begins an interruption remains conservative, retaining partial artifacts without reissuing the operation.

No prior database, Job journal, media record, artifact, plugin data or archive was deleted or rewritten. New schema fields have defaults/are optional for existing durable data. Existing configurations without services still parse. Source-dependency metadata is attached to new writes; unknown historic artifact lineage is not invented or backfilled.

## Independent feedback and behavioral evidence

The reviewer-authored scripts are retained, not modified by this implementation session. Their final outputs are in `${VALIDATION_DIR}/reviewer-boundaries-final.log` and `reviewer-service-name-fixed.log`.

| Boundary | Final observed behavior / regression |
| --- | --- |
| 20 parallel distinct media IDs | 16 fulfilled / 16 reserved; remaining requests rejected before I/O; same-ID calls reuse slots; failed/cancelled slots and request bytes are not refunded |
| artifact.read → artifact.write | Copied artifact retains original mediaId; recall denies read/new delivery; asynchronous recheck and model artifact_read covered |
| Cross-plugin and MCP chain | Child read sources propagate to caller write and real MCP blob Artifact; both reject after source recall |
| Archived ordinary card/audio lifecycle | HTTP content remains readable after producer disable/removal and service rename/credential update; recalled input-derived exports remain blocked |
| Missing operation artifact.write | Instance grant alone cannot allow synthesis; refused before POST, upstream calls zero |
| Display-name edit after POST | Real fixture pipeline succeeds, one POST, one actual WAV Artifact and one delivery |
| Real authority/grant/alias/transport changes | Current identity revoke, instance grant revoke, alias change, size-policy/credential change and disable suppress late audio |
| Local known media refusal | Unsupported application/xml, oversized consumer input, damaged WAV, invalid UTF-8/JSON return failed with no export |
| Interruption after first export | outcome_unknown, one retained owned Artifact, no export replay on restart |
| Remote unknown / in-flight Bot restart | outcome_unknown; no second synthesis; no invented GSVI receipt or reconciliation |
| Delivery/idempotency | Repeated Job request key returns same Job, finished Job restart does not synthesize/send again; command and fake-model Pi tool reuse operation |
| Cancel / recall / media expiry | Cancelled waits suppress late artifacts; source recall during download and at publication rejected; coalesced downloads isolate reader cancellation; expired source needs explicit retry |
| Limits / protocol / auth redirects | Actual prefixed GSVI requests checked by local Hono fake; valid sine PCM WAV bytes, streamed size overflow, invalid WAV, denied origin, POST redirect/no replay, cross-origin download Header detachment, sanitized upstream bodies |

Tests are authored Worker/process fixtures and local Hono HTTP, existing JSONL durable harness and in-memory StateStore. They do not add database tests or execute downloaded Python/plugin code. The fixture is not a security-equivalent replacement for the production container backend. Existing core MCP/plugin/status tests and actual status package tests also pass.

## Validation and bounded performance

| Project/check | Result | Evidence under task /tmp |
| --- | --- | --- |
| Core check | pass | core-check.log |
| Core tests | 160 pass, 0 fail, 1177 assertions, 57 files, 28.52s | core-test.log |
| Core build | pass, WEB_DIST_DIR=${VALIDATION_DIR}/web | core-build.log |
| Plugins check / tests | pass; 16 pass, 0 fail, 141 assertions, 4 files, 3.98s | plugins-check.log / plugins-test.log |
| Plugins build / format:check | pass | plugins-build.log / plugins-format.log |
| Build → pack → rebuild → pack | status, gsvi-tts, media-inspect each byte-identical | packages.json, plugins-pack-*.log |
| Whitespace and source conventions | Git diff --check passes; changed TypeScript formatted with existing Prettier settings | final source checks |
| Shared-browser UI | Real source components and resource/config editors; create/edit service, secret masking, persistent instance binding and disabled-service diagnostics pass | ui-verification.json, ui-services.png, ui-binding.png |

The shared-browser client used a task-owned page and disconnected without closing the shared browser. All UI writes used temporary fixture configuration. Task HTTP server was stopped and its page closed. Later fingerprint/consumer-result changes did not alter UI controls, so unrelated browser actions were not repeated.

A 2 MiB UTF-8 attachment completed the actual Worker/RPC/Job/export path, byte-for-byte export checked, 16 × 128 KiB content chunks plus metadata, two Artifacts, about 152.11 ms in the local fixture (256 MiB Worker configuration). This is a single synthetic measurement, not production throughput/RSS. GSVI is capped at 16 KiB request JSON, 128 KiB voices, 16 KiB synth response and 8 MiB audio; service concurrency two and existing Worker/Job quotas still apply. Temporary buffers/copies fit these fixed input bounds; peak RSS was not measured. Runtime download concurrency and cancellation/coalescing were tested separately.

No new external dependency/version was introduced. New plugin workspace manifests reuse the already pinned Zod 4.6.7 (MIT); bun.lock only adds their workspace records. Bun lockfile generation used scoped /tmp cache/temp paths after the default temporary-directory access failed read-only. No toolchain/system install or dependency upgrade was performed. New plugin code has its own MIT license and attribution/NOTICE; upstream unlicensed Python is not redistributed.

## Remaining limits and next-batch prerequisites

GSVI lacks an authenticated remote task handle, idempotency, status or cancel protocol: remote work may continue after local cancellation; unknown submissions require operator inspection, never automatic synthesis replay. No formal external TTS/media/model/QQ end-to-end test or production container verification was authorized or performed. Deployment would need a separate scoped operational decision and its required container/root approval workflow.

The tracked source set covers the managed current invocation chains. It is not an arbitrary information-flow system: a Worker can retain previously read bytes, a remote service can retain a request, and Pi history can contain earlier outputs. This batch neither infers arbitrary long-term business dependencies nor rewrites unknown legacy lineage. PNG inspection checks structural boundaries, not CRC/pixel decode; WAV inspection in media-inspect checks RIFF header/length, while the GSVI service validates complete supported PCM/float chunks. Only listed MIME types and ≤2 MiB are supported by this consumer.

B remains explicit backlog pending independent A acceptance: durable observation-to-Job admission, owned sampling/subscriptions, schedules/triggers and disable/upgrade ownership. C follows B: effect/reconciliation/resource declarations, asynchronous presentation with preserved text/attachments and an explainable effective orchestration graph. Automatic short-text probability, channel gate, streaming/final presentation parity, generic HTTP/workflow and kuang detection/rendering are not claimed by A.

## Patch handoff and exact file inventory

All artifacts below are under `${VALIDATION_DIR}`. Stages 1/2 are preserved historical draft checkpoints, not independently accepted releases. Stage 3 contains the completed code, both review corrections, public API/snapshot and behavioral evidence; stage 4 adds the initial handoff/inventory; stage 5 includes the final Header ambiguity correction and refreshed receipts. Apply 1 → 2 → 3 → 4 → 5 for each repository. Empty patches are skipped. The final cumulative `core-final.patch` / `plugins-final.patch` cover the same complete changes from the original fixed baselines; these newly regenerated final patches supersede the uncommitted pre-Header final draft. Previous final patches and their receipts are preserved in pre-header-review/. No baseline, Git metadata or unrelated file is changed.

| Patch checkpoint | SHA-256 |
| --- | --- |
| core-1.patch | `4f8522bb6f3d8b0d84659345d3a307e1fab757167094830fb3549d39229d0c31` |
| core-2.patch | `49eeda07293c918dc122088273250afaf3ddfec4ca9b51c1a9e5cd0f9d2d5f4f` |
| core-3.patch | `c3c726b722adc161dfba895f96b7f1d9bf753c5e7157687e9621bb1e14759d8f` |
| plugins-1.patch | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| plugins-2.patch | `1bdc824bb566b26e07d05a05aa466302a3150fe16b8f588842670f69fd87e9d3` |
| plugins-3.patch | `42e7ce46cb5417d088a343082c3185c0fc76493f7a905704d632e4adc29d27f1` |

The stage-4, stage-5 and new final cumulative patch hashes are in `SHA256SUMS`, outside the patched report to avoid a self-referential hash. Each `*-N-files.json` contains a complete snapshot file SHA-256 inventory; `core-final-changes.json` and `plugins-final-changes.json` list exact added/modified paths and their final hashes. `replay-verification.json` records fresh archive extraction from the two fixed SHAs, sequential patch application, final cumulative application and full byte comparisons. `stages.ts`, `replay.ts` and `validate.ts` make extraction/validation reproducible without writing a Git index. The report and hashes are implementation receipts, not fabricated commit IDs. The WSL reviewer performs any later ordinary-user Git commit.

| Reproducible package (first.zip = second.zip) | Bytes | SHA-256 |
| --- | --- | --- |
| status | 3519001 | `2bcd36ec0c87ad6c440f1d12008196dc6cf4df4e02daab4c117cccb73c1d25bc` |
| gsvi-tts | 205304 | `d58d03eeaa03a51fe1ff8f7ee934ce5080f55a1a70f2ff0c968de8f1a5067f6c` |
| media-inspect | 203291 | `a49766f178a13f507e56212936971540c1fed1b6659400ba3eacb770791d79e0` |

### core — 54 changed paths

```text
docs/framework/plugin-foundation-2026-11-13.md
docs/plugins/README.md
docs/plugins/async-and-data.md
docs/plugins/bot-capabilities.md
docs/plugins/managed-media-and-speech.md
docs/plugins/package-and-config.md
pkgs/agent/src/host-tools.ts
pkgs/agent/src/toolkit.ts
pkgs/artifacts/src/access.ts
pkgs/artifacts/src/store.ts
pkgs/artifacts/src/tool.ts
services/bot/src/http/artifact-routes.ts
services/bot/src/http/resource-routes.ts
pkgs/jobs/src/worker.ts
pkgs/media/src/dependencies.ts
pkgs/media/src/service.ts
pkgs/media/src/tool.ts
pkgs/permissions/src/catalog.ts
pkgs/plugins/src/artifact-access.ts
pkgs/plugins/src/config.ts
pkgs/plugins/src/configuration/contracts.ts
pkgs/plugins/src/configuration/editor.ts
pkgs/plugins/src/contracts.ts
pkgs/plugins/src/host.ts
pkgs/plugins/src/invocation.ts
pkgs/plugins/src/jobs/context.ts
pkgs/plugins/src/management.ts
pkgs/plugins/src/manifest.ts
pkgs/plugins/src/media-rpc.ts
pkgs/plugins/src/rpc/services.ts
pkgs/plugin-sdk/src/index.ts
pkgs/plugin-sdk/src/services.ts
pkgs/plugins/src/service-rpc.ts
pkgs/plugins/src/service.ts
pkgs/resources/src/contracts.ts
pkgs/resources/src/editor.ts
pkgs/resources/src/schema.ts
pkgs/runtime/src/coordinator.ts
pkgs/runtime/src/delivery.ts
pkgs/integrations/src/gsvi/client.ts
pkgs/integrations/src/gsvi/configuration.ts
pkgs/integrations/src/gsvi/http.ts
pkgs/integrations/src/gsvi/identity.ts
pkgs/integrations/src/gsvi/schema.ts
pkgs/integrations/src/gsvi/wav.ts
tests/gsvi-service.test.ts
tests/media-download-lifecycle.test.ts
tests/plugin-foundation-boundaries.test.ts
tests/wav-fixture.ts
apps/web/src/plugins/configuration.ts
apps/web/src/plugins/grants.ts
apps/web/src/plugins/usage.ts
apps/web/src/resources/gsvi-form.ts
apps/web/src/resources/page.ts
```

### plugins — 32 changed paths

```text
bun.lock
docs/bot-api/README.md
docs/bot-api/async-and-data.md
docs/bot-api/bot-capabilities.md
docs/bot-api/managed-media-and-speech.md
docs/bot-api/package-and-config.md
docs/bot-api/snapshot.json
docs/migration/README.md
plugins/gsvi-tts/LICENSE
plugins/gsvi-tts/MIGRATION.md
plugins/gsvi-tts/NOTICE.md
plugins/gsvi-tts/README.md
plugins/gsvi-tts/ZOD-LICENSE.txt
plugins/gsvi-tts/_conf_schema.json
plugins/gsvi-tts/package.json
plugins/gsvi-tts/plugin.json
plugins/gsvi-tts/src/index.ts
plugins/gsvi-tts/src/settings.ts
plugins/media-inspect/LICENSE
plugins/media-inspect/MIGRATION.md
plugins/media-inspect/NOTICE.md
plugins/media-inspect/README.md
plugins/media-inspect/ZOD-LICENSE.txt
plugins/media-inspect/_conf_schema.json
plugins/media-inspect/package.json
plugins/media-inspect/plugin.json
plugins/media-inspect/src/index.ts
plugins/media-inspect/src/inspect.ts
scripts/sync-docs.ts
tests/foundation-fixture.ts
tests/media-foundation.test.ts
tests/tts-foundation.test.ts
```

Final state: local A implementation/validation handed back for independent final review. B/C have not started. Both repository HEADs remain the original specified baselines. No push, deployment, formal backend toggle or container/root operation was performed.

## Final Header configuration review correction

The reviewer-authored reviewer-header-roundtrip.ts reproduced ambiguous case variants in one Header object. The shared request/download Header schema now rejects duplicate names ignoring case, with the fixed message “Header 名称不可重复（不区分大小写）” and no values. This is new, undeployed configuration: ambiguous inputs are rejected rather than migrated. A single Header can still be recased while its masked placeholder restores the same effective authentication. The two separate groups may each have the same logical Header, retaining the documented download override policy.

Two focused regression tests cover request and download rejection in both service and editor draft schemas, sanitized errors, unchanged-name roundtrip and display-name/single-Header-case edits using actual Headers semantics. The independent script now reports rejectedAmbiguousInput:true; output is retained in reviewer-header-roundtrip-fixed.log. No other A behavior or UI control changed, so the previously verified isolated UI remains applicable and no unrelated browser work was repeated. Public API docs and plugin snapshot are synchronized. Full core/plugin checks, builds and tests plus plugin format and three reproducible package pairs were rerun; the tables above contain the refreshed results.

The regenerated core-final.patch, plugins-final.patch, SHA256SUMS and replay-verification.json are the current review artifacts. Stage 5 follows the preserved stages 1–4; both sequential and cumulative replay are verified anew against the same two fixed baselines, including all source/docs changes and new files. Previous uncommitted final receipts live under pre-header-review/. B/C remain unstarted; no deployment, formal configuration change, security-policy change, container/root operation or Git commit/push occurred.

## Independent acceptance of milestone A

The WSL reviewer independently reviewed this batch, reproduced and required fixes for media quota overbooking, indirect source dependency loss, producer-dependent archive reads, display-name changes invalidating synthesis, known format refusal classification and ambiguous Header credential preservation. All six authored review cases now pass. Independent final core verification passed 160 tests (0 failures, 1177 assertions), typecheck, isolated UI build and whitespace checks. The reviewer also inspected the recorded real-component UI screenshots and interaction receipt.

Milestone A is accepted as source implementation. It adds the narrow GSVI service, explicit gsvi-tts and media-inspect consumers, not full legacy automatic TTS or kuang parity. No deployment, production configuration change, container operation, paid upstream request or QQ send was performed. B/C remain staged backlog; no B/C worker has been launched in this batch. Final plugin checks and reproducible packs are rerun after synchronizing the API snapshot to the final committed core revision. Final receipts are recorded in the reviewer handoff and task artifacts, avoiding self-referential package hashes in their own inputs.

Reviewed feature commit: `da2dc9687de132de63498a903e54dd092d03fe7b`.

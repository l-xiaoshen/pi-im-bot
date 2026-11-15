# 插件存储、产物与部署

## 私有数据卷

插件数据按实例与聊天范围隔离，同一范围在不同代码版本间复用。固定容量 ext4 镜像由 `fuse2fs` 挂载，满额时返回 `ENOSPC`，不会改用未限额目录。

默认额度：每卷 64 MiB、每插件 1 GiB、全局 8 GiB、最多 128 卷，可在 `bot.json.plugins.storage` 调整。额度按镜像逻辑大小预留，已有卷不会因修改默认值自动扩缩容。

```text
plugins/<instance>/<revision>/                 固定代码
plugin-data/<deployment>/volumes.json           卷目录及预留
plugin-data/<deployment>/<instance>/<scope>/volume.img
plugin-data/<deployment>/views/<instance>/<scope>/files/
data/artifacts/                                 已发布产物
data/plugin-runtime/                            受管入口与 RPC
```

Worker 只读访问代码和父数据视图，只有 `/data/files` 可写。创建或文件系统检查失败的卷会隔离并继续计入预留，不会换成空目录伪装恢复。重新挂载前执行检查，正常停止先回收 Worker 再卸载。

直接部署需要 Linux、可访问的 `/dev/fuse`，以及 `mke2fs`、`e2fsck`、`fuse2fs`、`fusermount3`。缺失依赖时明确报错，不退化为普通目录。

## 发布产物

插件通过 `artifact.publish` 发布 `context.dataDir` 中的普通文件：

```js
const artifact = await context.host('artifact.publish', {
  path: 'output/report.pdf',
  name: 'report.pdf',
  mimeType: 'application/pdf'
})
return { text: '报告已生成', artifactIds: [artifact.id] }
```

operation/handler 与实例都需要 `artifact.write`。路径必须相对活动数据目录，不接受符号链接、特殊文件或越界路径。Core 流式复制并计算摘要，二进制不进入 RPC 帧或模型上下文；文件应在发布前写完并关闭。

Artifact 对所有生产者统一执行范围、单文件、数量和并发额度。达到上限会拒绝新写入。中断的临时文件按元数据恢复或清理，不会把损坏账本当作空账本。网页显示卷预留、使用量和产物额度，可核对已缺失文件所占的预留。

## 自定义切入点与数据关系

插件 operation 可启动自己声明的 point，其他插件通过显式依赖参与。transform、collect、select、policy、exclusive 和 observe 都由 Core 校验输入输出、字段写权限、依赖与执行顺序。

拥有者 schema 在独立验证 Worker 中执行，不加载业务入口，也不取得私有数据。自定义 point 的存储需求与 `data:scope` / `data:none` 调用配置分别计算；`data:none` 不提供私有卷或 `artifact.publish` 文件来源。

## 容器部署与备份

可信 Bot 控制面管理 Docker，插件 Worker 不取得 Docker socket。Bot 位于容器中时，需要配置 `hostPackageDir`、`hostDataDir`、`hostRuntimeDir` 的真实宿主映射；`plugin-data` bind 使用 `rshared`，Bot 容器还需要 `/dev/fuse` 和建立挂载所需的能力。

备份应包含配置、Bot data、固定插件快照、插件卷镜像与账本。复制卷前停止 Worker 并卸载文件系统。删除实例配置不会自动删除数据；卷扩缩容和业务数据迁移需要作为独立维护操作处理。

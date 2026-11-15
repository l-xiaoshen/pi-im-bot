# 包、manifest 与配置

## 包布局

```text
plugin.json                 静态能力与文件声明
_conf_schema.json           可选业务配置表单
README.md / CHANGELOG.md     可选文档
dist/index.mjs              推荐发布入口
assets/                     WASM、字体等声明资源
```

入口支持 JS/MJS/CJS 和 TS/MTS/CTS，TypeScript 由 Worker 中的 Bun 加载。`files` 必须包含入口、资源和全部运行依赖；导入不执行 `install`、`postinstall` 或 `build`，Worker 也不会自动安装依赖或加载 `.env`。

## 工具与指令声明

```json
{
  "apiVersion": 1,
  "id": "greeting",
  "name": "问候",
  "version": "0.1.0",
  "description": "工具和指令共用一个操作",
  "entry": "dist/index.mjs",
  "files": ["dist/index.mjs"],
  "operations": [
    {
      "id": "greet",
      "title": "问候",
      "description": "Return a scoped greeting",
      "tool": true,
      "execution": "foreground",
      "timeoutMs": 5000,
      "inputSchema": {
        "type": "object",
        "properties": { "text": { "type": "string" } },
        "required": ["text"],
        "additionalProperties": false
      }
    }
  ],
  "commands": [
    {
      "id": "greet",
      "names": ["问候", "greet"],
      "operation": "greet",
      "arguments": "text",
      "textField": "text"
    }
  ]
}
```

- `id` 标识包，`version` 使用语义版本；每次导入的内容另有 SHA-256 revision。
- `entry` 必须列入 `files`，包内拒绝越界路径、符号链接和特殊文件。
- `operations` 声明输入/输出 schema、grants、执行模式和期限；`tool` 默认 `true`。
- `commands` 引用已声明 operation，别名不能冲突。
- `hooks` / `points` 声明处理器和自定义切入点，详见 [Hook 与编排](hooks-and-composition.md)。
- `connections` 声明 MCP、插件实例、`gsvi@1`、`comfy@1` 等服务依赖。

`execution` 为 `foreground` 或 `background`，后台操作可配置 `poll`、`cancel`、`recover`。父任务或调用入口的更短期限始终优先。

```ts
return { text: "已完成", artifactIds: [], value: { count: 3 } }
```

`result.value` 既不是 `null` 也不是 `undefined` 时，`outputSchema` 校验该值；否则校验整个 `result`。`false`、`0`、空字符串和空集合都属于有效的 value。`suppressText: true` 用于只交付图片、音频等产物；大型二进制和私有后台句柄不应放进 `value`。

## `_conf_schema.json`

```json
{
  "prefix": {
    "type": "string",
    "description": "回复前缀",
    "default": "收到：",
    "scope": ["instance", "account", "room", "conversation"]
  },
  "api_key": {
    "type": "string",
    "description": "业务密钥",
    "secret": true,
    "default": ""
  }
}
```

支持 string/text/int/float/bool/object、字符串 list、标量 dict、template_list，以及 options、labels、slider、condition、invisible、readonly 和 secret。

- `scope` 默认仅实例；嵌套对象可给叶子字段开放账号、范围或 conversation 覆盖。
- 对象按字段合并，数组与字典整体覆盖。空字符串、`false`、空数组和空字典均为有效值。
- 恢复继承删除本层覆盖；`context.invocation.settings` 是本次调用的只读生效副本。
- 秘密字段仅实例层保存，接口不返回原值。替换或清除需要显式动作。
- template_list 使用 `__template_key` 和框架生成的 `__entry_id` 保持条目身份。
- condition 只做同层字段等值判断，不执行 JavaScript。
- `select_mcp`、`select_provider`、`select_model_group`、`select_persona` 只保存资源 ID，不额外授予调用能力。

静态表单 schema 与 manifest 的运行时 JSON Schema 是两套用途，通常不需要重复定义。配置表单不能声明任意 JavaScript 校验器或无界正则。

## 服务绑定

```json
{
  "connections": [
    {
      "alias": "images",
      "kind": "mcp",
      "title": "图像工具服务",
      "required": true,
      "setting": "backend"
    }
  ]
}
```

当 `backend` 使用 `_special: "select_mcp"` 时，框架从配置引用生成连接器映射。没有 `setting` 的依赖直接在实例配置中绑定。只有显式 `required` 的依赖阻止启用。

代码快照、实例配置、范围绑定和私有数据分别管理。

GSVI 插件可使用固定 `configurationProjection: "gsvi@1"` 在同一实例页编辑业务配置与托管连接字段，详见 [GSVI 配置](gsvi-native-configuration.md)。

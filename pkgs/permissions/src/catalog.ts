export const builtinCapabilities = [
  { id: 'comfy_catalog', name: '读取Comfy目录', kind: 'action' },
  { id: 'comfy_generate', name: '提交/核对Comfy任务', kind: 'action' },
  { id: 'comfy_manage', name: '管理Comfy政策（需显式授权）', kind: 'action' },
  { id: 'delegate_task', name: '委派后台子 Agent', kind: 'tool' },
  { id: 'start_job', name: '启动后台操作', kind: 'tool' },
  { id: 'job_list', name: '查看共享任务', kind: 'tool' },
  { id: 'job_status', name: '读取任务状态与结果', kind: 'tool' },
  { id: 'job_update', name: '修订共享任务', kind: 'tool' },
  { id: 'job_cancel', name: '停止指定任务', kind: 'tool' },
  { id: 'job_wait', name: '等待后台子任务', kind: 'tool' },
  { id: 'tool_search', name: 'Pi 工具搜索与装载', kind: 'tool' },
  { id: 'artifact_read', name: '读取本会话工具产物', kind: 'tool' },
  { id: 'media_read', name: '读取会话媒体与图片', kind: 'tool' },
  { id: 'artifact_publish', name: '发布容器中的产物', kind: 'tool' },
  { id: 'chat_history', name: '读取聊天历史', kind: 'tool' },
  { id: 'chat_send', name: '主动发送消息', kind: 'tool' },
  { id: 'chat_present', name: '受理 Agent 通知的受管呈现', kind: 'tool' },
  { id: 'message_recall', name: '撤回本群已发送消息的动作权限', kind: 'action' },
  { id: 'tts_voices', name: '查询语音服务音色', kind: 'action' },
  { id: 'tts_synthesize', name: '调用语音服务合成', kind: 'action' },
  { id: 'runtime_status', name: '读取 Bot 控制面可见系统状态', kind: 'action' },
  { id: 'schedule_create', name: '创建计划任务', kind: 'tool' },
  { id: 'schedule_list', name: '查看计划任务', kind: 'tool' },
  { id: 'schedule_delete', name: '删除计划任务', kind: 'tool' },
  { id: 'read', name: '容器读取文件', kind: 'tool' },
  { id: 'write', name: '容器写入文件', kind: 'tool' },
  { id: 'edit', name: '容器编辑文件', kind: 'tool' },
  { id: 'ls', name: '容器列出目录', kind: 'tool' },
  { id: 'bash', name: '容器 Shell', kind: 'tool' },
  { id: 'command:new', name: '新建／切换群对话', kind: 'command' },
  { id: 'command:stop', name: '停止群任务', kind: 'command' }
] as const

export function capabilityIds() {
  return builtinCapabilities.map((entry) => {
    return entry.id
  })
}
export function isActionCapability(id: string) {
  return builtinCapabilities.some((entry) => {
    return entry.kind === 'action' && entry.id === id
  })
}

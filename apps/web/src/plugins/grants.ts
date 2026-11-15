export function grantLabel(grant: string) {
  const names: Record<string, string> = {
    'system.status': '读取系统状态',
    'history.read': '读取聊天历史',
    'media.read': '读取本聊天入站媒体',
    'artifact.read': '读取产物',
    'artifact.write': '发布产物',
    'state.read': '读取本实例/聊天受管状态',
    'state.write': '修改本实例/聊天受管状态（CAS）',
    'authorization.inspect': '查询当前绘图操作权限',
    'delivery.send': '发送消息',
    'delivery.recall': '延后撤回消息'
  }
  if (grant.startsWith('connector:')) {
    return '调用服务 ' + grant.slice(10)
  }
  if (grant.startsWith('service:')) {
    return '调用具名服务 ' + grant.slice(8)
  }
  if (grant.startsWith('operation:')) {
    return '调用插件 ' + grant.slice(10)
  }
  if (grant.startsWith('point:')) {
    return '触发流程 ' + grant.slice(6)
  }
  return names[grant] ?? grant
}

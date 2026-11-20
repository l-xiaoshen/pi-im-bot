import { createClient, createConfig } from "./generated/client"
import type { Client } from "./generated/client"
import * as sdk from "./generated/sdk.gen"
import { httpApiCallPost } from "./generated/sdk.gen"
import type {
  Action,
  ActionName,
  CanSendResponse,
  CookiesResponse,
  CredentialsResponse,
  CsrfTokenResponse,
  FriendListResponse,
  GetForwardMsgResponse,
  GetMsgResponse,
  GroupHonorInfoResponse,
  GroupInfo,
  GroupListResponse,
  GroupMemberInfo,
  GroupMemberListResponse,
  ImageResponse,
  LoginInfoResponse,
  MessageIdResponse,
  RecordResponse,
  ResponseStatus,
  Status,
  StrangerInfoResponse,
  VersionInfoResponse
} from "./generated/types.gen"

/** OneBot API 响应信封。 */
export interface OneBotApiResponse<T = unknown> {
  status: ResponseStatus
  retcode: number
  data?: T
  message?: string
  wording?: string
  echo?: string | bigint
}

type ActionFunction = (options: {
  body?: Record<string, unknown>
  client?: Client
  headers?: { authorization?: string }
}) => Promise<{
  data?: OneBotApiResponse
  error?: unknown
  response?: Response
}>

const actionFunctions: Record<string, ActionFunction> = {
  send_private_msg: sdk.httpActionsSendPrivateMsg as ActionFunction,
  send_group_msg: sdk.httpActionsSendGroupMsg as ActionFunction,
  send_msg: sdk.httpActionsSendMsg as ActionFunction,
  delete_msg: sdk.httpActionsDeleteMsg as ActionFunction,
  get_msg: sdk.httpActionsGetMsg as ActionFunction,
  get_forward_msg: sdk.httpActionsGetForwardMsg as ActionFunction,
  send_like: sdk.httpActionsSendLike as ActionFunction,
  set_group_kick: sdk.httpActionsSetGroupKick as ActionFunction,
  set_group_ban: sdk.httpActionsSetGroupBan as ActionFunction,
  set_group_anonymous_ban: sdk.httpActionsSetGroupAnonymousBan as ActionFunction,
  set_group_whole_ban: sdk.httpActionsSetGroupWholeBan as ActionFunction,
  set_group_admin: sdk.httpActionsSetGroupAdmin as ActionFunction,
  set_group_anonymous: sdk.httpActionsSetGroupAnonymous as ActionFunction,
  set_group_card: sdk.httpActionsSetGroupCard as ActionFunction,
  set_group_name: sdk.httpActionsSetGroupName as ActionFunction,
  set_group_leave: sdk.httpActionsSetGroupLeave as ActionFunction,
  set_group_special_title: sdk.httpActionsSetGroupSpecialTitle as ActionFunction,
  set_friend_add_request: sdk.httpActionsSetFriendAddRequest as ActionFunction,
  set_group_add_request: sdk.httpActionsSetGroupAddRequest as ActionFunction,
  get_login_info: sdk.httpActionsGetLoginInfo as ActionFunction,
  get_stranger_info: sdk.httpActionsGetStrangerInfo as ActionFunction,
  get_friend_list: sdk.httpActionsGetFriendList as ActionFunction,
  get_group_info: sdk.httpActionsGetGroupInfo as ActionFunction,
  get_group_list: sdk.httpActionsGetGroupList as ActionFunction,
  get_group_member_info: sdk.httpActionsGetGroupMemberInfo as ActionFunction,
  get_group_member_list: sdk.httpActionsGetGroupMemberList as ActionFunction,
  get_group_honor_info: sdk.httpActionsGetGroupHonorInfo as ActionFunction,
  get_cookies: sdk.httpActionsGetCookies as ActionFunction,
  get_csrf_token: sdk.httpActionsGetCsrfToken as ActionFunction,
  get_credentials: sdk.httpActionsGetCredentials as ActionFunction,
  get_record: sdk.httpActionsGetRecord as ActionFunction,
  get_image: sdk.httpActionsGetImage as ActionFunction,
  can_send_image: sdk.httpActionsCanSendImage as ActionFunction,
  can_send_record: sdk.httpActionsCanSendRecord as ActionFunction,
  get_status: sdk.httpActionsGetStatus as ActionFunction,
  get_version_info: sdk.httpActionsGetVersionInfo as ActionFunction,
  set_restart: sdk.httpActionsSetRestart as ActionFunction,
  clean_cache: sdk.httpActionsCleanCache as ActionFunction,
  ".handle_quick_operation": sdk.httpActionsHandleQuickOperation as ActionFunction
}

/** 每个 API 动作对应的响应数据类型。 */
export interface ActionResponseMap {
  send_private_msg: MessageIdResponse
  send_group_msg: MessageIdResponse
  send_msg: MessageIdResponse
  delete_msg: undefined
  get_msg: GetMsgResponse
  get_forward_msg: GetForwardMsgResponse
  send_like: undefined
  set_group_kick: undefined
  set_group_ban: undefined
  set_group_anonymous_ban: undefined
  set_group_whole_ban: undefined
  set_group_admin: undefined
  set_group_anonymous: undefined
  set_group_card: undefined
  set_group_name: undefined
  set_group_leave: undefined
  set_group_special_title: undefined
  set_friend_add_request: undefined
  set_group_add_request: undefined
  get_login_info: LoginInfoResponse
  get_stranger_info: StrangerInfoResponse
  get_friend_list: FriendListResponse
  get_group_info: GroupInfo
  get_group_list: GroupListResponse
  get_group_member_info: GroupMemberInfo
  get_group_member_list: GroupMemberListResponse
  get_group_honor_info: GroupHonorInfoResponse
  get_cookies: CookiesResponse
  get_csrf_token: CsrfTokenResponse
  get_credentials: CredentialsResponse
  get_record: RecordResponse
  get_image: ImageResponse
  can_send_image: CanSendResponse
  can_send_record: CanSendResponse
  get_status: Status
  get_version_info: VersionInfoResponse
  set_restart: undefined
  clean_cache: undefined
  ".handle_quick_operation": undefined
}

type MethodName<Name extends string> = Name extends `.${infer Rest}` ? Rest : Name

type MissingActionResponses = Exclude<Action["action"], keyof ActionResponseMap>
type Assert<T extends true> = T
type _ActionResponseMapIsComplete = Assert<MissingActionResponses extends never ? true : false>

type ClientMethod<A extends Action> = undefined extends A["params"]
  ? (params?: Exclude<A["params"], undefined>) => Promise<ActionResponseMap[A["action"]]>
  : (params: A["params"]) => Promise<ActionResponseMap[A["action"]]>

/**
 * 根据 `Action` 联合类型推导出的 OneBot 客户端。
 *
 * 每个标准 API 动作都会成为一个方法，参数和返回值由生成的类型自动推导。
 * 标准之外的动作可以通过 `call` 方法调用。
 */
export type OneBotClient = {
  [A in Action as MethodName<A["action"]>]: ClientMethod<A>
} & {
  /** 调用标准之外的自定义动作。 */
  call(action: ActionName, params?: Record<string, unknown>): Promise<unknown>
}

export interface OneBotClientOptions {
  /** OneBot HTTP API 的基础地址，例如 `http://127.0.0.1:5700`。 */
  baseUrl: string
  /** access token，会以 `Authorization: Bearer <token>` 发送。 */
  accessToken?: string
  /** 自定义 fetch 实现。 */
  fetch?: typeof fetch
}

/** OneBot API 返回 `failed` 时抛出的错误。 */
export class OneBotApiError extends Error {
  readonly status: OneBotApiResponse["status"]
  readonly retcode: number
  readonly wording?: string

  constructor(response: OneBotApiResponse) {
    super(response.message ?? response.wording ?? `OneBot API error ${response.retcode}`)
    this.name = "OneBotApiError"
    this.status = response.status
    this.retcode = response.retcode
    this.wording = response.wording
  }
}

/** OneBot HTTP 请求失败时抛出的错误。 */
export class OneBotHttpError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(`OneBot HTTP error ${status}`)
    this.name = "OneBotHttpError"
    this.status = status
    this.body = body
  }
}

/**
 * 创建 OneBot 客户端。
 *
 * 客户端通过 HTTP API 的 `/:action` 端点调用 OneBot 实现。
 */
export function createOneBotClient(options: OneBotClientOptions): OneBotClient {
  const client = createClient(
    createConfig({
      baseUrl: options.baseUrl,
      fetch: options.fetch
    })
  )

  function unwrap(result: { data?: OneBotApiResponse; error?: unknown; response?: Response }): unknown {
    if (result.error !== undefined) {
      throw new OneBotHttpError(result.response?.status ?? 0, result.error)
    }
    const response = result.data
    if (!response) {
      throw new Error("OneBot API returned no data")
    }
    if (response.status === "failed") {
      throw new OneBotApiError(response)
    }
    return response.data
  }

  async function request(action: ActionName, params?: Record<string, unknown>): Promise<unknown> {
    let headers: { authorization: string } | undefined
    if (options.accessToken) {
      headers = { authorization: `Bearer ${options.accessToken}` }
    }
    const actionFunction = actionFunctions[action]
    if (actionFunction) {
      return unwrap(await actionFunction({ body: params, client, headers }))
    }
    return unwrap(
      await httpApiCallPost({
        client,
        path: { action },
        body: params,
        headers
      })
    )
  }

  return new Proxy({} as OneBotClient, {
    get(_target, property) {
      if (typeof property !== "string") {
        return undefined
      }
      if (property === "then" || property === "catch" || property === "finally" || property === "toJSON") {
        return undefined
      }
      if (
        property === "toString" ||
        property === "valueOf" ||
        property === "hasOwnProperty" ||
        property === "isPrototypeOf" ||
        property === "propertyIsEnumerable" ||
        property === "constructor"
      ) {
        return Reflect.get(_target, property)
      }
      if (property === "call") {
        return (action: ActionName, params?: Record<string, unknown>) => request(action, params)
      }
      return (params?: unknown) => request(property as ActionName, params as Record<string, unknown> | undefined)
    }
  })
}

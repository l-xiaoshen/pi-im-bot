import "@typespec/http";

using TypeSpec.Http;

namespace OneBot;

/** HTTP 或 WebSocket API 调用信封。 */
model ApiRequest {
  /** 动作名称，可附加 `_async` 或 `_rate_limited` 后缀。 */
  action: string;
  /** 动作参数。 */
  params?: Record<unknown>;
  /** echo 值，会在响应中原样返回。 */
  echo?: string | int64;
}

/** API 响应状态。 */
enum ResponseStatus {
  "ok",
  "failed",
  "async",
}

/** API 响应信封。 */
model ApiResponse<T = unknown> {
  /** 响应状态。 */
  status: ResponseStatus;
  /** 返回码。 */
  retcode: int32;
  /** 响应数据。 */
  data?: T;
  /** 错误信息。 */
  message?: string;
  /** 错误描述。 */
  wording?: string;
  /** 请求中的 echo 值。 */
  echo?: string | int64;
}

/** HTTP API 成功响应。 */
model HttpApiResponse is ApiResponse<unknown> {
  /** HTTP 状态码。 */
  @statusCode statusCode: 200;
}

/** access token 未提供。 */
@error
model UnauthorizedResponse {
  @statusCode statusCode: 401;
}

/** access token 不符合。 */
@error
model ForbiddenResponse {
  @statusCode statusCode: 403;
}

/** POST 请求的 Content-Type 不支持。 */
@error
model UnsupportedMediaTypeResponse {
  @statusCode statusCode: 406;
}

/** POST 请求的正文格式不正确。 */
@error
model BadRequestResponse {
  @statusCode statusCode: 400;
}

/** API 不存在。 */
@error
model NotFoundResponse {
  @statusCode statusCode: 404;
}

/**
 * OneBot HTTP API 接受路径为 `/:action`（或 `/:action/`）的请求，
 * 参数可以通过 query 参数、urlencoded 表单或 JSON 传递。
 */
@route("/{action}")
@tag("API")
interface HttpApi {
  /**
   * 使用 query 参数调用 API。具体 API 的参数作为额外的 query 参数传入。
   */
  @get callGet(
    @path action: ActionName,
    /** `Bearer <access token>`。 */
    @header authorization?: string,
    /** 也可以通过 query 参数传入 access token。 */
    @query access_token?: string
  ): HttpApiResponse | UnauthorizedResponse | ForbiddenResponse | NotFoundResponse;

  /**
   * 使用 JSON 或 urlencoded 表单请求体调用 API。
   */
  @post callPost(
    @path action: ActionName,
    /** `Bearer <access token>`。 */
    @header authorization?: string,
    /** 也可以通过 query 参数传入 access token。 */
    @query access_token?: string,
    /** 参数可以通过 JSON 或 urlencoded 表单传递。 */
    @body params?: Record<unknown>
  ):
    | HttpApiResponse
    | UnauthorizedResponse
    | ForbiddenResponse
    | UnsupportedMediaTypeResponse
    | BadRequestResponse
    | NotFoundResponse;
}

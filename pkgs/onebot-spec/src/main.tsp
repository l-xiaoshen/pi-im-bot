import "@typespec/http";
import "@typespec/openapi";

import "./common.tsp";
import "./segment.tsp";
import "./message.tsp";
import "./event.tsp";
import "./api.tsp";
import "./communication.tsp";
import "./http.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

/**
 * OneBot 11 标准定义。
 *
 * @see https://github.com/botuniverse/onebot-11
 */
@service(#{ title: "OneBot 11" })
namespace OneBot;

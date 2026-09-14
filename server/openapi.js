import { VERSION } from './version.js';
const str = { type: "string" };
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const body = (schema) => ({
  required: true,
  content: { "application/json": { schema } },
});
const response = (schema) => ({
  description: "成功",
  content: { "application/json": { schema } },
});
const id = { name: "id", in: "path", required: true, schema: str };
const input = {
  type: "object",
  required: ["title"],
  properties: {
    title: { ...str, maxLength: 200 },
    content: { ...str, description: "Markdown 正文或图片说明" },
    tags: { type: "array", items: str },
    collection_id: { type: "string", nullable: true },
    favorite: { type: "boolean" },
    archive_images: { type: 'boolean', default: true, description: '保存笔记时归档外部配图；返回 image_archive 结果。设为 false 保留外链。' },
    source_url: { type: 'string', format: 'uri', nullable: true, description: 'HTTP(S) 采集来源' },
    captured_at: { type: 'string', format: 'date-time', nullable: true },
  },
};
const errorResponses = {
  400: { description: "参数不正确，响应包含 error 和可选 details" },
  401: { description: "需要登录或 Bearer 令牌" },
  403: { description: "权限不足" },
  404: { description: "资源不存在" },
  409: { description: "版本冲突或名称重复" },
};
// Group metadata is returned on each item; creation is supported by asset uploads.
const operation = (summary, schema, extra = {}) => ({
  summary,
  responses: { 200: response(schema), ...errorResponses },
  ...extra,
});
const list = (schema) => ({ type: "array", items: schema });
export const spec = {
  openapi: "3.0.3",
  info: {
    title: "ZNote API",
    version: VERSION,
    description:
      "网页与插件共用同一套 API。外部工具发送 Authorization: Bearer zn_…；浏览器使用 HttpOnly Cookie。read 令牌只读，write 令牌可管理内容，令牌管理与导出需要管理员浏览器会话。所有时间为 UTC ISO 8601。删除可恢复；事件接口适用于轮询集成。",
  },
  servers: [{ url: "/" }],
  security: [{ bearerAuth: [] }, { sessionCookie: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      sessionCookie: { type: "apiKey", in: "cookie", name: "znote_session" },
    },
    schemas: {
      ItemInput: input,
      SavedViewConfig: {
        type: 'object', additionalProperties: false,
        required: ['view', 'query', 'tags', 'mode', 'sort', 'layout'],
        properties: {
          view: { type: 'string', enum: ['all', 'images', 'videos', 'notes', 'favorites', 'trash'] },
          query: { ...str, maxLength: 200 }, tags: { type: 'array', maxItems: 30, items: { ...str, minLength: 1, maxLength: 40 } },
          mode: { type: 'string', enum: ['all', 'any'] }, sort: { type: 'string', enum: ['updated', 'created', 'title'] }, layout: { type: 'string', enum: ['grid', 'list'] },
        },
      },
      SavedView: { type: 'object', properties: {
        id: { ...str, format: 'uuid' }, collection_id: { ...str, nullable: true, format: 'uuid' }, name: { ...str, maxLength: 80 }, config: ref('SavedViewConfig'),
        version: { type: 'integer', minimum: 1 }, created_at: { ...str, format: 'date-time' }, updated_at: { ...str, format: 'date-time' },
      } },
      NoteVersion: {
        type: 'object',
        properties: { id: str, version: { type: 'integer' }, saved_at: { ...str, format: 'date-time' }, title: str },
      },
      Item: {
        allOf: [
          input,
          {
            type: "object",
            properties: {
              id: str,
              kind: { type: "string", enum: ["image", "note", "video"] },
              duration: { type: 'number', nullable: true, description: '视频时长，秒；容器未提供时为 null' },
              video_codec: { type: 'string', nullable: true },
              url: { type: "string", nullable: true },
              thumbnail_url: { type: "string", nullable: true },
              version: { type: "integer" },
              created_at: str,
              updated_at: str,
              deleted_at: { type: "string", nullable: true },
              width: { type: "integer", nullable: true },
              height: { type: "integer", nullable: true },
              bytes: { type: "integer", nullable: true },
              stored_bytes: {
                type: "integer",
                nullable: true,
                description: "无损存储后的文件字节数",
              },
              storage_codec: { type: "string", enum: ["identity", "gzip"] },
              mime: { type: "string", nullable: true },
            },
          },
        ],
      },
      Collection: {
        type: "object",
        required: ["name"],
        properties: {
          id: str,
          name: str,
          color: { ...str, example: "#287464" },
        },
      },
    },
  },
  paths: {
    '/api/saved-views': {
      get: operation('当前知识库的常用筛选（默认未分类，最多 50 个）', { type: 'object', properties: { views: list(ref('SavedView')) } }, {
        parameters: [{ name: 'collection', in: 'query', schema: str, description: '知识库 UUID 或 unfiled；省略时仅返回未分类' }],
      }),
      post: operation('保存一组常用筛选；同库名称唯一，不修改内容', ref('SavedView'), {
        requestBody: body({ type: 'object', additionalProperties: false, required: ['name', 'config'], properties: { name: { ...str, minLength: 1, maxLength: 80 }, collection_id: { ...str, nullable: true, format: 'uuid', default: null }, config: ref('SavedViewConfig') } }),
        responses: { 201: response(ref('SavedView')), ...errorResponses },
      }),
    },
    '/api/saved-views/{id}': {
      get: operation('读取常用筛选', ref('SavedView'), { parameters: [id] }),
      patch: operation('重命名或替换条件，必须提供当前 version；不支持跨库移动', ref('SavedView'), {
        parameters: [id], requestBody: body({ type: 'object', additionalProperties: false, required: ['version'], properties: { name: { ...str, minLength: 1, maxLength: 80 }, config: ref('SavedViewConfig'), version: { type: 'integer', minimum: 1 } } }),
      }),
      delete: {
        summary: '删除筛选定义；保留所有内容', parameters: [id],
        requestBody: body({ type: 'object', additionalProperties: false, required: ['version'], properties: { version: { type: 'integer', minimum: 1 } } }),
        responses: { 204: { description: '筛选已删除，内容保留' }, ...errorResponses },
      },
    },
    "/api/health": {
      get: operation("服务健康", { type: "object" }, { security: [] }),
    },
    "/api/auth/status": {
      get: operation("是否已经初始化", { type: "object" }, { security: [] }),
    },
    "/api/auth/setup": {
      post: operation(
        "首次设置密码（默认仅允许本机）",
        { type: "object" },
        {
          security: [],
          requestBody: body({
            type: "object",
            required: ["password"],
            properties: { password: { type: "string", minLength: 4 } },
          }),
          responses: { 201: response({ type: "object" }), ...errorResponses },
        },
      ),
    },
    "/api/auth/login": {
      post: operation(
        "密码登录，设置会话 Cookie",
        { type: "object" },
        {
          security: [],
          requestBody: body({
            type: "object",
            required: ["password"],
            properties: { password: str },
          }),
        },
      ),
    },
    "/api/auth/logout": { post: operation("退出当前会话", { type: "object" }) },
    "/api/me": { get: operation("当前权限", { type: "object" }) },
    "/api/info": {
      get: operation("版本、局域网地址和上传限制", { type: "object" }),
    },
    "/api/stats": { get: operation("内容统计", { type: "object" }) },
    "/api/items": {
      get: operation(
        "搜索和筛选内容",
        {
          type: "object",
          properties: {
            items: list(ref("Item")),
            total: { type: "integer" },
            limit: { type: "integer" },
            offset: { type: "integer" },
            event_cursor: { type: "integer", description: "查询时的最新变更游标，用于非打断式更新提示" },
          },
        },
        {
          parameters: [
            "q",
            "kind",
            "collection",
            "tag",
            "favorite",
            "trash",
            "sort",
            "limit",
            "offset",
          ].map((name) => ({
            name,
            in: "query",
            schema: ["limit", "offset"].includes(name)
              ? { type: "integer" }
              : str,
            description: {
              q: "检索标题、正文、标签；支持中文子串",
              kind: "image、video 或 note",
              collection: "知识库 ID",
              tag: "精确标签",
              favorite: "true 只返回收藏",
              trash: "true 查看回收站",
              sort: "updated（默认）、created、title",
              limit: "1–100，默认 60",
              offset: "从 0 开始",
            }[name],
          })),
        },
      ),
      post: operation("创建 Markdown 笔记", ref("Item"), {
        requestBody: body(ref("ItemInput")),
        responses: { 201: response(ref("Item")), ...errorResponses },
      }),
    },
    "/api/items/{id}": {
      get: operation("读取内容详情", ref("Item"), { parameters: [id] }),
      patch: operation("更新内容（必须提供当前 version）", ref("Item"), {
        parameters: [id],
        requestBody: body({
          ...input,
          required: ["version"],
          properties: {
            ...input.properties,
            version: { type: "integer", minimum: 1 },
          },
        }),
      }),
      delete: {
        summary: "移入回收站",
        parameters: [id],
        responses: { 204: { description: "成功" }, ...errorResponses },
      },
    },
    "/api/items/{id}/versions": {
      get: operation('笔记版本记录（最近 50 个，单篇压缩上限 8 MiB）', {
        type: 'object', properties: { versions: list(ref('NoteVersion')) },
      }, { parameters: [id] }),
    },
    "/api/items/{id}/versions/{versionId}": {
      get: operation('读取历史正文；载入后通过普通 PATCH 保存，仍须提供当前 version', {
        allOf: [ref('NoteVersion'), { type: 'object', properties: { content: str, tags: list(str) } }],
      }, { parameters: [id, { name: 'versionId', in: 'path', required: true, schema: str }] }),
    },
    "/api/items/{id}/restore": {
      post: operation("从回收站恢复", ref("Item"), { parameters: [id] }),
    },
    "/api/items/{id}/backlinks": {
      get: operation("查找引用该内容的笔记", list(ref("Item")), {
        parameters: [id],
      }),
    },
    "/api/assets": {
      post: operation("上传图片（25 MB，按内容哈希去重）", ref("Item"), {
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: { type: "string", format: "binary" },
                  title: str,
                  content: str,
                  tags: { ...str, description: 'JSON 数组字符串，如 ["灵感"]' },
                  collection_id: str,
                  source_url: { ...str, description: 'HTTP(S) 来源网址；提供时自动记录采集时间' },
                  captured_at: { ...str, format: 'date-time' },
                  group_key: { ...str, maxLength: 200, description: '可选作品组标识，例如 pixiv:art:12345 或 paw:fanbox:1:2；空串切换为逐张展示。按知识库隔离，以作品身份、原文件哈希及原始页序去重，保留手工组与笔记归属。' },
                  group_index: { type: 'integer', minimum: 0, maximum: 10000, description: '作品内从 0 开始的页序，相同原文件的不同页保留独立记录并共享文件' },
                  group_title: { ...str, maxLength: 200, description: '分组封面标题' },
                },
              },
            },
          },
        },
        responses: {
          201: response(ref("Item")),
          200: response({
            allOf: [
              ref("Item"),
              {
                type: "object",
                properties: { duplicate: { type: "boolean" } },
              },
            ],
          }),
          ...errorResponses,
          415: { description: "图片格式不支持" },
        },
      }),
    },
    '/api/videos': {
      post: operation('上传视频（MP4/WebM/MOV，500 MB，保留原字节并去重）', ref('Item'), {
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, title: str, content: str, tags: { ...str, description: 'JSON 字符串数组' }, collection_id: str } } } } },
        responses: { 201: response(ref('Item')), 200: response(ref('Item')), ...errorResponses, 415: { description: '不支持的视频容器或未发现视频流' } },
      }),
    },
    "/media/{id}/{variant}": {
      get: {
        summary: "获取受保护的原图、视频或图片缩略图；视频 original 支持 Range/If-Range 和 HEAD",
        parameters: [
          id,
          {
            name: "variant",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["original", "thumbnail"] },
          },
        ],
        responses: { 200: { description: "媒体二进制" }, 206: { description: '视频字节范围，包含 Content-Range 与 Accept-Ranges' }, 416: { description: '无效或不可满足的字节范围' }, ...errorResponses },
      },
    },
    "/api/collections": {
      get: operation("知识库列表", list(ref("Collection"))),
      post: operation("创建知识库", ref("Collection"), {
        requestBody: body(ref("Collection")),
        responses: { 201: response(ref("Collection")), ...errorResponses },
      }),
    },
    "/api/collections/{id}": {
      patch: operation("重命名知识库", ref("Collection"), {
        parameters: [id],
        requestBody: body(ref("Collection")),
      }),
      delete: {
        summary: "删除知识库，保留内容并取消归属",
        parameters: [id],
        responses: { 204: { description: "成功" }, ...errorResponses },
      },
    },
    "/api/tags": { get: operation("当前知识库标签搜索与分页", {oneOf:[list({type:'object',properties:{name:str,count:{type:'integer'}}}),{type:'object',properties:{tags:list({type:'object',properties:{name:str,count:{type:'integer'}}}),total:{type:'integer'},limit:{type:'integer'},offset:{type:'integer'},cursor:{type:'integer'}}}]}, {description:'不传 limit 时保留完整数组响应；传 limit 返回分页对象，按使用次数倒序、名称排序。标签只统计未删除内容；省略 collection 为未分类。cursor 不匹配时返回 409，请重读第一页。',parameters:[{name:'collection',in:'query',schema:str},{name:'q',in:'query',schema:{type:'string',maxLength:200},description:'不区分大小写的字面子串，不解释通配符'},{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100}},{name:'offset',in:'query',schema:{type:'integer',minimum:0,maximum:1000000,default:0}},{name:'cursor',in:'query',schema:{type:'integer',minimum:0}}]}) },
    "/api/tokens": {
      get: operation("API 令牌列表（管理员）", list({ type: "object" })),
      post: operation(
        "创建令牌，原始值只返回一次（管理员）",
        { type: "object" },
        {
          requestBody: body({
            type: "object",
            required: ["name", "scope"],
            properties: {
              name: str,
              scope: { type: "string", enum: ["read", "write", "notify"] },
            },
          }),
          responses: { 201: response({ type: "object" }), ...errorResponses },
        },
      ),
    },
    "/api/tokens/{id}": {
      delete: {
        summary: "撤销 API 令牌（管理员）",
        parameters: [id],
        responses: { 204: { description: "成功" }, ...errorResponses },
      },
    },
    "/api/events": {
      get: operation(
        "增量变更事件，最多 100 条（保存 cursor 继续读取）",
        {
          type: "object",
          properties: {
            events: list({ type: "object" }),
            cursor: { type: "integer" },
          },
        },
        {
          parameters: [
            {
              name: "after",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
        },
      ),
    },
    "/api/export": {
      get: {
        summary: "多模式导出（管理员）",
        parameters: [
          { name: 'layout', in: 'query', schema: { type: 'string', enum: ['readable', 'legacy'], default: 'readable' }, description: 'readable 使用知识库/可读文件名；legacy 保留旧 UUID 路径' },
          {
            name: "mode",
            in: "query",
            schema: {
              type: "string",
              enum: [
                "portable",
                "images",
                "markdown",
                "json",
                "html",
                "backup",
              ],
              default: "portable",
            },
          },
          {
            name: "collection",
            in: "query",
            schema: str,
            description:
              "知识库 ID 或 unfiled；省略为全部。backup 模式不可设置。图文导出自动包含引用的跨库图片。",
          },
          {
            name: "include_trash",
            in: "query",
            schema: {
              type: "string",
              enum: ["true", "false"],
              default: "true",
            },
            description: "是否包含回收站；backup 始终包含。",
          },
        ],
        responses: {
          200: {
            description: "ZIP 文件",
            content: {
              "application/zip": {
                schema: { type: "string", format: "binary" },
              },
              "application/json": { schema: { type: "object" } },
            },
          },
          ...errorResponses,
        },
      },
    },
    "/api/openapi.json": {
      get: operation("OpenAPI 描述文件", { type: "object" }),
    },
  },
};
const importJob = { type: 'object', properties: { id: str, status: { type: 'string', enum: ['queued','running','saving','completed','failed','cancelled'] }, message: str, source_url: str, collection_id:{...str,nullable:true},title:str,retried_as:str,item_id: str, duplicate: { type: 'boolean' }, created_at: { type: 'string', format: 'date-time' }, finished_at: { type: 'string', format: 'date-time' } } };
spec.paths['/api/streams'] = { post: { summary: '合并浏览器采集的 HLS 分片：保存入库或只下载 MP4（write 权限）', description: 'files 中仅允许 index.m3u8、video.m3u8、audio.m3u8、part-N.bin。所有 URI 必须改写为这些包内文件名；仅 index 可以是主清单，媒体清单须以 EXT-X-ENDLIST 结束。支持普通 AES-128，不支持 DRM。最多 1203 文件、合计 500 MB，单清单最多 2 MB。同时处理一个请求；合并不重新编码。', parameters: [{ name: 'mode', in: 'query', schema: { type: 'string', enum: ['save','download'], default: 'save' } }], requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', maxItems: 1203, items: { type: 'string', format: 'binary' } }, title: str, source_url: { ...str, format: 'uri' }, tags: { ...str, description: 'JSON 标签数组' }, collection_id: str, content: str } } } } }, responses: { 200: { description: '重复条目 JSON；download 模式为 video/mp4' }, 201: response(ref('Item')), 413: { description: '合计超过 500 MB' }, 415: { description: '媒体无法合并为 MP4' }, 429: { description: '已有合并任务，请稍后重试' }, ...errorResponses } } };
spec.paths['/api/imports'] = {
  get: operation('最近 50 条网络视频采集记录；服务重启会清空，已入库内容保留', { type: 'object', properties: { jobs: list(importJob) } }),
  post: operation('排队采集 Bilibili、抖音、小红书、X 单条公开视频；不读取浏览器 Cookie，单条最多 500 MB', importJob, { requestBody: body({ type: 'object', required: ['url'], properties: { url: { ...str, format: 'uri', maxLength: 4096 }, collection_id: { ...str, nullable: true }, tags: { type: 'array', maxItems: 30, items: { ...str, maxLength: 40 } } } }), responses: { 202: response(importJob), ...errorResponses, 429: { description: '队列最多 8 条未完成任务' } } }),
};
spec.paths['/api/imports/{id}'] = {
  get: operation('读取采集状态和成功后的 item_id', importJob, { parameters: [id] }),
  delete: operation('取消等待或下载中的采集；入库阶段不可取消', importJob, { parameters: [id] }),
};
spec.paths['/api/imports/{id}/retry']={post:operation('按原知识库、来源与标签重试失败或取消的采集',importJob,{parameters:[id],description:'需要 write 权限。原记录返回 retried_as 指向后续任务；后续记录仍在时，重复提交返回同一任务。若后续任务也失败，重试后续任务 ID。活动或成功任务不能重试；服务重启清空记录。',responses:{202:response(importJob),...errorResponses}})};

spec.paths["/api/items"].get.parameters.push(
  {
    name: "tags",
    in: "query",
    schema: str,
    description: '多个标签的 JSON 数组字符串，例如 ["设计","素材"]',
  },
  {
    name: "tag_mode",
    in: "query",
    schema: { type: "string", enum: ["all", "any"], default: "all" },
    description: "全部匹配或任意匹配",
  },
);
spec.paths["/api/assets/batch"] = {
  post: operation(
    "批量上传图片，逐文件返回结果；重复图片保留原有分类和标签",
    { type: "object" },
    {
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["files"],
              properties: {
                files: {
                  type: "array",
                  maxItems: 20,
                  items: { type: "string", format: "binary" },
                },
                collection_id: str,
                group_key: {...str,maxLength:200,description:'非空时将本批文件放入该作品组'},
                group_index: {type:'integer',minimum:0,maximum:10000,default:0,description:'组内起始页序；按本批文件顺序递增，失败项不改变后续页序'},
                group_title: {...str,maxLength:200},
                tags: {
                  ...str,
                  description: "JSON 数组字符串，统一设置上传文件的多个标签",
                },
              },
            },
          },
        },
      },
      responses: {
        200: response({ type: "object" }),
        207: {
          description:
            "部分失败，results 含 filename/status/item 或 error/status_code",
          content: { "application/json": { schema: { type: "object" } } },
        },
        ...errorResponses,
      },
    },
  ),
};
const preferencesSchema = {
  type: "object",
  required: ["default_collection_id"],
  properties: {
    default_collection_id: {
      type: "string",
      nullable: true,
      description: "知识库 ID、unfiled（未分类）、null（知识库入口）",
    },
  },
};
spec.paths["/api/preferences"] = {
  get: operation("读取默认首页设置", preferencesSchema),
  patch: operation("设置默认首页（管理员）", preferencesSchema, {
    requestBody: body(preferencesSchema),
  }),
};
spec.paths["/api/storage"] = {
  get: operation("存储文件大小及无损节省量（管理员）", {
    type: "object",
    properties: Object.fromEntries(
      [
        "source_bytes",
        "stored_bytes",
        "media_bytes",
        "database_bytes",
        "total_bytes",
        "media_saved_bytes",
        "total_saved_bytes",
      ].map((name) => [name, { type: "integer" }]),
    ),
  }),
};
spec.paths["/api/items/batch-tags"] = {
  post: operation(
    "事务性批量添加、删除或替换标签；任一版本冲突则全部回滚",
    { type: "object", properties: { items: list(ref("Item")) } },
    {
      requestBody: body({
        type: "object",
        required: ["items", "tags"],
        properties: {
          items: {
            type: "array",
            minItems: 1,
            maxItems: 10000,
            items: {
              type: "object",
              required: ["id", "version"],
              properties: { id: str, version: { type: "integer", minimum: 1 } },
            },
          },
          tags: {
            type: "array",
            maxItems: 30,
            items: { type: "string", maxLength: 40 },
          },
          mode: {
            type: "string",
            enum: ["add", "remove", "replace"],
            default: "add",
          },
        },
      }),
    },
  ),
};
spec.paths['/api/items/{id}/copy'] = {
  post: operation('复用图片到另一知识库，共享原图并保留独立元数据；同库已有时返回现有条目', ref('Item'), {
    parameters: [id], requestBody: body({ type: 'object', required: ['collection_id'], properties: input.properties }),
    responses: { 200: response(ref('Item')), 201: response(ref('Item')), ...errorResponses },
  }),
};
spec.paths['/api/items/batch-organize'] = {
  post: operation('批量移动和收藏，版本或目标重复冲突时整批回滚', { type: 'object', properties: { items: list(ref('Item')) } }, {
    requestBody: body({ type: 'object', required: ['items'], properties: {
      items: { ...list({ type: 'object', required: ['id', 'version'], properties: { id: str, version: { type: 'integer', minimum: 1 } } }), minItems: 1, maxItems: 100 },
      collection_id: { type: 'string', nullable: true, description: '省略不移动；null 为未分类' },
      favorite: { type: 'boolean', description: '省略不改变收藏；和 collection_id 至少提供一项' },
    } }),
  }),
};
spec.paths['/api/backups'] = {
  get: operation('备份策略、最近执行状态和完整备份列表（管理员）', { type: 'object' }),
  post: operation('立即生成完整备份并按策略保留多个版本（管理员）', { type: 'object' }, { responses: { 201: response({ type: 'object', properties: { id: str } }), ...errorResponses } }),
};
spec.paths['/api/clipper/download'] = { get: { summary: '下载浏览器采集扩展 ZIP（需要登录或 API 令牌）', responses: { 200: { description: '可在 Chrome/Edge 加载的 MV3 扩展', content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } } }, ...errorResponses } } };
spec.paths['/api/items'].get.parameters.push({ name: 'gallery', in: 'query', schema: { type: 'string', enum: ['true', 'false'], default: 'false' }, description: 'true 返回当前过滤范围内按排序冻结的图片 ID 列表 {ids:[]}，忽略 limit/offset；不读取图片二进制，用于连续整理时保持顺序' });
spec.paths['/api/items'].get.parameters.push(
  {name:'anchor',in:'query',schema:{type:'string',maxLength:100},description:'定位当前筛选和分组结果中该内容所在分页，返回实际 offset；不存在时回到第一页。gallery=true 时忽略。'},
  {name:'grouped',in:'query',schema:{type:'string',enum:['true','false'],default:'false'},description:'按作品组折叠，封面为首个匹配页，返回 group_count；total 为折叠后数量。默认保持逐条 API 行为。'},
  {name:'group_key',in:'query',schema:str,description:'限定作品组；与 collection 配合，gallery=true 时按 group_order 展示顺序返回各页 ID，未排序时沿用 group_index。'}
);
spec.paths['/api/events'].get.parameters.push({name:'latest',in:'query',schema:{type:'string',enum:['true','false']},description:'true 只返回最新 cursor 和空 events，用于轻量检查更新；默认沿用 after 增量读取。'});
Object.assign(spec.components.schemas.Item.allOf[1].properties, {group_key:{...str,nullable:true},group_index:{type:'integer'},group_title:{...str,nullable:true},group_count:{type:'integer',description:'仅折叠查询返回当前过滤范围内的组页数'}});
spec.paths['/api/item-groups/favorite']={post:operation('收藏或取消收藏当前知识库的整组图片',{type:'object',properties:{count:{type:'integer'}}},{requestBody:body({type:'object',required:['group_key','collection_id','favorite'],properties:{group_key:str,collection_id:{...str,nullable:true},favorite:{type:'boolean'}}})})};
spec.paths['/api/backups/policy'] = { patch: operation('更新自动备份策略（管理员）；默认每天一次保留 7 份', { type: 'object' }, { requestBody: body({ type: 'object', required: ['enabled', 'interval_hours', 'keep'], properties: {
  enabled: { type: 'boolean' }, interval_hours: { type: 'integer', minimum: 1, maximum: 720 }, keep: { type: 'integer', minimum: 1, maximum: 100 },
} }) }) };
spec.paths['/api/backups/{id}/download'] = { get: { summary: '下载完整备份（管理员；包含访问设置和 Webhook 密钥）', parameters: [id], responses: { 200: { description: 'ZIP', content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } } }, ...errorResponses } } };
spec.paths['/api/backups/preview'] = { post: operation('上传完整 ZIP 并校验数据库和原图；预览有效 1 小时（管理员）', { type: 'object' }, {
  requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary', description: '最大 5 GiB；解压后最大 20 GiB' } } } } } },
}) };
spec.paths['/api/backups/preview/{id}'] = { delete: { summary: '取消待恢复备份并清理暂存文件（管理员）', parameters: [id], responses: { 204: { description: '已取消' }, ...errorResponses } } };
spec.paths['/api/backups/restore/{id}'] = { post: operation('恢复已校验备份（管理员）；先保存当前状态，完成后需重新登录', { type: 'object' }, { parameters: [id], requestBody: body({ type: 'object', required: ['confirm'], properties: { confirm: { type: 'string', enum: ['RESTORE'] } } }) }) };
const webhookInput = { type: 'object', required: ['name', 'url'], properties: {
  name: { ...str, maxLength: 80 }, url: { ...str, format: 'uri', description: 'HTTP(S)，支持局域网地址，不跟随重定向' }, enabled: { type: 'boolean', default: true },
  events: { type: 'array', minItems: 1, items: { type: 'string', enum: ['item.created', 'item.updated', 'item.deleted', 'item.restored'] }, description: '省略订阅全部四类事件；从创建订阅后的事件开始' },
} };
spec.paths['/api/webhooks'] = {
  get: operation('列出 Webhook 和待处理/失败数，不返回密钥（管理员）', list({ type: 'object' })),
  post: operation('创建订阅，签名密钥仅此时返回（管理员）', { type: 'object' }, { requestBody: body(webhookInput), responses: { 201: response({ type: 'object' }), ...errorResponses } }),
};
spec.paths['/api/webhooks/{id}'] = {
  patch: operation('修改或暂停订阅；启用后继续处理暂停期间事件（管理员）', { type: 'object' }, { parameters: [id], requestBody: body({ ...webhookInput, required: [] }) }),
  delete: { summary: '删除订阅及其投递记录（管理员）', parameters: [id], responses: { 204: { description: '已删除' }, ...errorResponses } },
};
spec.paths['/api/webhooks/{id}/deliveries'] = { get: operation('查看投递状态、尝试次数、最近错误；每页 50 条（管理员）', { type: 'object' }, { parameters: [id, { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }] }) };
spec.paths['/api/webhooks/{id}/deliveries/{delivery}/retry'] = { post: operation('重新排队投递；沿用投递 ID，尝试次数归零（管理员）', { type: 'object' }, { parameters: [id, { name: 'delivery', in: 'path', required: true, schema: str }] }) };
const collectionParameter={name:'collection',in:'query',schema:str,description:'知识库 ID；unfiled 为未分类，省略为全局'};
for(const path of ['/api/stats','/api/tags'])spec.paths[path].get.parameters=[collectionParameter];
spec.paths['/api/tags'].get.parameters=[{...collectionParameter,description:'知识库 ID；unfiled 或省略参数均仅查询未分类内容',schema:{type:'string',default:'unfiled'}}];
spec.paths['/api/item-groups/move']={post:operation('原子移动整组图片，可同时移动所属笔记',ref('Item'),{
  description:'以 id 对应图片作为组锚点，version 必须匹配；移动同一源知识库的全部组成员。move_note:true 同时移动所属笔记。目标存在同组或重复内容时返回 409，所有修改回滚。成功返回 moved_count。',
  requestBody:body({type:'object',required:['id','version','collection_id'],properties:{id:str,version:{type:'integer',minimum:1},collection_id:{...str,nullable:true},move_note:{type:'boolean',default:false},title:input.properties.title,content:input.properties.content,tags:input.properties.tags}})
})};
spec.components.schemas.Item.allOf[1].properties.group_order={type:'integer',nullable:true,description:'展示顺序；为空时沿用原始 group_index，不用于采集去重'};
const groupOrderState={type:'object',properties:{revision:str,note_id:{...str,nullable:true},cover_id:str,items:list({type:'object',properties:{id:str,title:str,thumbnail_url:str,version:{type:'integer'}}}),item:ref('Item')}};
spec.paths['/api/item-groups/order']={
  get:operation('读取当前知识库图片组排序快照',groupOrderState,{parameters:[{name:'id',in:'query',required:true,schema:str,description:'组内图片或所属笔记 ID'}]}),
  post:operation('原子保存图片组顺序（write）',groupOrderState,{description:'提交全部有效成员，第一张为封面。revision 或组成员变化返回 409，整次回滚。sync_note 默认同步笔记正文图片顺序，保留周围文字和链接。',requestBody:body({type:'object',required:['id','revision','ids'],properties:{id:str,revision:{type:'string',minLength:64,maxLength:64},ids:{type:'array',minItems:1,maxItems:10000,uniqueItems:true,items:str},sync_note:{type:'boolean',default:true}}})})
};
spec.paths['/api/items/batch-trash']={post:operation('当前知识库批量回收或恢复，版本冲突时整体回滚',{type:'object'},
  {requestBody:body({type:'object',required:['items','collection_id'],properties:{collection_id:{type:'string',nullable:true},restore:{type:'boolean',default:false},
    items:{type:'array',minItems:1,maxItems:10000,items:{type:'object',required:['id','version'],properties:{id:str,version:{type:'integer',minimum:1}}}}}})})};
spec.components.schemas.Item.allOf[1].properties.image_archive={type:'object',description:'笔记保存时的配图归档结果',properties:{total:{type:'integer'},archived:{type:'integer'},failures:{type:'array',items:{type:'object',properties:{url:str,error:str}}}}};
spec.paths['/api/clipper/pair'] = {post:{summary:'已登录网页创建扩展一次性连接凭据',description:'仅管理员浏览器会话可用，同源写入；凭据 2 分钟内单次有效，不返回 API 令牌。',responses:{200:{description:'一次性 code，禁止缓存'},...errorResponses}}};
spec.paths['/api/pixiv/notes'] = { post: operation('Pixiv 小说入库（write）', ref('Item'), {
  description: 'source_url 必须为 https://www.pixiv.net/novel/show.php?id=数字。按小说来源与知识库去重，重试返回已有笔记并附 duplicate:true，不覆盖本地编辑。配图必须完成归档，归档失败返回 400；回收站中已有同篇返回 409。',
  requestBody: body({ ...input, required: ['title', 'source_url'] }),
  responses: { 200: response(ref('Item')), 201: response(ref('Item')), ...errorResponses },
}) };
spec.paths['/api/clipper/redeem'] = {post:{summary:'扩展兑换一次性连接凭据',description:'要求 chrome-extension 来源及有效 code；兑换为 write 令牌。不可重放，发起连接的管理员会话注销或过期后失效。',security:[],requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['code'],properties:{code:{type:'string',minLength:64,maxLength:64}}}}}},responses:{200:{description:'扩展写入令牌，禁止缓存'},...errorResponses}}};

const trashScope={type:'object',required:['collection_id'],properties:{collection_id:{type:'string',nullable:true},ids:{type:'array',minItems:1,maxItems:10000,items:str,description:'省略表示当前知识库整个回收站'}}};
const trashPreview={type:'object',properties:{revision:str,count:{type:'integer'},referenced:{type:'integer'},shared:{type:'integer'},reclaimable_bytes:{type:'integer'}}};
spec.paths['/api/trash/preview']={post:operation('预览永久删除范围（需写入权限）',trashPreview,{requestBody:body(trashScope)})};
spec.paths['/api/trash/purge']={post:operation('永久删除当前知识库回收站内容',{...trashPreview,properties:{...trashPreview.properties,freed_bytes:{type:'integer'},freed_files:{type:'integer'},pending_files:{type:'integer'}}},{description:'必须先预览并确认；revision 变化返回 409。保留独立笔记配图及共享原文件，待释放文件自动重试。',requestBody:body({...trashScope,required:['collection_id','revision','confirm'],properties:{...trashScope.properties,revision:str,confirm:{type:'string',enum:['DELETE']}}})})};

spec.paths['/api/item-groups/selection']={get:operation('获取整个图片组的选择快照',{type:'object',properties:{items:list({type:'object',properties:{id:str,version:{type:'integer'}}}),collection_id:{type:'string',nullable:true},group_key:str,trash:{type:'boolean'}}},{parameters:[{name:'id',in:'query',required:true,schema:str}],description:'同知识库、同分组、同回收站状态的图片，按组内顺序返回。包含未加载和被筛选隐藏的成员；最多 10000 项，超限报错。'})};

const undoAction={type:'object',properties:{id:str,label:str,count:{type:'integer'},created_at:str,expires_at:str,undone_at:{...str,nullable:true}}};
spec.components.schemas.UndoAction=undoAction;
spec.paths['/api/undo']={get:operation('当前会话最近 24 小时的可撤销操作（最多 50 条）',{type:'object',properties:{actions:list(undoAction)}})};
spec.paths['/api/undo/{id}']={post:operation('撤销操作；重复请求不会重复写入',{...undoAction,properties:{...undoAction.properties,already_undone:{type:'boolean'}}},{parameters:[id],description:'仅调用者本人会话或令牌可用。字段、引用关系、知识库或永久删除发生冲突时返回 409，过期或不可访问返回 410；失败不做部分修改。'})};
for(const [path,method] of [['/api/items/batch-organize','post'],['/api/items/batch-tags','post'],['/api/items/batch-trash','post'],['/api/item-groups/move','post'],['/api/item-groups/favorite','post'],['/api/items/{id}','patch'],['/api/item-groups/order','post']]){
  const endpoint=spec.paths[path][method];
  endpoint.requestBody.content['application/json'].schema.properties.undo={type:'boolean',default:false,description:'记录完整关联变化，响应返回 undo 摘要；原文件不复制'};
  const response=endpoint.responses[200]?.content?.['application/json']?.schema;
  if(response?.properties)response.properties.undo={...undoAction,nullable:true};
}

const organizeInput = {type:'object',required:['items','collection_id','mode'],properties:{
  items:{type:'array',minItems:1,maxItems:10000,items:{type:'object',required:['id','version'],properties:{id:{type:'string',format:'uuid'},version:{type:'integer',minimum:1}}}},
  collection_id:{type:'string',format:'uuid',nullable:true},mode:{type:'string',enum:['create','append','detach']},title:{type:'string',maxLength:200,default:'',description:'新组名称可省略；留空采用整理后实际封面图片标题，最多 200 字符。追加保留目标组名称。'},whole_groups:{type:'boolean',default:false},target_id:{type:'string',format:'uuid',nullable:true},note_mode:{type:'string',enum:['copy','exclude'],default:'copy'}
}};
const organizeReceipt = {revision:{type:'string',minLength:64,maxLength:64},operation_id:{type:'string',format:'uuid'},prepared_at:{type:'string',format:'date-time'}};
const organizePicture = {type:'object',properties:{id:str,title:str,thumbnail_url:str}};
const organizePreview = {type:'object',properties:{input:organizeInput,...organizeReceipt,title:{...str,nullable:true,description:'最终组名；拆分为 null'},selected_count:{type:'integer'},expanded_count:{type:'integer'},changed_count:{type:'integer'},copied_count:{type:'integer'},excluded_count:{type:'integer'},existing_count:{type:'integer'},note_count:{type:'integer'},target_count:{type:'integer'},result_count:{type:'integer'},items:{type:'array',maxItems:60,items:organizePicture},cover:{...organizePicture,nullable:true}}};
spec.paths['/api/item-groups']={get:operation('分页查找当前知识库素材组',{type:'object',properties:{groups:list({type:'object',properties:{...organizePicture.properties,group_key:str,count:{type:'integer'}}}),total:{type:'integer'},offset:{type:'integer'}}},{parameters:[{name:'collection',in:'query',schema:{type:'string',default:'unfiled'},description:'知识库 UUID 或 unfiled'},{name:'q',in:'query',schema:{type:'string',maxLength:200}},{name:'offset',in:'query',schema:{type:'integer',minimum:0,maximum:100000,default:0}}],description:'每页 40 组，不含回收站与笔记配图组；首张按展示顺序确定。'})};
spec.paths['/api/item-groups/organize/preview']={post:operation('预览合组、追加或拆分（write）',organizePreview,{requestBody:body({...organizeInput,properties:{...organizeInput.properties,refresh:{type:'boolean',default:false,description:'明确重新读取所选版本；默认拒绝旧版本'}}}),description:'同知识库活动图片；create 可省略组名，默认采用实际封面图片标题；append 需素材组目标。关联及结果组最多 10000 张，预览至多 60 张。note_mode copy 保留原笔记与配图组并共享文件建立素材引用，exclude 跳过。追加保留目标封面。'})};
spec.paths['/api/item-groups/organize']={post:operation('按预览原子整理图片组（write）',{type:'object',properties:{changed_count:{type:'integer'},copied_count:{type:'integer'},group_key:{...str,nullable:true},ids:list(str),item:{...ref('Item'),nullable:true},undo:{...undoAction,nullable:true},replayed:{type:'boolean'},already_undone:{type:'boolean'}}},{requestBody:body({...organizeInput,required:[...organizeInput.required,'revision','operation_id','prepared_at'],properties:{...organizeInput.properties,...organizeReceipt,undo:{type:'boolean',default:false}}}),description:'原样提交预览 input（展开）、revision、operation_id、prepared_at。网络失败使用完全相同请求重试；24 小时内同调用者不重复执行，已撤销也不重做。版本或组成员变化 409，过期 410，容量超限 413，均整次回滚。回执压缩上限每调用者 32 MiB，复制配图元数据上限 16 MiB；完整恢复清除旧回执。'})};
spec.components.schemas.Item.allOf[1].properties.group_manual={type:'integer',enum:[0,1],description:'手工分组或拆分标记，重复采集保留结果'};
spec.components.schemas.Item.allOf[1].properties.group_origin_id={type:'string',nullable:true,description:'共享配图引用的来源记录 ID'};
spec.paths['/api/item-groups/selection'].get.responses[200].content['application/json'].schema.properties.items.items.properties.kind={type:'string',enum:['image']};

Object.assign(spec.paths['/api/item-groups/organize'].post.responses,{410:{description:'预览已过期'},413:{description:'数量或容量超限，未修改内容'}});
spec.paths['/api/items'].get.parameters.push(
 {name:'summary',in:'query',schema:{type:'string',enum:['true','false'],default:'false'},description:'轻量列表：笔记正文仅前 1000 个字符，图片和视频说明为空；content_length 保留完整字符数，summary=true 标记摘要。完整详情请 GET /api/items/{id}，勿以摘要覆盖原文。'},
 {name:'cursor',in:'query',schema:{type:'integer',minimum:0},description:'续页时提交首次列表响应的 event_cursor。服务内容有新事件则返回 409，需重新读取列表，避免偏移分页遗漏。省略保留旧接口行为。'}
);
spec.components.schemas.Item.allOf[1].properties.summary={type:'boolean',description:'true 表示列表摘要，不能当作完整正文编辑'};
spec.components.schemas.Item.allOf[1].properties.content_length={type:'integer',description:'完整正文字符数，仅摘要模式提供'};
const readingRow={type:'object',properties:{item_id:{type:'string',format:'uuid'},group_key:{type:'string',nullable:true},viewed_at:{type:'string',format:'date-time'},title:str,item_title:str,thumbnail_url:str,position:{type:'integer',minimum:1},total:{type:'integer',minimum:1}}};
const readingState={type:'object',properties:{version:{type:'integer',minimum:0},epoch:str,entries:{type:'array',maxItems:20,items:readingRow},replayed:{type:'boolean'}}};
const readingWrite={type:'object',required:['collection_id','version','epoch','request_id'],properties:{collection_id:{type:'string',format:'uuid',nullable:true},version:{type:'integer',minimum:0},epoch:{type:'string',maxLength:100},request_id:{type:'string',format:'uuid'}}};
spec.paths['/api/reading-progress']={
 get:operation('当前知识库最近 20 个图片组或单图的查看位置',readingState,{parameters:[{name:'collection',in:'query',schema:{type:'string',default:'unfiled'},description:'知识库 UUID 或 unfiled'}],description:'同一实例的授权设备共享。按图片 ID 重新计算当前页码，删除、移动和重新分组后的失效条目隐藏。'}),
 post:operation('保存图片查看位置（write）',readingState,{requestBody:body({...readingWrite,required:[...readingWrite.required,'item_id'],properties:{...readingWrite.properties,item_id:{type:'string',format:'uuid'}}}),description:'同组仅保留最后一张，只接受当前库活动图片，不修改内容、更新时间和内容事件。version/epoch 必须匹配；冲突返回 409。丢失响应时完全相同的请求可重试，仍为最后操作时返回 replayed:true，已有更新则拒绝旧版本。完整恢复更换 epoch。'}),
 delete:operation('清除当前知识库浏览记录，不删除图片（write）',readingState,{requestBody:body(readingWrite),description:'检查 version/epoch，请求 UUID 支持最后一次操作重试。清除后版本递增，旧待同步请求不能重新填回记录。'})
};

const exportJobInput={type:'object',properties:{mode:{type:'string',enum:['portable','images','markdown','json','html','backup'],default:'portable'},collection:{type:'string',description:'知识库 UUID 或 unfiled；省略为所有库，backup 不允许此参数'},include_trash:{type:'string',enum:['true','false'],default:'true'},layout:{type:'string',enum:['readable','legacy'],default:'readable'}}};
const exportJobRow={type:'object',properties:{id:str,type:{type:'string',enum:['export']},title:str,mode:str,collection_id:{type:'string',nullable:true},global:{type:'boolean'},status:{type:'string',enum:['ready','queued','running','completed','failed','cancelled']},message:str,bytes:{type:'integer',description:'已生成的归档字节，不代表文件已保存到客户端'},entries:{type:'integer'},created_at:{type:'string',format:'date-time'},finished_at:{type:'string',format:'date-time'},retried_as:str,download_url:str}};
spec.paths['/api/export-jobs']={
 get:operation('查看原生导出任务（管理员）',{type:'object',properties:{jobs:list(exportJobRow)}},{description:'活动上限 20，结束记录至多 50 条、24 小时。未开始接收的 ready 回执 5 分钟过期。重启或完整恢复清空记录，不额外保存 ZIP。'}),
 post:operation('创建原生导出回执（管理员）',exportJobRow,{requestBody:body(exportJobInput),responses:{201:response(exportJobRow),...errorResponses,429:{description:'导出队列已满'}},description:'创建回执后，用 download_url 发起浏览器原生下载。文件按真正执行时的数据导出；POST 本身不打包、不返回完整文件。'})
};
spec.paths['/api/export-jobs/{id}/file']={
 head:{summary:'检查回执存在，不消费回执（管理员）',parameters:[id],responses:{204:{description:'回执存在'},...errorResponses}},
 get:{summary:'用回执开始原生流式下载（管理员）',parameters:[id],responses:{200:{description:'原始下载文件，Content-Disposition: attachment',content:{'application/zip':{schema:{type:'string',format:'binary'}},'application/json':{schema:{type:'object'}}}},...errorResponses},description:'每个回执只能启动一次；串行生成，断线即失败，不提供 Range 断点续传。completed 仅表示服务器传送结束，不能证明客户端磁盘保存成功。'}
};
spec.paths['/api/export-jobs/{id}']={delete:operation('取消导出，不删除内容（管理员）',exportJobRow,{parameters:[id]})};
spec.paths['/api/export-jobs/{id}/retry']={post:operation('沿用原参数重新导出（管理员）',exportJobRow,{parameters:[id],requestBody:body({type:'object'}),responses:{200:response(exportJobRow),201:response(exportJobRow),...errorResponses,429:{description:'导出队列已满'}},description:'失败、取消或完成可重新导出，返回新回执。后续回执仍保留时，重复请求旧 ID 返回同一后续任务；再次重试应使用后续 ID。每次重试重新读取当前数据。'})};

const videoPosition={type:'object',properties:{item_id:{type:'string',format:'uuid'},position:{type:'number',minimum:0,maximum:31536000},duration:{type:'number',exclusiveMinimum:true,minimum:0,maximum:31536000},completed:{type:'boolean'},viewed_at:{type:'string',format:'date-time'},title:str,thumbnail_url:str}};
const videoProgressState={type:'object',properties:{version:{type:'integer',minimum:0},epoch:str,entries:{type:'array',maxItems:20,items:videoPosition},replayed:{type:'boolean'}}};
spec.paths['/api/video-progress']={
 get:operation('读取当前库最近 20 个视频的播放位置',videoProgressState,{parameters:[{name:'collection',in:'query',schema:{type:'string',default:'unfiled'},description:'知识库 UUID 或 unfiled'}],description:'仅返回本库活动视频，按原文件哈希隐藏失效记录。与图片浏览记录分开保存。'}),
 post:operation('保存视频播放位置（write）',videoProgressState,{requestBody:body({...readingWrite,required:[...readingWrite.required,'item_id','position','duration','completed'],properties:{...readingWrite.properties,...Object.fromEntries(['item_id','position','duration','completed'].map(k=>[k,videoPosition.properties[k]]))}}),description:'单库版本和 epoch 必须匹配，冲突 409；同 request_id 与完全相同参数支持最后请求重放。位置按原视频时长限制，越界超过 2 秒返回 400。completed 只对结尾有效。不修改内容版本、更新时间或事件。完整恢复后旧 epoch 失效。'}),
 delete:operation('清除当前库播放记录，不删除视频（write）',videoProgressState,{requestBody:body(readingWrite),description:'仅接受 collection_id/version/epoch/request_id。版本冲突整次拒绝，最后请求可幂等重放。'})
};

const weixinConfig={type:'object',required:['enabled','collection_id','tags'],properties:{enabled:{type:'boolean'},collection_id:{type:'string',nullable:true},merge_mode:{type:'string',enum:['daily','session','message'],description:'默认 daily；省略时保留当前归档方式。日期按 Asia/Shanghai 划分。'},tags:{type:'array',maxItems:20,items:{type:'string',minLength:1,maxLength:40}}}};
const notificationReceipt={type:'object',properties:{idempotency_key:str,status:{type:'string',enum:['sending','accepted','rejected','unknown']},created_at:str,updated_at:str,detail:str}};
spec.paths['/api/weixin/notifications']={
 get:operation('通知开关、上下文就绪状态与最近发送回执（管理员，不含微信凭据）',{type:'object'}),
 patch:operation('单独启停通知发送，不改变微信收件设置（管理员）',{type:'object'},{requestBody:body({type:'object',additionalProperties:false,required:['enabled'],properties:{enabled:{type:'boolean'}}})}),
 post:operation('发送给当前绑定用户（管理员或 notify 令牌）',notificationReceipt,{requestBody:body({type:'object',additionalProperties:false,required:['idempotency_key','title','body'],properties:{idempotency_key:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'},title:{type:'string',minLength:1,maxLength:100},body:{type:'string',minLength:1,maxLength:1500}}}),description:'200 仅表示微信接口接受；202 同编号仍提交中；409 未就绪或编号内容冲突；429 繁忙/频率/容量限制（未提交）；502 微信拒绝；504 结果未知。30 天保留最多 1000 个去重回执，超出拒绝而不删除有效回执。失败不自动重发。'})
};
spec.paths['/api/weixin/notifications/{key}']={get:operation('读取当前令牌自己的通知回执',notificationReceipt,{parameters:[{name:'key',in:'path',required:true,schema:{type:'string'}}]})};
spec.paths['/api/weixin']={get:operation('微信收件连接与最近处理状态，不返回凭据（管理员）',{type:'object'}),patch:operation('设置微信收件开关、知识库与标签（管理员）',{type:'object'},{requestBody:body(weixinConfig)})};
spec.paths['/api/weixin/new-note']={post:operation('开始新篇；只影响后续收件，不创建空白笔记（管理员）',{type:'object'},{requestBody:body({type:'object',properties:{title:{type:'string',maxLength:80}}})})};
spec.paths['/api/weixin/login']={post:operation('生成微信登录二维码，后台等待本人扫码确认（管理员）',{type:'object'}),delete:operation('移除微信连接凭据，保留已收内容（管理员）',{type:'object'})};
spec.paths['/api/weixin/verify']={post:operation('提交手机显示的扫码验证码（管理员）',{type:'object'},{requestBody:body({type:'object',required:['id','code'],properties:{id:str,code:{type:'string',pattern:'^[0-9]{4,8}$'}}})})};
for(const action of ['retry','skip'])spec.paths['/api/weixin/jobs/{id}/'+action]={post:operation(action==='retry'?'重试失败的微信消息（管理员）':'忽略失败的微信消息（管理员）',{type:'object'},{parameters:[id]})};

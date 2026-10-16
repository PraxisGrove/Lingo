# Lingo 界面与模型配置

浏览器侧栏采用紧凑工具布局，显示当前网页、翻译状态、语言、服务和模型。设置页分为翻译服务、阅读偏好和高级设置，使用短标题、对齐表单和按需展开的帮助。Dual Fold 标识与墨色、纸白、青柠色用于统一品牌和操作状态。

点击工具栏中的 Lingo 打开侧栏。Chromium 使用原生 Side Panel，Firefox 使用原生 Sidebar；切换网页时面板跟随当前标签页。Chromium 新增 `sidePanel` 权限，Firefox 使用 `sidebar_action`。旧弹窗页面保留用于兼容回归，不再绑定工具栏的默认弹窗。

侧栏中的「连接服务」「管理服务」和设置按钮均在当前面板内切换，不创建设置窗口或标签页。连接流程与完整设置页共用同一组件；顶部「返回网页翻译」可返回，测试并保存成功后也会自动返回。配置时切换标签页、导航、阅读设置或返回网页均保留正在填写的连接、密钥和模型列表，再次打开即可继续。未保存的连接仅在当前面板页面内存中，重载扩展或面板页面会清除；不会自动写入设置或密钥存储。服务商文档与独立文本翻译工作区仍按用户点击打开。

翻译失败时仍保留显示方式和语言、服务、模型选择，可以继续查看原文、换服务或关闭翻译。分段按钮「原文」保留翻译会话，只隐藏译文；「关闭翻译」结束会话并移除译文。主界面新增「译文外观」入口，侧栏的阅读设置优先显示字体、行高、颜色、间距与分隔控制。

## 菜单层级

| 位置 | 功能 | 使用方式 |
| --- | --- | --- |
| 浏览器侧栏 | 翻译网页、恢复原文、切换语言／服务／模型 | 阅读时直接操作 |
| 翻译服务 | 添加服务、获取模型、选择与测试模型 | 配置与维护第三方服务 |
| 阅读偏好 | 语言、译文外观、自动翻译、划词与悬浮入口、主题 | 按阅读习惯调整 |
| 高级设置 | 翻译风格、术语、网页适配、隐私与本机数据 | 默认折叠，按需展开 |
| 网页适配内部 | 自定义 JSON、社区订阅地址与签名公钥 | 兼容性调整与排障 |

网页适配不是必须配置的步骤。内置适配帮助识别文章、跳过代码和菜单；站点的「始终翻译／永不翻译」偏好也依赖这一能力，因此保留引擎。普通读者使用默认值即可。

## 从连接到使用

1. 在网页上打开侧栏，点击「连接服务」。侧栏内直接显示服务配置；翻译语言可以在「阅读偏好」或返回后的翻译界面调整。独立设置页仍提供首次语言设置引导。
2. 按中国厂商、国际厂商、本地模型或专业翻译筛选，也可以搜索厂商名称。选择服务后，地址自动填写；密钥获取入口指向服务商。
3. 填入自己的密钥，点击「连接并获取模型」。此操作只请求模型列表，不调用翻译接口。
4. 可保留自动推荐，也可以搜索模型、手动选择或填写服务商提供的模型／部署 ID。
5. 点击「测试翻译并保存」，验证选中的具体模型后保存服务、模型和列表。API 密钥仅保存在本机。
6. 保存成功后回到侧栏中的当前网页，点击开始翻译。侧栏显示当前服务与模型；切换已导入模型会按新模型重新翻译当前页面，保留显示方式与内容范围。

译文外观在「阅读偏好」中设置，可跟随网页、使用预设样式，或调整字体、字号比例、行高、原译文间距、颜色与分隔线。修改自动保存并应用到已翻译内容，只调整排版。浅色与深色网页预览使用中性样文，方便检查对比度和行距。

自动推荐优先使用列表中仍存在的预设模型，否则按轻量通用模型的名称特征选取一个默认值。这是方便配置的默认策略，不是模型质量或价格榜单。推荐仅发生在获取／刷新列表时；翻译时始终使用已保存的具体模型。手动选择不会因刷新而改变，包括列表未返回的私有部署 ID。

模型获取失败时，可重试或填写模型 ID。错误状态显示原因、请求地址和可用的 HTTP 状态；后台未响应时提供「重新加载 Lingo」。获取目录与测试翻译是两个独立动作：目录显示可选模型，翻译测试检查选中模型是否可调用。Ollama 需要先运行本地服务并安装模型；通常无须密钥，也允许填写本地认证密钥。

「添加自定义服务」始终可见，支持选择 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 或 Gemini generateContent 四种通用协议，并配置自己的地址、密钥、服务名称和模型。OpenAI 和 DeepSeek 预设也可选择 Chat Completions 或 Responses。选择服务实际提供的 API 协议；服务名称和图标只用于识别，不决定接口格式。本地网关可使用 HTTP，认证密钥按网关配置填写。服务图标可以自动识别，也可以选择预设图标或上传本地 PNG、JPEG、WebP。图片在本机转换为小尺寸 PNG 保存，不上传到翻译服务；可恢复自动图标。已有服务的名称与图标通过「保存名称与图标」单独保存，不触发模型查询或翻译测试，也不覆盖未保存的连接草稿。

### 通用协议与基础地址

按服务文档选择协议和 API 基础地址。有些服务接受根地址，有些需要 `/v1`、`/v1beta` 等版本路径；Lingo 接受服务支持的两种填写方式。地址不决定协议：同一网关可以提供多种 API，选择的协议必须与接口格式一致。

| 自定义服务协议 | 基础地址后的生成接口 | 模型目录格式 |
| --- | --- | --- |
| OpenAI Chat Completions | `/chat/completions` | `data` 模型列表 |
| OpenAI Responses | `/responses` | `data` 模型列表 |
| Anthropic Messages | `/messages` | `data` 模型列表 |
| Gemini generateContent | `/models/{id}:generateContent` | `models` 模型列表 |

表中的路径相对已包含所需版本前缀的基础地址。原生协议会使用对应的认证头、目录结构和翻译接口。填写基础地址即可，不要把完整的 `/models`、`/chat/completions`、`/responses` 或 `:generateContent` 请求地址作为基础地址。保留服务返回的完整模型 ID，例如 `provider/model` 或 `group/...`，不要去掉服务商或路由组前缀。

Responses 是 OpenAI、DeepSeek 和兼容网关提供的通用接口，使用独立的请求与输出结构。[DeepSeek 官方 Responses 指南](https://api-docs.deepseek.com/guides/responses_api/)确认 `text.format` 支持输出格式；[API 参考](https://api-docs.deepseek.com/api/create-response/)明确列出 `json_object` 与 `json_schema`。JSON mode 保证 JSON 格式，Lingo 仍需校验译文 ID 和内容契约。

## 接入范围

| 类型 | 预设 |
| --- | --- |
| 中国厂商 | DeepSeek、SiliconFlow、阿里云 Qwen、火山引擎 Doubao、智谱 GLM、Moonshot Kimi、MiniMax |
| 国际厂商 | OpenAI、Anthropic Claude、Google Gemini、OpenRouter、Groq、Mistral AI |
| 本地与自定义 | Ollama、自定义 Chat Completions／Responses／Anthropic／Gemini 服务与兼容网关 |
| 专业翻译 | DeepL、Google Cloud Translation、Azure Translator |

Claude 和 Gemini 使用各自的原生请求与返回格式；OpenAI、DeepSeek 可选择 Chat Completions 或 Responses。其他 AI 预设默认采用 Chat Completions 兼容协议。MiniMax 已启用官方模型目录；Doubao 当前使用手动模型／部署 ID。Zhipu 会尝试获取目录，并保留手动填写路径，其公开目录接口尚未得到官方资料核实。专业翻译 API 不需要选择 AI 模型。

下表是当前配置能力与接口契约，不代表这些服务的有效账户都已实测。

| 服务 | 模型配置 | 当前协议 |
| --- | --- | --- |
| OpenAI | 自动获取 `/v1/models` | Chat Completions / Responses |
| DeepSeek | 自动获取 `/models`，支持官方根地址 | Chat Completions / Responses |
| SiliconFlow | 自动获取聊天模型，使用 `sub_type=chat` | Chat Completions |
| Anthropic | 自动获取 `/v1/models`，支持分页 | Messages |
| Gemini | 自动获取 `/v1beta/models`，支持分页与能力筛选 | generateContent |
| Qwen | 同源 `/api/v1/models`，筛选文本生成能力并分页 | Chat Completions |
| Doubao | 手填官方 Model ID 或 `ep-*` 部署 ID | Chat Completions |
| Zhipu | 尝试获取目录；失败时手填，公开目录契约未核实 | Chat Completions |
| Moonshot / Kimi | 自动获取 `/v1/models` | Chat Completions |
| MiniMax | 自动获取 `/v1/models` | Chat Completions |
| OpenRouter | 自动获取 `/api/v1/models`，筛选文本输出能力 | Chat Completions |
| Groq | 自动获取 `/openai/v1/models`，具体模型须测试翻译 | Chat Completions |
| Mistral | 自动获取 `/v1/models`，排除非 Chat 与已归档模型 | Chat Completions |
| Ollama | 自动获取本机已安装模型 | Chat Completions |
| 自定义服务／网关 | 按所选协议获取目录，保留模型命名空间 | 四种通用协议 |
| DeepL | 不选择 AI 模型，选择 API Free / Pro 套餐 | 原生翻译 API |
| Google Cloud Translation | 不选择 AI 模型，当前使用 Basic v2 API Key | 原生翻译 API |
| Azure Translator | 不选择 AI 模型；区域／多服务密钥需填写 region，global 可留空 | 原生翻译 API |

云端服务使用 HTTPS 和服务商密钥。四种 AI 协议连接本机 `localhost`、`127.0.0.1` 或 `[::1]` 时可使用 HTTP，密钥按本机服务认证要求填写。目录成功只说明模型列表可读取；模型权限、额度与实际译文要通过选定模型的翻译请求验证。连接测试检查译文非空且匹配请求 ID，HTTP 成功本身不算通过。

官方接口依据：[DeepSeek 模型列表](https://api-docs.deepseek.com/api/list-models/)、[Claude 模型列表](https://platform.claude.com/docs/en/api/models/list)、[Gemini 模型](https://ai.google.dev/api/models)、[阿里云模型列表](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/list-models)、[MiniMax 兼容接口](https://platform.minimax.io/docs/api-reference/text-openai-api)、[火山引擎快速开始](https://docs.volcengine.com/docs/ark/quick-start?lang=zh)。

本轮目录核对依据：[MiniMax 模型目录](https://platform.minimax.io/docs/api-reference/models/openai/list-models)、[SiliconFlow 模型目录](https://docs.siliconflow.cn/docs/api/models-get)、[Mistral 模型目录](https://docs.mistral.ai/api/endpoint/models)、[Kimi 模型目录](https://platform.kimi.com/docs/api/list-models)、[Doubao 模型与部署 ID](https://docs.volcengine.com/docs/ark/model-list?lang=en)。

## 用户手测

| 操作 | 预期结果 |
| --- | --- |
| 首次打开 Lingo | 可直接设置翻译语言、连接服务；未配置状态给出连接入口 |
| 点击连接／管理服务和设置 | 当前侧栏切换到配置，不弹出新窗口、不改变当前网页 |
| 填写连接时切换网页、返回再打开配置 | 草稿与模型列表保留，不自动保存密钥，不重复请求目录；返回后翻译界面显示当前标签页 |
| 使用自己的服务密钥获取模型 | 返回可用目录；自动推荐选择实际返回项，手动选择可保留 |
| 配置本机或自定义服务 | 所选协议与地址一致；有版本路径时保留，认证按服务要求填写 |
| 测试并保存，再重新打开设置 | 默认服务、所选模型与备用顺序保留；保存前的短样本测试可能产生服务调用费用 |
| 在普通文章页打开侧栏并翻译 | 原文与译文位置正确；切换标签页后侧栏显示当前网页；恢复原文不留下译文 |
| 切换语言、模型、显示方式和内容范围 | 使用当前选项翻译，显示方式与内容范围按选择保留 |
| 调整译文外观 | 预览与已翻译页面更新；字体、间距、颜色和分隔可恢复默认，外观修改不重新调用翻译 |
| 设置自动翻译与站点偏好 | 仅匹配规则时自动翻译；「永不翻译」阻止自动开始 |
| 输入错误密钥或无法连接的地址 | 显示本地化原因和可用的 HTTP／请求地址，可重试或手填模型 ID |
| 测试保存失败或遗漏必填项 | 定位到错误或待填写字段，保留输入；修正后可继续测试 |
| 网页翻译部分失败 | 原文切换、关闭翻译和模型选择仍可使用 |
| 修改界面语言、主题，展开高级设置 | 语言和主题立即生效；JSON、公钥和诊断仅在对应高级区域出现 |

用户手测按自己的服务账号与网页进行。有效目录、一次短句成功和完整文章阅读质量是不同验证层级；手测结论记录服务、模型、协议及失败步骤即可，记录中不包含密钥。

## 界面截图

截图来自构建产物加载到 Chromium 的临时配置文件。Magpie 与 Responses 模型目录截图使用真实本机 Magpie 网关，DeepSeek 目录截图来自真实官方接口的 GET 请求；模型错误截图使用模拟的 HTTP 401，其他模型导入与翻译演示使用本机模拟服务。截图不含真实账户密钥。

| 界面 | 截图 |
| --- | --- |
| 侧栏翻译控制与译文外观入口 | [sidepanel-translation-controls.png](./sidepanel-translation-controls.png) |
| 侧栏译文外观（首屏） | [sidepanel-reading-controls.png](./sidepanel-reading-controls.png) |
| 侧栏内连接与选择模型 | [sidepanel-service-setup.png](./sidepanel-service-setup.png) |
| 首次设置（精简工具布局） | [settings-onboarding-refined.png](./settings-onboarding-refined.png) |
| 翻译服务（精简布局） | [settings-services-refined.png](./settings-services-refined.png) |
| 模型选择（精简布局） | [settings-models-refined.png](./settings-models-refined.png) |
| 阅读偏好与译文外观 | [settings-reading-refined.png](./settings-reading-refined.png) |
| 窄屏阅读偏好 | [settings-reading-mobile.png](./settings-reading-mobile.png) |
| 深色翻译服务（精简布局） | [settings-services-dark.png](./settings-services-dark.png) |
| 首次使用与语言选择 | [options-setup.png](./options-setup.png) |
| 连接服务 | [options-services.png](./options-services.png) |
| 中国厂商 | [options-providers-china.png](./options-providers-china.png) |
| 厂商图标（浅色／深色） | [provider-icons.png](./provider-icons.png) · [provider-icons-dark.png](./provider-icons-dark.png) |
| 自定义服务与上传图标 | [custom-provider.png](./custom-provider.png) |
| 自定义外观本地保存 | [custom-provider-edit.png](./custom-provider-edit.png) |
| 模型列表与选择策略 | [options-models.png](./options-models.png) |
| OpenAI Responses 协议配置 | [responses-protocol.png](./responses-protocol.png) |
| OpenAI Responses 模型目录 | [responses-model-discovery.png](./responses-model-discovery.png) |
| DeepSeek 真实模型目录（仅 GET） | [deepseek-live-models.png](./deepseek-live-models.png) |
| Magpie 自定义 Gemini 配置 | [magpie-connection.png](./magpie-connection.png) |
| Magpie 真实模型目录 | [magpie-model-discovery.png](./magpie-model-discovery.png) |
| Magpie 窄屏模型选择 | [magpie-models-mobile.png](./magpie-models-mobile.png) |
| 模型获取错误与诊断（模拟 HTTP 401） | [model-discovery-error.png](./model-discovery-error.png) |
| 保存后的服务 | [options-connected.png](./options-connected.png) |
| 高级设置默认折叠 | [options-advanced.png](./options-advanced.png) |
| 窄屏模型配置 | [options-mobile.png](./options-mobile.png) |
| 深色服务管理 | [options-dark.png](./options-dark.png) |
| 阅读面板兼容页面 | [popup-ready.png](./popup-ready.png) |
| 文本翻译窗口 | [text-translation.png](./text-translation.png) |

## 验证

回归命令为 `pnpm test`、`pnpm test:browser`、`pnpm compile`、`pnpm check`、`pnpm build`、`pnpm build:firefox` 和 `pnpm test:extension`。接口、存储、错误、取消与生成响应主要由固定样例和模拟服务覆盖；真实有效账户的接入范围以下列记录为准，不能扩展为所有厂商通过。

当前回归已通过：555 项单元测试、74 项浏览器测试、24 项安装扩展测试。侧栏覆盖完整连接、获取模型、测试保存、返回及网页翻译，验证不会创建新标签页或切换当前网页；未保存的草稿、模型目录与请求中状态在返回再进入后保留，不重复获取目录。HTTP 401 测试失败直接聚焦可见错误，保留输入且不保存服务或密钥，修正后重试成功。主界面「译文外观」通过真实设置控件修改颜色，现有网页即时更新且请求次数不增加。英语与德语在 320／390px 下验证阅读偏好、服务与模型布局，自动聚焦输入框保持在固定顶栏下方。九种界面语言在 320px 下另经几何检查，无横向溢出。译文外观还在实际安装的扩展中验证：已翻译网页及 iframe 的字号、颜色、行高与分隔样式随设置更新，不追加翻译 API 请求。单元测试另覆盖翻译错误后的恢复与切换控件、必填字段定位、新建或编辑服务聚焦，以及取消草稿清除密钥。

本轮配置审计修复了 MiniMax 目录开关、SiliconFlow 聊天模型筛选、Mistral Chat／归档筛选，以及连接测试的译文内容验收。本轮 UI 与理论配置评估未新增云端真实生成调用。

此前模型获取故障验证中，临时安装的 Chromium 扩展向真实本机 Magpie 根地址分别使用 Chat Completions、Anthropic 和 Gemini 协议发送 GET 请求，每种协议均读取到 36 个模型，并保留 `group/auto-gpt-5-6-luna` 路由组。只读取模型目录，未发送付费生成或翻译请求。

本轮 Responses 验证中，临时安装的扩展通过设置页，向真实本机 Magpie 根地址读取到 36 个模型，并选中 `group/auto-gpt-5-6-luna`。另通过扩展后台向同一服务的 `/v1` 基础地址发送 GET，也得到 36 个模型，其中包含 7 个 Codex 模型 ID。全部真实网关操作均为 GET，没有调用翻译或生成接口。

已安装扩展在本机模拟服务上完成 Responses 回归：自定义服务获取模型目录、选择路由组、测试翻译并保存，随后从真实网页的弹窗发起翻译，仍向 `/response-gateway/v1/responses` 发送 POST。请求包含 `instructions`、`input`、`store: false`、`stream: false` 和 `text.format.type: json_object`；返回中同时包含 reasoning 与 assistant 输出，译文解析成功。保存后重新打开设置仍使用 Responses 协议。

DeepSeek 预设的 Chat Completions／Responses 选择与官方根地址也已验证。模型目录 GET 与真实生成接口的账户调用权限分别验证；自动化生成回归均使用模拟服务。

另使用用户授权的 DeepSeek 密钥，在临时安装的扩展中完成真实接入验证：设置页选择 DeepSeek 预设与 Responses 协议，向 `https://api.deepseek.com/models` 发送 GET，显示 `deepseek-flash`（DeepSeek-V4.1-Flash）和 `deepseek-v4-pro`（DeepSeek-V4-Pro）两个模型，并自动推荐 Flash。通过扩展现有的请求生成与响应解析路径，分别使用 Responses 和 Chat Completions 调用 Flash，将短样本 `Hello` 翻译至 `es`，两次均返回成功。

真实生成仅这两条短样本。此次没有保存真实服务配置或密钥，没有验证真实账户的保存与持久化流程，也没有把密钥写入代码或测试文件；验证后临时浏览器已关闭，内存已清空。此前的官方契约、`data` 响应样例和无效诊断密钥的 HTTP 401 测试继续覆盖目录与失败分支；实际额度、完整网页翻译质量及其他账户权限不由这两条样本推断。

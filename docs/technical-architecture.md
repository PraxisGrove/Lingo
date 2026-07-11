# Lingo 技术架构

## 当前基础

当前仓库是 WXT、React 和 TypeScript 模板，已有后台服务工作线程、内容脚本、弹窗、设置页、类型化消息、类型化本地存储、日志、Vitest、Biome 以及 Chrome/Firefox 构建工作流。

演进原则是保留 entrypoint 只做浏览器接线，把共享行为放入 `lib/` 的深模块。调用者和测试只跨模块 Interface，不直接依赖内部 DOM、厂商响应或存储格式。

## 运行时分工

```text
┌──────────────────── page tab ────────────────────┐
│ webpage DOM                                      │
│      ↕                                           │
│ content script                                   │
│ Page Translation module                          │
│ extraction · classification · render · observe   │
└───────────────────┬──────────────────────────────┘
                    │ typed runtime Port
                    │ translation units / events
┌───────────────────▼──────────────────────────────┐
│ background service worker                        │
│ Translation Orchestrator module                  │
│ policy · cache · batching · retry · fallback     │
│      ↕                    ↕                      │
│ Provider adapters         Settings / Rules       │
└───────────┬───────────────────────┬──────────────┘
            │ HTTPS / local API     │ browser storage / IndexedDB
            ▼                       ▼
     translation providers    config · rules · cache
```

内容脚本拥有 DOM，但永远不拥有凭据。后台拥有凭据和网络请求，但不直接修改 DOM。网页上下文不能读取扩展隔离世界中的运行状态。

## 建议目录

```text
entrypoints/
  background.ts
  content.ts
  popup/
  options/
lib/
  page-translation/       # 页面识别、调度、呈现和恢复
  translation/            # 后台翻译编排
  providers/              # 第三方 Adapter
    openai-compatible/
    deepl/
    google-cloud/
    azure-translator/
  rules/                  # 规则解析、合并、签名更新
  preferences/            # 全局、站点、页面偏好解析
  credentials/            # 本地凭据访问
  cache/                  # IndexedDB 翻译缓存
  glossary/               # 术语与翻译指令解析
  messaging/              # 命令消息与流式 Port 协议
  logger/
```

目录名表达模块职责，不把 `utils/`、厂商条件或浏览器 entrypoint 逻辑扩散到共享代码。

## 深模块与 Interface

### Page Translation module

外部 Interface 只暴露会话行为：

```ts
type PageTranslation = {
  start(options: StartSessionOptions): Promise<SessionSnapshot>;
  update(patch: SessionPatch): Promise<SessionSnapshot>;
  stop(): Promise<void>;
  subscribe(listener: (event: PageTranslationEvent) => void): () => void;
};
```

Implementation 隐藏以下复杂度：正文候选发现、主要内容分类、inline 标记占位、稳定段落 ID、IntersectionObserver、MutationObserver、SPA 导航、去重、状态呈现和原文恢复。

Interface 的不变量：

- `start` 幂等，同一标签页最多一个翻译会话。
- 每个原文段落有稳定 ID；DOM 变化后已完成段落不会重复计费。
- `stop` 撤销所有 Lingo 插入和隐藏状态，但不覆盖网页在会话期间产生的新内容。
- 受保护内容不会生成翻译单元。

### Translation Orchestrator module

这是后台最深的模块，调用者不需要理解缓存、批量、限流或厂商差异。

```ts
type TranslationOrchestrator = {
  translate(request: TranslationRequest): AsyncIterable<TranslationEvent>;
  cancel(sessionId: string): Promise<void>;
};
```

Implementation 负责解析服务配置档案、术语、翻译指令与备用链，读取缓存，按能力分组请求，限制并发，执行退避，校验逐段结果并产生事件。

事件至少包括 `queued`、`translated`、`failed`、`paused` 和 `completed`。取消必须停止尚未发出的请求；已经发出的请求结果可以缓存，但不得继续写入已结束页面会话。

### Provider seam

四类真实厂商加测试 Adapter 使这个 seam 成立：

```ts
type TranslationProvider = {
  capabilities: ProviderCapabilities;
  translateBatch(input: ProviderBatchInput): Promise<ProviderBatchResult>;
};
```

厂商 Adapter 负责认证头、请求格式、响应解析、限流信号和厂商错误分类。它不负责站点规则、缓存、跨厂商回退或 DOM。

`ProviderCapabilities` 描述最大批量、上下文支持、原生术语表、结构化输出和流式能力。Orchestrator 根据能力选择策略，不使用散落的 `if (provider === ...)`。

### Rule Resolution module

```ts
type RuleResolver = {
  resolve(input: RuleContext): ResolvedPageRule;
};
```

Implementation 合并用户、社区和内置规则，输出单一不可变结果。远程社区规则是经过 schema 校验与签名验证的声明式 JSON；公钥随扩展发布，更新存为 last-known-good，失败时回退。

规则字段只允许域名模式、CSS 选择器、主要/界面/排除区域、自动翻译策略和安全功能开关。禁止代码字符串、动态模块 URL 和表达式执行。

### Preference Resolution module

把分散优先级压缩成一个查询：

```ts
type PreferenceResolver = {
  resolve(input: PreferenceContext): EffectivePreferences;
};
```

Implementation 按当前页面、站点、全局和检测默认值解析语言、显示模式、内容范围、服务配置档案、术语表和翻译指令。UI 和内容脚本只消费最终结果。

## 消息与会话协议

- popup/options 的离散命令继续使用类型化 `runtime.sendMessage`。
- 内容脚本与后台的段落流使用 `runtime.connect` 长连接，连接名包含协议版本。
- 每个事件包含 `sessionId`、`pageRevision` 和 `unitId`，旧页面或旧会话结果会被丢弃。
- 消息在两端做运行时 schema 校验，不能只依赖 TypeScript。
- 消息只携带服务配置档案 ID；凭据永不进入 Port。

后台服务工作线程重启后，内容脚本重新连接并上报当前会话快照。后台不尝试持久化 DOM 引用，只恢复未完成的逻辑请求。

## 页面识别与呈现

1. 根据站点规则找到候选根区域。
2. 遍历可见文本容器，排除 script、style、code、pre、输入、编辑器、密码、支付、广告和 `translate="no"`。
3. 使用 DOM 结构、文本密度、链接密度和语义标签分类主要内容与页面界面。
4. 将 inline 元素转换为不可翻译的稳定占位符，服务只翻译文本。
5. 在原文段落旁插入独立译文容器，不复制事件处理器，不重写原节点 HTML。
6. 用扩展自有属性标记节点，恢复时只清理由 Lingo 创建的状态。

MutationObserver 只收集变化并批处理，IntersectionObserver 决定动态翻译优先级。URL 与 history 变化增加 `pageRevision`，防止旧结果写入新页面。

## 缓存与存储

- `@wxt-dev/storage` 保存版本化偏好、站点规则元数据和服务配置档案。
- 凭据单独存入 `storage.local`，只能通过后台 credentials 模块读取。
- IndexedDB 保存译文缓存，键由规范化原文、语言、服务、模型、术语版本和指令版本生成摘要。
- 缓存 value 不保存 URL；采用容量上限和 LRU 清理。
- schema migration 是存储模块的 Implementation，调用者只读取当前模型。
- 导出默认排除凭据；包含凭据的导出使用用户口令加密并明确标记。

浏览器扩展存储不是保险库。文档必须说明凭据受浏览器配置文件与操作系统账户保护，不宣称不存在本机攻击面。

## 安全与隐私

- manifest 申请 `<all_urls>`，并在隐私说明中逐项解释用途。
- 所有翻译请求从后台发出；内容脚本和网页拿不到认证信息。
- 默认不发送完整 URL；AI 上下文只包含标题与有限相邻段落。
- 默认无遥测；本地日志统一通过 logger 脱敏。
- 远程更新只能是已签名规则数据，不能下载或执行 JavaScript。
- 自定义 OpenAI-compatible 地址必须经过 URL 校验；默认拒绝明文 HTTP，localhost 可显式允许。
- 企业策略可以限制允许的端点、模型、备用服务和远程规则更新。

## 测试策略

模块 Interface 就是测试表面：

- **Page Translation**：用固定 DOM fixture 验证分类、动态新增、SPA revision、显示切换和无损恢复。
- **Orchestrator**：使用内存 Provider Adapter、缓存和时钟，验证批量、重试、取消、局部失败及备用链授权。
- **Providers**：使用厂商官方示例响应做契约测试；真实凭据测试只在手动或受保护 CI 环境运行。
- **Rules**：属性测试优先级与 schema；验证损坏、过期和签名失败时使用 last-known-good。
- **Storage**：迁移、脱敏导出、缓存隔离和容量清理。
- **浏览器验收**：在 Chrome 与 Firefox 覆盖静态文章、无限滚动、SPA、iframe、Shadow DOM 和失败恢复。

首版每个高风险行为都应通过公开 Interface 验证，避免测试 DOM helper、厂商 parser 或缓存内部结构。

## 非功能目标

- 未启动翻译会话时，内容脚本只做最少初始化，不扫描整页。
- MutationObserver 回调不执行网络请求或同步全 DOM 遍历。
- 译文插入不造成明显布局抖动，原页面交互与复制行为保持可用。
- 并发、批量和重试遵守服务配置及厂商限制。
- 任意时刻可以停止会话并恢复原文。


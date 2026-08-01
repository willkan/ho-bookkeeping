# 一期技术选型提案

状态：已确认  
范围：iPhone / Android 单机单人一期；未来同步只作为演进约束，不在一期实现。

## 1. 结论

一期推荐：

- 客户端：Expo + React Native + TypeScript
- 路由：Expo Router
- 本地事实源：SQLite（`expo-sqlite`）
- 数据访问：显式 SQL migration + 按领域拆分的 repository；一期不引入 ORM、远程数据库或通用同步框架
- 运行时合同校验：Zod
- 表单：React Hook Form + Zod resolver（设置表单可用受控组件，不强制 RHF）
- UI：React Native 原生组件 + 自建少量 design tokens / primitives；不引入整套 UI kit
- 图表：`react-native-svg` + 小型纯函数统计/布局层；不引入重型 BI 图表框架
- 后台解析：SQLite 持久化作业表 + 前台 worker + `expo-background-task` 补充调度
- **AI 调用（一期确认）**：个人 BYOK — 客户端用官方 OpenAI JS/TS SDK 直接调用用户配置的**一个** OpenAI 兼容 Chat Completions 端点（如 DeepSeek）；**不**部署 Cloudflare AI 网关
- AI 模型：用户在设置中显式填写 model 字符串；模型名是运行配置，不进入账本合同；无自动 model fallback
- **语音输入（一期确认）**：`react-native-sherpa-onnx@0.4.3` 负责 16 kHz PCM 麦克风流与 SenseVoiceSmall INT8 离线识别；Silero VAD 按 sherpa-onnx 官方参数对 PCM 分段，停顿后模拟流式返回稳定语段。当前 RN SDK 的 VAD 导出仍是占位实现，因此项目只补一个直接调用同版本 sherpa 原生 VAD 的薄桥；`expo-audio@57.0.2` 只复用跨端麦克风权限 API。模型首次使用时按需下载；不生成录音文件，不依赖系统语音识别或第三方云 ASR
- 文件导出：客户端本地生成 `.xlsx`，写入 `expo-file-system` 后调用系统分享面板；具体 xlsx 库先做一个真机 spike 再冻结
- 敏感数据：SQLite 启用 SQLCipher，密钥保存在系统安全存储；**Provider API Key 仅存 expo-secure-store**，永不入 SQLite/日志/导出
- 测试：纯领域规则单元测试 + SQLite 真库集成测试 + iOS/Android 关键路径 E2E

## 2. 正式架构边界

### 2.1 事实源

本地 SQLite 是一期唯一正式账本事实源，保存：

- 原始输入及其提交上下文快照
- 持久化解析作业及生命周期
- AI 返回的待校验候选结果（仅在本地）
- 已生效的扁平消费记录
- 标签、模式、本次实付和优惠券抵扣
- 作业诊断用非密钥元数据（provider host、model、config revision）

内存状态、React 组件状态、AI 响应、统计结果和导出文件都不是正式事实源。  
用户 BYOK 配置（Base URL / API Key / Model）的**配置真相**在 `expo-secure-store`，不是账本事实。

同一原始输入生成的扁平记录保存稳定 `source_sequence`。它只是记录自身的来源顺序字段，用来替代同一时间戳下按随机 ID 排序的偶然行为，不形成购物组或子项实体。

### 2.2 状态机

应用服务负责执行 PRD 中的状态迁移，例如：

`已保存 → 待解析 → 已入账 / 待确认 / 解析失败`

一次提交保存“原始输入 + 唯一待解析作业”必须使用同一个 SQLite 事务。AI 只产生候选数据；只有本地合同校验和状态机可以使消费记录生效。

### 2.3 投影

账本列表、统计占比、趋势、模式视图和 Excel 内容都是从当前有效消费记录计算出的 read model。投影不得反向成为事实，也不得保存额外的“合计消费记录”。

### 2.4 Transport / AI 适配（BYOK）

#### 分层结论

1. **事实源**：SQLite 账本与作业行。
2. **状态机**：`LedgerService` / 本地校验 — 唯一入账许可。
3. **配置**：`SecureProviderConfigRepository`（secure store）— 单一生效 OpenAI 兼容配置。
4. **传输**：`OpenAiCompatibleParseTransport` — 官方 SDK Chat Completions JSON mode；输出为不可信提案。
5. **合同 schema**：`packages/contracts` — 客户端组装的 `ParseRequest` 与本地校验用 `ParseResponse` / 候选记录形状；**不是**部署型 client↔gateway 合同。

#### 职责

基础设施 AI adapter 仅：

- 从 secure store 解析当前配置；缺失则显式 `invalid_request` / 配置错误，不丢作业
- 用官方 OpenAI SDK（`baseURL` + `apiKey` + model）调用 Chat Completions
- 要求 JSON 对象输出（`response_format: { type: "json_object" }`），解析后对照 contracts schema
- 记录非密钥元数据（host、model、config revision、request_id、latency 类别）
- **永不**记录或持久化 API Key、原文金额明细到诊断日志

个人 BYOK 客户端环境：若 SDK 要求浏览器/客户端环境 opt-in（如 `dangerouslyAllowBrowser`），**仅**在 infrastructure adapter 工厂内窄隔离并文档化；业务层与 UI 不得接触该开关。

禁止：

- raw HTTP 复刻 SDK 已覆盖的 Chat Completions 调用
- 多 provider 注册表 / fallback / 网关双轨
- 将密钥写入 SQLite、export、错误 message、持久 React 全局状态

发送内容仍仅为单次解析最小上下文；不上传完整账本。

### 2.5 UI

UI 只调用应用服务与配置用例，不直接拼 SQL 或散落调用模型。界面可先乐观展示“已记下”，但正式状态始终来自 SQLite。设置页提供 BYOK 表单（Endpoint / Key / Model / 保存 / 测试 / 掩码 / 清空）。

### 2.6 语音识别适配（预输入）

#### 分层结论

1. **事实源**：仍为 SQLite 原文与作业行；语音**不**写入账本实体。
2. **状态机**：`LedgerService` 提交路径不变；语音**不得**绕过「记下来」。
3. **语音会话**：应用层可测的瞬时状态机（idle / 请求权限 / streaming / finalizing / 可恢复错误）；已完成语段是稳定预览，最终合并文字才写入受控原文。
4. **采集与识别边界**：`StreamingSpeechPort` + `SherpaStreamingSpeech`；一个端口拥有麦克风 PCM、Silero VAD、SenseVoice、订阅和取消的共同生命周期。原生模块 import **仅**在 `src/infrastructure/speech/`；`modules/sherpa-vad` 是 RN SDK 缺口的原生基础设施桥，不承载应用状态。
5. **模型边界**：`SpeechModelManagerPort` 管理固定清单、显式来源、下载进度、完整性校验、ready 发布与删除；模型文件不是账本数据。
6. **Fake**：测试只 fake 流式语音和模型文件传输边界，不 fake `LedgerService` / SQLite。

#### 依赖与原生证明

- 精确版本：`expo-audio@57.0.2`、`react-native-sherpa-onnx@0.4.3` 及其原生 peer dependency 均为 `apps/mobile` 直接依赖（autolinking）；前者只提供权限 API。
- Expo config：两端只声明麦克风权限，不再声明系统 speech recognition 权限或 Android recognition service package visibility；不启用后台录音。
- 本仓库使用 Expo 57.0.7 / RN 0.86：peerDependencies 宽松**不能**单独作为兼容证明；必须以**干净 prebuild + iOS 与 Android 真机/模拟器原生编译**为通过线。若因真实兼容原因无法原生编译，**完整移除**该依赖与半集成路径，不得保留 fallback。

#### 运行合同

- 模拟流式会话：sherpa 原生采集器产生 16 kHz 单声道 PCM；每个音频块串行进入同一个 Silero VAD。VAD 产出的完整语段按顺序交给同一个 SenseVoice offline recognizer，识别期间不并发处理语段，不创建录音文件。
- 转写：固定模型 `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17` 的 `model.int8.onnx`；`modelType: sense_voice`、自动语言、ITN、greedy search、2 threads、CPU provider。Silero VAD 使用官方 Android 示例默认值：threshold 0.5、minimum silence 0.25 秒、minimum speech 0.25 秒、window 512、maximum speech 5 秒；用户松手时先停止采集，再等待已排队 PCM 完成、调用 VAD `flush()` 并识别尾段。
- 已完成语段按顺序合并后只投影到瞬时 `partialText`；VAD 分段不能自动结束按住会话或把片段写进正式输入。最终合并结果只在松手后合入受控原文一次。
- 模型清单固定 SenseVoice revision、官方 Silero VAD、三个文件、字节数、SHA-256 和两个显式来源：国内镜像与 Hugging Face 境外源；小型 VAD 文件使用 sherpa-onnx 官方 GitHub Release。下载到临时目录，逐文件校验，最后写 ready 标记；校验失败不得提供“仍然使用”选项。
- 发布后的模型根目录名及其 `asr/` 完整路径不得包含 `vad` 或 `silero`，因为 `react-native-sherpa-onnx` 会按完整路径关键词探测模型类型。根目录内隔离为 `asr/`（`model.int8.onnx`、`tokens.txt`）与 `vad/`（`silero_vad.onnx`）；SDK 只扫描 `asr/`，VAD 薄桥只读取 `vad/silero_vad.onnx`。模型管理器一次性迁移已校验的旧根目录和平铺布局，不保留旧路径加载分支。
- 不根据网络失败自动切换下载源。下载来源只改变传输 URL，不改变模型 ID、校验值、运行配置或识别合同。
- 语音首次使用弹窗展示体积、离线隐私说明、来源选择、进度、失败和重试；模型未就绪时不得启动录音。模型删除入口不删除账本或 AI 提供商配置。
- 必须披露：语音不生成录音文件，模型下载完成后识别完全在本机进行。
- 页面卸载 / App 进入后台：停止 PCM 采集、取消订阅并释放当前识别流；不启用后台录音。模型下载状态独立于语音会话，可从中断状态显式重试。
- 权限拒绝、模型未就绪、模型加载失败、无语音、busy、interrupted 等映射为显式中文可恢复状态；不存在 network 转写错误。

#### 目录

```text
src/application/ports/streaming-speech.ts     # 麦克风权限与流式识别会话合同
src/application/ports/speech-model-manager.ts # 固定模型下载与生命周期
src/application/voice-session.ts              # 可测按住—增量预览—最终合入状态机
src/infrastructure/speech/                    # 原生 import 与生产适配器
```

## 3. 为什么选择 Expo / React Native

与 Flutter、Kotlin Multiplatform + 双原生 UI 相比：

| 方案                  | 优点                                                                     | 主要代价                                           | 本项目判断                 |
| --------------------- | ------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------- |
| Expo / React Native   | 一套 TypeScript 覆盖双端与合同校验；SQLite、安全存储、文件、后台任务现成 | 需要理解两端后台限制；少量能力需 development build | 推荐，产品复杂度最低       |
| Flutter               | UI 一致性强，性能稳定                                                    | Dart 与合同工具链分离                              | 可行，但没有形成决定性收益 |
| KMP + SwiftUI/Compose | 原生体验和平台控制最强                                                   | 两套 UI，团队与交付成本最高                        | 一期过度设计               |

本产品的视觉主要由排版、留白、动效节制和信息层级决定，不依赖无法由 React Native 实现的图形能力。选择跨端框架不会妨碍当前设计方向。

## 4. 数据层选择

### 4.1 SQLite 而不是 AsyncStorage

账本包含事务、关联、软删除、互斥统计、时间筛选和多表导出。SQLite 能提供原子事务、约束、索引和可复现查询；键值存储不适合作为正式账本。

建议初始化：

- `PRAGMA foreign_keys = ON`
- `PRAGMA journal_mode = WAL`
- schema version + 只向前 migration
- 所有金额使用整数“分”，不使用浮点数
- ID 由客户端生成并长期稳定
- 时间同时保存 UTC instant、原始时区和必要的本地日期语义
- 业务删除使用 `deleted_at` 软删除，所有正式查询显式过滤

### 4.2 一期不引入 ORM

一期表数量有限，但统计查询需要看得见的 SQL 语义。直接使用参数化 SQL，并把查询封装在领域 repository 中，能减少 migration、响应式查询和 ORM adapter 的额外隐式状态。

只有出现大量重复映射或 schema 维护已成为实际成本时，再评估 Drizzle；不预先双持两套数据访问路径。

### 4.3 为未来同步保留的最小条件

一期只保留不会制造双轨的基础字段：稳定 ID、`created_at`、`updated_at`、`deleted_at`。不提前实现 outbox、远程 revision、冲突副本或云端镜像表。

未来同步时，正式同步合同应围绕本地领域事实与 tombstone 设计，而不是把一期 SQLite 降级成缓存。

## 5. 后台解析语义

移动系统不保证提交后立即在后台联网。正式承诺应是：

1. 用户提交时，本地事务立即保存原文和唯一作业，UI 不等待 AI。
2. App 活跃时立即尝试执行队列。
3. 系统允许时由 background task 补充执行。
4. App 被用户强制结束后不承诺继续；下次启动或回到前台自动续跑。
5. 作业以稳定 job ID 幂等执行；网络失败保留明确失败原因和下一次可执行时间。
6. 不做无限静默重试；自动重试次数、退避和“需要用户重试”状态必须显式。
7. 一次输入返回的候选列表整体校验、整体生效，不允许静默部分入账。
8. 前台与后台 worker 使用同一 secure-store BYOK 配置解析路径；配置缺失时作业显式失败且行保留。

`expo-background-task` 在 Android 使用 WorkManager，在 iOS 使用 BGTaskScheduler；具体触发时机由系统决定，因此它只能是持久化队列的调度器，不能成为任务事实源。

## 6. AI 边界与隐私（BYOK）

- **不**把供应商 API key 打进 App 包或仓库；用户自备密钥，仅存 `expo-secure-store`（`WHEN_UNLOCKED_THIS_DEVICE_ONLY` 语义）。
- **不**部署服务端网关代持密钥；一期唯一生产 AI 路径是设备直连用户配置的 OpenAI 兼容端点。
- 每次解析请求携带 `contract_version` 与客户端 `request_id`。
- 模型输出经 JSON 解析后必须通过本地 Zod transport schema 与领域金额关系校验。
- Prompt / model / config revision / provider host 可记在作业技术元数据中，便于定位漂移，**不影响**已生效账目。
- 设置变更只影响之后可执行作业；已入账记录不回写。

隐私原则：

- 不上传完整账本
- 不把 API Key、原文、金额、商户或完整模型输出写入应用日志
- 日志只记录 request ID、合同版本、model、provider host、config revision、耗时、token 用量（若有）、状态和错误类别
- root/越狱设备可暴露本地密钥 — UI 必须有简短披露
- 崩溃分析默认不附带账本字段或密钥；未来接入第三方诊断前需单独确认

### 6.1 Base URL 归一化约定

保存时执行一次（见 PRD §2.0.3）：trim、去尾 `/`、绝对 URL 校验、非环回强制 HTTPS、不改写 path。

### 6.2 相对旧网关的删除与净熵

| 删除/退役                                     | 替代                                         |
| --------------------------------------------- | -------------------------------------------- |
| `services/ai-gateway` Cloudflare Worker       | 客户端 SDK 直连                              |
| `EXPO_PUBLIC_AI_GATEWAY_URL` 环境变量生产路径 | 设置内 BYOK 配置                             |
| OpenAI Responses-only 网关适配                | Chat Completions JSON mode                   |
| SQLite `ai_gateway_base_url` 作为 AI 配置     | secure store 配置；SQLite 仅作业非密钥元数据 |

**净熵下降**：去掉一整条部署与双轨解析路径；新增的 secure config + 设置 UI 替代原先“环境变量 + Worker + Secret”复杂度，且边界更贴合个人单机产品。

## 7. Excel 导出

导出完全在设备本地完成：SQLite 一致性快照 → 领域导出模型 → xlsx bytes → 临时文件 → 系统分享面板。

导出**不得**包含 API Key、secure store 内容或内部队列密钥类字段。

xlsx 生态在 React Native 上的兼容性和维护状态不如 SQLite 稳定，因此在正式实现前做一个有明确验收线的 spike：

- iPhone 与 Android 真机均可生成并分享
- 中文 sheet 名、中文内容、日期、整数金额与多 sheet 正确
- 1 万条消费记录内存可接受
- Excel、Numbers 和 WPS 至少各验证一种
- 生成文件不包含未选择字段和内部队列状态

spike 只在 `ExcelJS` 与 `SheetJS` 中择一，验证失败的库直接移除，不保留 fallback。若两者都不能稳定满足，再考虑单独的原生 xlsx 模块。

## 8. 客户端代码边界

建议目录只表达稳定职责：

```text
apps/mobile/
  app/                 # Expo Router 页面，只做装配
  src/domain/          # 金额、标签、模式、统计规则
  src/application/     # 用例与状态机编排（含可测语音会话）
  src/infrastructure/
    db/                # schema、migration、repository
    ai/                # BYOK secure config + OpenAI-compatible transport
    jobs/              # 持久化队列执行器
    export/            # Excel 投影与文件输出
    speech/            # sherpa-onnx、本地模型与录音适配（仅此目录原生 import）
  src/ui/              # tokens、primitives、feature components
packages/contracts/    # 解析请求/候选响应 schema（本地校验用）
```

- 已删除：`services/ai-gateway/`（一期不保留网关工作区）。
- `packages/contracts` 只共享 AI 解析 DTO；不能包含 SQLite entity 或 UI view model。

## 9. 测试重心

- 领域单测：金额与抵扣关系、标签归一建议、互斥统计组、不重不漏、软删除过滤
- 状态机单测：提交原子性、整体入账、确认模式、失败与显式重试、幂等作业
- SQLite 真库集成：migration、事务、约束、repository、统计 SQL、导出查询
- BYOK / AI 合同：secure 持久化无密钥泄漏、URL 校验、掩码与清空、SDK 请求形状、DeepSeek 风格 base URL/model、非法 JSON/schema 失败、多记录整表校验、配置变更与重启后作业、源码守卫禁止 key 入日志/导出/SQLite
- AI 合同测试：固定输入/输出 fixture；fake 只替换 transport，不伪造应用服务或数据库
- 语音模型单测：首次使用必须明确选择来源；国内/境外 URL 映射到同一文件清单；字节数与 SHA-256 校验；半包不可见；中断、空间不足、校验失败、重试和删除
- 语音会话单测：权限通过/拒绝、模型未就绪不收音、按下建立单一流、增量预览不提交、短暂停顿不停止、松开才停止并最终合入一次、权限弹窗期间松开不得迟发收音、屏幕阅读器点按切换、保留已键入原文、无语音/异步错误/取消、卸载/后台释放、不自动提交/不创建 SQLite 作业
- 双端 E2E：快速连续记账、杀进程后续跑、三条独立记录、逐条编辑、模式跳出、优惠券抵扣、导出

默认 gate 保护领域合同、状态机和 SQLite 真库；真实联网 smoke 单独运行，不能成为本地账本正确性的前置条件。语音识别质量以实体设备验收；模拟器路径不能冒充实机识别通过。

## 10. 暂不引入

- 用户系统、家庭账本、远程主库、实时同步
- Firebase / Supabase 作为本地账本事实源
- CRDT、event sourcing、通用 workflow engine
- Redux 作为账本存储
- 多 AI provider fallback / 自动 model fallback
- 系统语音识别 / 第三方云 ASR / 语音 provider fallback / 音频账本实体 / 文档目录持久录音 / 后台持续录音
- 远程配置偷偷改变账本语义
- 为未来功能预建空 service / adapter
- Cloudflare / 自建 AI 网关作为一期生产路径

## 11. 仍需在开工前冻结的选择

1. SQLCipher 是否一期强制启用；本提案建议启用。（实现侧已按启用路径落地）
2. ~~AI 网关 vs BYOK~~ — **已确认：一期仅 BYOK 直连，无统一网关。**
3. AI 模型的质量/成本基准集与最终 snapshot（由用户自选 model；产品侧可维护推荐示例，非硬编码唯一模型）。
4. xlsx 真机 spike 后选择 ExcelJS 或 SheetJS。
5. E2E 使用 Maestro 还是 Detox；应在首个纵向切片跑通后只保留一套。

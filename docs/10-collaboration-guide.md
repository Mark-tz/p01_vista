# 智能巡检调度系统 — 协作规范与工具链

> 版本：v0.1.0-draft
> 日期：2026-03-04

---

## 1. Mock 并行开发策略

### 1.1 核心思路

```
接口契约先行 → Mock 驱动并行 → 联调验证 → 替换真实服务
```

各工种之间的依赖通过 **接口契约 + Mock** 解耦，确保前端不等后端、后端不等 AI、集成不等硬件。

### 1.2 Mock 层级

```
┌─────────────────────────────────────────────────────────────┐
│                    前端 Mock 层                               │
│  MSW (Mock Service Worker)                                  │
│  拦截 HTTP/WS 请求，返回模拟数据                               │
│  适用：后端接口未就绪时前端独立开发                              │
├─────────────────────────────────────────────────────────────┤
│                    后端 Mock 层                               │
│  gRPC Mock Server / 接口 Stub                                │
│  适用：依赖服务未就绪时独立开发（如 Task 依赖 Device）           │
├─────────────────────────────────────────────────────────────┤
│                    设备 Mock 层                               │
│  Robot Simulator (MQTT 模拟器)                               │
│  适用：无真实机器人时全链路联调                                 │
├─────────────────────────────────────────────────────────────┤
│                    AI Mock 层                                 │
│  固定返回 Mock 识别结果                                       │
│  适用：模型未训练完成时集成测试                                 │
├─────────────────────────────────────────────────────────────┤
│                    视频 Mock 层                               │
│  FFmpeg 推送本地视频文件到 RTSP                               │
│  适用：无真实摄像头时测试视频链路                               │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 前端 Mock 方案 — MSW (Mock Service Worker)

```
web/src/mocks/
├── handlers/
│   ├── auth.ts          # 认证接口 mock
│   ├── users.ts         # 用户管理 mock
│   ├── robots.ts        # 设备管理 mock
│   ├── maps.ts          # 地图服务 mock
│   ├── tasks.ts         # 任务管理 mock
│   ├── alarms.ts        # 告警管理 mock
│   └── index.ts         # 汇总导出
├── data/
│   ├── robots.json      # 机器人模拟数据
│   ├── maps.json        # 地图模拟数据
│   ├── tasks.json       # 任务模拟数据
│   └── ...
├── browser.ts           # 浏览器端 worker 初始化
└── server.ts            # Node 端（用于 SSR/测试）
```

**使用方式**：
```typescript
// main.ts — 仅开发环境启用
if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK === 'true') {
  const { worker } = await import('./mocks/browser')
  await worker.start({ onUnhandledRequest: 'bypass' })
}
```

**Mock Handler 示例**：
```typescript
// handlers/robots.ts
import { http, HttpResponse } from 'msw'
import robotsData from '../data/robots.json'

export const robotHandlers = [
  http.get('/api/v1/robots', () => {
    return HttpResponse.json({
      code: 0,
      message: 'success',
      data: { list: robotsData, total: robotsData.length, page: 1, page_size: 20 }
    })
  }),
  http.get('/api/v1/robots/:id', ({ params }) => {
    const robot = robotsData.find(r => r.id === Number(params.id))
    return HttpResponse.json({ code: 0, data: robot })
  }),
]
```

**WebSocket Mock**：
```typescript
// 使用独立的 mock WebSocket server (ws 库)
// 在 dev server 中启动，模拟实时位置推送
```

### 1.4 后端 Mock 方案 — 接口 Stub

后端服务间依赖通过 **Go interface + 依赖注入** 解耦：

```go
// pkg/device/client.go — 定义接口
type DeviceClient interface {
    GetRobot(ctx context.Context, id int64) (*Robot, error)
    ListOnlineRobots(ctx context.Context, siteID int64) ([]*Robot, error)
}

// 真实实现
type grpcDeviceClient struct { conn *grpc.ClientConn }

// Mock 实现 — 用于其他服务独立开发/测试
type mockDeviceClient struct{}
func (m *mockDeviceClient) GetRobot(ctx context.Context, id int64) (*Robot, error) {
    return &Robot{ID: id, Name: "Mock-Robot", Status: "online", BatteryLevel: 85}, nil
}
```

配置切换：
```yaml
# config.dev.yaml
device_service:
  mode: "mock"    # mock | grpc
  grpc_addr: "device-svc:9090"
```

### 1.5 设备 Mock 方案 — 机器人模拟器

```
tools/robot-simulator/
├── cmd/
│   └── simulator/main.go
├── internal/
│   ├── robot.go         # 单台机器人模拟逻辑
│   ├── trajectory.go    # 轨迹生成（按路线点插值）
│   ├── sensor.go        # 传感器数据模拟
│   ├── task.go          # 任务执行模拟
│   └── config.go        # 配置
├── configs/
│   ├── default.yaml     # 默认配置
│   └── trajectories/    # 预定义轨迹文件
└── README.md
```

**模拟器能力**：
| 功能 | 说明 |
|------|------|
| 多台模拟 | 同时运行 N 台虚拟机器人 |
| 状态上报 | MQTT 定时发送 status/telemetry |
| 任务响应 | 监听 cmd topic，模拟执行并上报进度 |
| 轨迹播放 | 沿预设路线移动，支持速度调节 |
| 异常模拟 | 随机断连、低电量、传感器超限 |
| 图片上传 | 上传预设图片到 MinIO 模拟抓拍 |

### 1.6 AI Mock 方案

```python
# services/ai/mock_mode.py
class MockRecognizer:
    """AI 模型未就绪时的 Mock 实现"""

    def recognize(self, image_bytes: bytes) -> dict:
        return {
            "type": "meter_read",
            "value": round(random.uniform(0, 100), 2),
            "unit": "°C",
            "confidence": 0.95,
            "bbox": [100, 100, 300, 300],
        }
```

配置切换：
```yaml
ai_service:
  mode: "mock"    # mock | onnx | tensorrt
```

### 1.7 各阶段 Mock 退出计划

| Sprint | Mock 内容 | 退出条件 |
|--------|----------|----------|
| S2 | 前端 Mock 全部 API | S3 后端 API 上线后逐步替换 |
| S3 | 后端 Mock 设备服务 | BE-101 完成后替换 |
| S3 | 机器人模拟器替代真实机器人 | 真实机器人对接后保留作为测试工具 |
| S7 | AI Mock 固定返回值 | AI-201 推理框架完成后替换 |
| S8 | 视频 Mock (FFmpeg 推流) | 真实摄像头接入后替换 |

---

## 2. 接口契约管理规范

### 2.1 Proto 文件管理

```
proto/
├── common/
│   └── v1/
│       ├── pagination.proto     # 分页通用消息
│       └── response.proto       # 统一响应
├── device/
│   └── v1/
│       └── device.proto         # 设备服务接口
├── task/
│   └── v1/
│       └── task.proto           # 任务服务接口
├── alarm/
│   └── v1/
│       └── alarm.proto
├── map/
│   └── v1/
│       └── map.proto
├── ai/
│   └── v1/
│       └── recognition.proto
└── buf.yaml                     # buf 工具配置
```

### 2.2 接口变更流程

```
1. 提出变更 PR（修改 .proto 文件）
         │
2. 自动检查向后兼容性（buf breaking）
         │
3. 相关方 Code Review
   (前端、后端、AI 各至少一人)
         │
4. 合并后自动生成各语言 Stub
   (Go / Python / TypeScript)
         │
5. 在接口对齐会上通知所有人
         │
6. 各端限期(1 Sprint)内完成适配
```

### 2.3 接口版本策略

- API 路径携带版本号：`/api/v1/...`
- Proto package 携带版本：`vista.device.v1`
- **重大不兼容变更**：发布 v2，v1 保持 6 个月兼容期
- **字段新增**：向后兼容，不需要新版本
- **字段删除/改名**：标记 deprecated，下一大版本删除

---

## 3. Git 工作流

### 3.1 分支策略（Git Flow 简化版）

```
main          ─────────────────────────────────────────────► (生产)
                    ▲           ▲           ▲
                    │           │           │
release/v0.1 ──────┘  v0.2 ───┘  v0.3 ───┘           (发版分支)
                    ▲           ▲
                    │           │
develop       ──────┴───────────┴─────────────────────► (集成)
              ▲  ▲  ▲  ▲  ▲
              │  │  │  │  │
feature/      ┘  ┘  ┘  ┘  ┘                           (特性分支)
```

### 3.2 分支命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 特性分支 | `feature/{工种}-{任务号}-{简述}` | `feature/be-104-task-service` |
| 修复分支 | `fix/{issue号}-{简述}` | `fix/42-task-status-error` |
| 热修复 | `hotfix/{简述}` | `hotfix/login-token-expire` |
| 发版分支 | `release/v{major}.{minor}` | `release/v0.1` |

### 3.3 Commit 规范（Conventional Commits）

```
<type>(<scope>): <subject>

<body>

<footer>
```

| type | 说明 | 示例 |
|------|------|------|
| feat | 新功能 | `feat(task): add task state machine` |
| fix | Bug 修复 | `fix(auth): token refresh race condition` |
| refactor | 重构 | `refactor(mqtt): extract message router` |
| docs | 文档 | `docs: update API specification` |
| test | 测试 | `test(device): add integration tests` |
| chore | 构建/工具 | `chore(ci): add docker build step` |
| perf | 性能优化 | `perf(monitor): batch websocket messages` |

### 3.4 PR / MR 规范

```markdown
## 关联任务
- 任务 ID: BE-104
- Sprint: S4

## 变更说明
简述本次变更的内容和目的

## 测试说明
- [ ] 单元测试通过
- [ ] 相关接口已用 Postman/Bruno 验证
- [ ] 无 lint 告警

## 影响范围
- [ ] 涉及数据库变更（附迁移脚本）
- [ ] 涉及接口变更（已更新 Proto/Swagger）
- [ ] 涉及配置变更（已更新 config.example.yaml）
```

---

## 4. 推荐管理工具

### 4.1 项目管理与任务跟踪

| 工具 | 适用场景 | 推荐理由 | 费用 |
|------|----------|----------|------|
| **Linear** ⭐推荐 | 敏捷研发管理 | 极简设计、Sprint/Cycle 原生支持、键盘操作快、GitHub 集成好 | 免费(小团队)/\$8/人/月 |
| **GitHub Projects** | 轻量看板 | 零成本、与代码仓库天然集成、自动化 Workflow | 免费 |
| **Plane** | 自托管管理 | 开源、可私有部署、类 Linear 体验 | 免费(自托管) |
| **Jira** | 大型团队 | 功能全面、报表丰富 | \$7.75/人/月起 |
| **飞书项目** | 国内团队 | 中文友好、IM 集成、审批流 | 按套餐 |

**推荐组合**（适合 5-10 人研发团队）：

```
┌─────────────────────────────────────────────────────┐
│  Linear (或 Plane 自托管)                            │
│  任务管理 · Sprint 看板 · 进度追踪 · 路线图          │
├─────────────────────────────────────────────────────┤
│  GitHub / GitLab                                    │
│  代码托管 · PR 审查 · CI/CD · Issue 追踪            │
├─────────────────────────────────────────────────────┤
│  飞书 / Slack                                       │
│  日常沟通 · 会议 · 文档 · Bot 通知                   │
└─────────────────────────────────────────────────────┘
```

### 4.2 文档与知识管理

| 工具 | 用途 | 推荐理由 |
|------|------|----------|
| **VitePress** | 技术文档站 | Markdown 驱动、Vue 生态、可自动部署 |
| **语雀 / Notion** | 团队 Wiki | 结构化知识库、协同编辑 |
| **飞书文档** | 日常协作文档 | 与 IM 深度集成 |
| **Swagger UI** | API 文档 | 可交互测试、自动生成 |

### 4.3 设计协作

| 工具 | 用途 |
|------|------|
| **Figma** | UI/UX 设计稿、组件库、原型 |
| **Excalidraw** | 架构图、白板、草图（轻量替代） |
| **draw.io** | 流程图、ER 图、部署图 |

### 4.4 开发效率

| 工具 | 用途 | 说明 |
|------|------|------|
| **Bruno / Postman** | API 测试 | Bruno 开源免费、Git 版本化 |
| **Cursor** | AI 辅助编码 | 结合 AI Coding 加速开发 |
| **Testcontainers** | 集成测试 | 一键启动测试依赖容器 |
| **k6** | 性能测试 | JS 脚本驱动、CI 友好 |

### 4.5 监控与运维

| 工具 | 用途 |
|------|------|
| **Grafana + Prometheus** | 监控指标可视化 |
| **Grafana Loki** | 日志聚合 |
| **Jaeger** | 链路追踪 |
| **Sentry** | 前端错误监控 + 后端异常追踪 |

---

## 5. 每日协作流程

```
09:30  每日站会 (15min)
       ├── 每人 ≤ 2min: 昨日完成 · 今日计划 · 阻塞问题
       └── 阻塞问题会后立即拉小会解决

10:00  各工种进入开发
       ├── 后端: 按任务开发，单元测试跟进
       ├── 前端: Mock 模式开发页面
       ├── AI: 模型训练/推理服务开发
       └── DevOps: 基础设施维护

14:00  (如需) 接口对齐 / 技术讨论 (30min)
       ├── Mock 数据是否需要更新
       ├── 接口变更通知
       └── 联调阻塞问题

17:00  代码提交 + PR 审查
       ├── 每日至少提交一次有意义的进展
       └── PR 24h 内完成 Review

Sprint 结尾
       ├── Sprint 评审 (1h): 演示成果
       ├── Sprint 回顾 (30min): 过程改进
       └── Sprint 计划 (2h): 下一迭代任务确认
```

---

## 6. 前后端联调检查清单

每次前后端接口联调时使用：

```markdown
## 联调检查清单 — {接口名称}

### 准备
- [ ] 后端接口已部署到 Dev 环境
- [ ] Swagger 文档已更新
- [ ] 前端已切换为真实 API（关闭 Mock）

### 正常流程
- [ ] 请求参数正确传递
- [ ] 响应数据格式符合契约
- [ ] 分页参数/返回正确
- [ ] 加载状态/空状态处理

### 异常流程
- [ ] 401 未登录 → 跳转登录页
- [ ] 403 无权限 → 提示无权限
- [ ] 404 资源不存在 → 友好提示
- [ ] 500 服务端错误 → 通用错误提示
- [ ] 网络超时 → 重试提示
- [ ] 参数校验失败 → 字段级错误提示

### 性能
- [ ] 列表接口响应 < 500ms
- [ ] 无 N+1 查询问题
- [ ] 大数据量分页正常
```

---

## 7. 质量红线

| 红线 | 标准 | 检查时机 |
|------|------|----------|
| 编译通过 | CI 构建零错误 | 每次提交 |
| Lint 通过 | golangci-lint / ESLint 零错误 | 每次提交 |
| 单元测试 | 覆盖率 ≥ 70%，零失败 | 每次 PR |
| 接口契约 | Proto 向后兼容检查通过 | 每次 Proto 变更 |
| 安全扫描 | 无高危依赖漏洞 | 每周自动扫描 |
| 无硬编码 | 密钥/密码不提交到代码仓库 | 每次 PR |
| 数据库迁移 | 有 up + down 脚本，可回滚 | 每次 Schema 变更 |
| 文档同步 | 接口变更同步更新文档 | 每次 PR |

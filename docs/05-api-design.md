# 智能巡检调度系统 — 接口设计规范

> 版本：v0.1.0-draft
> 日期：2026-03-04

---

## 1. 接口设计原则

| 原则 | 说明 |
|------|------|
| RESTful | HTTP API 遵循 REST 规范，资源导向 |
| 版本化 | URL 路径包含版本号 `/api/v1/...` |
| 统一响应 | 所有接口使用统一的响应格式 |
| 幂等性 | PUT/DELETE 操作幂等，POST 通过幂等键去重 |
| 分页 | 列表接口统一分页参数 |
| 错误码 | 业务错误码体系化，前端可据此展示 |

---

## 2. 统一响应格式

### 成功响应

```json
{
    "code": 0,
    "message": "success",
    "data": { ... },
    "timestamp": 1709539200000
}
```

### 分页响应

```json
{
    "code": 0,
    "message": "success",
    "data": {
        "list": [ ... ],
        "total": 100,
        "page": 1,
        "page_size": 20
    },
    "timestamp": 1709539200000
}
```

### 错误响应

```json
{
    "code": 40001,
    "message": "参数校验失败",
    "details": [
        { "field": "name", "message": "不能为空" }
    ],
    "timestamp": 1709539200000
}
```

---

## 3. 错误码体系

| 范围 | 类别 | 示例 |
|------|------|------|
| 0 | 成功 | 0 = OK |
| 40000-40099 | 通用客户端错误 | 40001 = 参数校验失败 |
| 40100-40199 | 认证错误 | 40101 = Token 过期 |
| 40300-40399 | 权限错误 | 40301 = 无操作权限 |
| 40400-40499 | 资源不存在 | 40401 = 资源未找到 |
| 40900-40999 | 冲突 | 40901 = 资源已存在 |
| 50000-50099 | 服务端错误 | 50001 = 内部错误 |
| 50300-50399 | 下游服务错误 | 50301 = 设备通信失败 |
| 60000-60099 | 设备相关 | 60001 = 机器人离线 |
| 60100-60199 | 任务相关 | 60101 = 任务状态不允许此操作 |
| 60200-60299 | 告警相关 | 60201 = 告警已关闭 |

---

## 4. 认证与鉴权

### 4.1 认证流程

```
Client                   Gateway                    IAM Service
  │                         │                           │
  │  POST /api/v1/auth/login│                           │
  │  {username, password}   │                           │
  │────────────────────────►│  gRPC: Authenticate()     │
  │                         │──────────────────────────►│
  │                         │  {user, permissions}       │
  │                         │◄──────────────────────────│
  │  {access_token,         │                           │
  │   refresh_token}        │                           │
  │◄────────────────────────│                           │
  │                         │                           │
  │  GET /api/v1/tasks      │                           │
  │  Authorization: Bearer  │                           │
  │────────────────────────►│  JWT 验证 + RBAC 检查     │
  │                         │──────► Task Service       │
```

### 4.2 Token 规格

| 属性 | Access Token | Refresh Token |
|------|-------------|---------------|
| 有效期 | 2 小时 | 7 天 |
| 存储 | 前端内存 | HttpOnly Cookie |
| 载荷 | user_id, roles, permissions | user_id |

---

## 5. HTTP API 列表

### 5.1 认证模块

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/login` | 用户登录 |
| POST | `/api/v1/auth/logout` | 用户登出 |
| POST | `/api/v1/auth/refresh` | 刷新 Token |
| GET | `/api/v1/auth/profile` | 获取当前用户信息 |
| PUT | `/api/v1/auth/password` | 修改密码 |

### 5.2 用户管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/users` | 用户列表（分页） |
| POST | `/api/v1/users` | 创建用户 |
| GET | `/api/v1/users/{id}` | 用户详情 |
| PUT | `/api/v1/users/{id}` | 更新用户 |
| DELETE | `/api/v1/users/{id}` | 删除用户（软删除） |
| PUT | `/api/v1/users/{id}/roles` | 分配角色 |
| GET | `/api/v1/roles` | 角色列表 |
| POST | `/api/v1/roles` | 创建角色 |
| PUT | `/api/v1/roles/{id}/permissions` | 分配权限 |
| GET | `/api/v1/permissions` | 权限列表 |

### 5.3 场站与地图

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/sites` | 场站列表 |
| POST | `/api/v1/sites` | 创建场站 |
| GET | `/api/v1/sites/{id}` | 场站详情 |
| PUT | `/api/v1/sites/{id}` | 更新场站 |
| GET | `/api/v1/sites/{id}/floors` | 楼层列表 |
| POST | `/api/v1/sites/{id}/floors` | 创建楼层 |
| GET | `/api/v1/floors/{id}/map` | 获取地图数据 |
| POST | `/api/v1/floors/{id}/map` | 上传/更新地图 |
| GET | `/api/v1/floors/{id}/fences` | 获取电子围栏 |
| POST | `/api/v1/floors/{id}/fences` | 创建电子围栏 |
| PUT | `/api/v1/fences/{id}` | 更新电子围栏 |
| DELETE | `/api/v1/fences/{id}` | 删除电子围栏 |

### 5.4 巡检点与路线

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/floors/{id}/points` | 巡检点列表 |
| POST | `/api/v1/floors/{id}/points` | 创建巡检点 |
| GET | `/api/v1/points/{id}` | 巡检点详情 |
| PUT | `/api/v1/points/{id}` | 更新巡检点 |
| DELETE | `/api/v1/points/{id}` | 删除巡检点 |
| GET | `/api/v1/sites/{id}/routes` | 路线列表 |
| POST | `/api/v1/sites/{id}/routes` | 创建路线 |
| GET | `/api/v1/routes/{id}` | 路线详情 |
| PUT | `/api/v1/routes/{id}` | 更新路线 |
| POST | `/api/v1/routes/{id}/optimize` | 路线顺序优化 |

### 5.5 设备管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/robots` | 机器人列表 |
| POST | `/api/v1/robots` | 注册机器人 |
| GET | `/api/v1/robots/{id}` | 机器人详情 |
| PUT | `/api/v1/robots/{id}` | 更新机器人信息 |
| GET | `/api/v1/robots/{id}/status` | 实时状态 |
| GET | `/api/v1/robots/{id}/trajectory` | 轨迹查询 |
| POST | `/api/v1/robots/{id}/command` | 下发控制指令 |
| GET | `/api/v1/charging-stations` | 充电桩列表 |
| GET | `/api/v1/charging-stations/{id}` | 充电桩详情 |

### 5.6 任务管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/tasks` | 任务列表（分页+筛选） |
| POST | `/api/v1/tasks` | 创建任务 |
| GET | `/api/v1/tasks/{id}` | 任务详情 |
| PUT | `/api/v1/tasks/{id}` | 更新任务 |
| POST | `/api/v1/tasks/{id}/start` | 启动任务 |
| POST | `/api/v1/tasks/{id}/pause` | 暂停任务 |
| POST | `/api/v1/tasks/{id}/resume` | 恢复任务 |
| POST | `/api/v1/tasks/{id}/cancel` | 取消任务 |
| GET | `/api/v1/tasks/{id}/executions` | 执行记录列表 |
| GET | `/api/v1/executions/{id}` | 执行详情 |
| GET | `/api/v1/executions/{id}/results` | 巡检结果列表 |
| GET | `/api/v1/executions/{id}/report` | 生成执行报告 |

### 5.7 告警管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/alarms` | 告警列表（分页+筛选） |
| GET | `/api/v1/alarms/{id}` | 告警详情 |
| POST | `/api/v1/alarms/{id}/acknowledge` | 确认告警 |
| POST | `/api/v1/alarms/{id}/resolve` | 解决告警 |
| POST | `/api/v1/alarms/{id}/close` | 关闭告警 |
| GET | `/api/v1/alarms/{id}/history` | 处理历史 |
| GET | `/api/v1/alarm-rules` | 告警规则列表 |
| POST | `/api/v1/alarm-rules` | 创建告警规则 |
| PUT | `/api/v1/alarm-rules/{id}` | 更新告警规则 |
| GET | `/api/v1/alarms/stats` | 告警统计 |

### 5.8 数据中心

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/media/images` | 图片列表（按时间/任务检索） |
| GET | `/api/v1/media/videos` | 视频列表 |
| GET | `/api/v1/sensor-data` | 传感器数据查询 |
| GET | `/api/v1/ai-records` | AI 识别记录 |
| GET | `/api/v1/ai-records/{id}/compare` | 图片对比 |
| GET | `/api/v1/ai-records/stats` | 识别统计 |
| POST | `/api/v1/reports/generate` | 生成报表 |
| GET | `/api/v1/reports` | 报表列表 |
| GET | `/api/v1/reports/{id}/download` | 下载报表 |

### 5.9 远程操控

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/robots/{id}/takeover` | 请求人工接管 |
| POST | `/api/v1/robots/{id}/release` | 释放操控权 |
| GET | `/api/v1/robots/{id}/stream` | 获取视频流地址 |

### 5.10 系统管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/system/config` | 获取系统配置 |
| PUT | `/api/v1/system/config` | 更新系统配置 |
| GET | `/api/v1/system/audit-logs` | 审计日志查询 |
| POST | `/api/v1/system/backup` | 触发备份 |
| GET | `/api/v1/system/health` | 系统健康检查 |

### 5.11 OTA 升级

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/ota/firmware` | 固件版本列表 |
| POST | `/api/v1/ota/firmware` | 上传固件包 |
| POST | `/api/v1/ota/tasks` | 创建升级任务 |
| GET | `/api/v1/ota/tasks/{id}` | 升级任务状态 |

---

## 6. WebSocket 接口

### 6.1 连接建立

```
WS /api/v1/ws?token={access_token}
```

### 6.2 消息格式

```json
{
    "type": "event_type",
    "data": { ... },
    "timestamp": 1709539200000
}
```

### 6.3 事件类型

| 事件 | 方向 | 说明 |
|------|------|------|
| `robot.status` | S→C | 机器人状态更新 |
| `robot.position` | S→C | 机器人位置更新 (10Hz) |
| `task.progress` | S→C | 任务进度更新 |
| `task.status_change` | S→C | 任务状态变更 |
| `alarm.new` | S→C | 新告警 |
| `alarm.update` | S→C | 告警状态变更 |
| `subscribe` | C→S | 订阅频道 |
| `unsubscribe` | C→S | 取消订阅 |

### 6.4 订阅机制

```json
// 订阅
{ "type": "subscribe", "data": { "channels": ["site:1:floor:2", "robot:5"] } }

// 取消订阅
{ "type": "unsubscribe", "data": { "channels": ["site:1:floor:2"] } }
```

---

## 7. 远程操控 WebSocket

### 7.1 连接建立

```
WS /api/v1/ws/remote-control/{robot_id}?token={access_token}
```

### 7.2 控制指令 (C→S)

```json
{
    "type": "move",
    "data": {
        "linear_x": 0.5,
        "linear_y": 0.0,
        "angular_z": 0.1
    }
}

{
    "type": "ptz",
    "data": {
        "pan": 10.0,
        "tilt": -5.0,
        "zoom": 2.0
    }
}

{
    "type": "arm_action",
    "data": {
        "action": "preset_1"
    }
}

{
    "type": "estop",
    "data": {}
}
```

### 7.3 状态反馈 (S→C)

```json
{
    "type": "telemetry",
    "data": {
        "pos_x": 12.5,
        "pos_y": 8.3,
        "heading": 45.0,
        "speed": 0.5,
        "battery": 78,
        "latency_ms": 35
    },
    "timestamp": 1709539200000
}
```

---

## 8. gRPC 服务接口（关键服务示例）

### 8.1 设备服务

```protobuf
syntax = "proto3";
package vista.device.v1;

service DeviceService {
    rpc GetRobot(GetRobotRequest) returns (Robot);
    rpc ListRobots(ListRobotsRequest) returns (ListRobotsResponse);
    rpc UpdateRobotStatus(UpdateRobotStatusRequest) returns (Empty);
    rpc SendCommand(SendCommandRequest) returns (SendCommandResponse);
    rpc GetRobotTelemetry(GetTelemetryRequest) returns (stream TelemetryData);
}

message Robot {
    int64 id = 1;
    string serial_number = 2;
    string name = 3;
    string status = 4;
    int64 site_id = 5;
    Position position = 6;
    int32 battery_level = 7;
    string run_mode = 8;
}

message Position {
    double x = 1;
    double y = 2;
    double z = 3;
    double heading = 4;
}
```

### 8.2 任务服务

```protobuf
syntax = "proto3";
package vista.task.v1;

service TaskService {
    rpc CreateTask(CreateTaskRequest) returns (Task);
    rpc GetTask(GetTaskRequest) returns (Task);
    rpc ListTasks(ListTasksRequest) returns (ListTasksResponse);
    rpc StartTask(StartTaskRequest) returns (TaskExecution);
    rpc PauseTask(PauseTaskRequest) returns (Empty);
    rpc ResumeTask(ResumeTaskRequest) returns (Empty);
    rpc CancelTask(CancelTaskRequest) returns (Empty);
    rpc GetExecution(GetExecutionRequest) returns (TaskExecution);
}
```

### 8.3 告警服务

```protobuf
syntax = "proto3";
package vista.alarm.v1;

service AlarmService {
    rpc ReportAlarm(ReportAlarmRequest) returns (Alarm);
    rpc ListAlarms(ListAlarmsRequest) returns (ListAlarmsResponse);
    rpc AcknowledgeAlarm(AcknowledgeRequest) returns (Empty);
    rpc ResolveAlarm(ResolveRequest) returns (Empty);
    rpc GetAlarmStats(AlarmStatsRequest) returns (AlarmStatsResponse);
}
```

---

## 9. MQTT 接口规范

### 9.1 机器人状态上报

**Topic**: `vista/robot/{robot_id}/status`
**QoS**: 1
**频率**: 1 Hz

```json
{
    "robot_id": "R001",
    "timestamp": 1709539200000,
    "status": "online",
    "battery_level": 78,
    "run_mode": "autonomous",
    "network_rssi": -45,
    "current_task_id": "T123",
    "error_code": 0
}
```

### 9.2 位置遥测

**Topic**: `vista/robot/{robot_id}/telemetry`
**QoS**: 0
**频率**: 10 Hz

```json
{
    "ts": 1709539200123,
    "pos": [12.5, 8.3, 0.0],
    "heading": 45.0,
    "vel": [0.5, 0.0, 0.1],
    "imu": { "roll": 0.1, "pitch": -0.2, "yaw": 45.0 }
}
```

### 9.3 指令下发

**Topic**: `vista/robot/{robot_id}/cmd/move`
**QoS**: 1

```json
{
    "cmd_id": "uuid",
    "type": "navigate",
    "target": { "x": 15.0, "y": 20.0, "heading": 90.0 },
    "speed": 0.8,
    "timestamp": 1709539200000
}
```

### 9.4 遗嘱消息（LWT）

**Topic**: `vista/robot/{robot_id}/status`
**QoS**: 1
**Retain**: true

```json
{
    "robot_id": "R001",
    "timestamp": 0,
    "status": "offline",
    "reason": "unexpected_disconnect"
}
```

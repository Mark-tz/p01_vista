# 智能巡检调度系统 — 数据库设计

> 版本：v0.1.0-draft
> 日期：2026-03-04

---

## 1. 存储架构总览

| 存储引擎 | 数据库/实例 | 存储内容 |
|----------|------------|----------|
| PostgreSQL 16 | `vista_iam` | 用户、角色、权限、审计日志 |
| PostgreSQL 16 | `vista_core` | 设备、地图、任务、告警、工单 |
| InfluxDB 3.x | `vista_tsdb` | 传感器时序数据、设备指标 |
| Redis 7.x | — | 会话、缓存、实时状态、分布式锁 |
| MinIO | `vista-media` | 地图文件、图片、视频、固件包 |

---

## 2. PostgreSQL — vista_iam（用户与权限）

### 2.1 ER 关系

```
┌──────────┐     N:M     ┌──────────┐     N:M     ┌────────────┐
│  users   │◄───────────►│user_roles│◄───────────►│   roles    │
└──────────┘             └──────────┘             └──────┬─────┘
                                                        │ N:M
                                                  ┌─────▼──────┐
                                                  │role_perms  │
                                                  └─────┬──────┘
                                                        │ N:M
                                                  ┌─────▼──────┐
                                                  │permissions │
                                                  └────────────┘

┌──────────────┐
│ audit_logs   │  ← 操作审计日志
└──────────────┘
```

### 2.2 表结构

#### users — 用户表

```sql
CREATE TABLE users (
    id          BIGSERIAL PRIMARY KEY,
    username    VARCHAR(64)  NOT NULL UNIQUE,
    password    VARCHAR(256) NOT NULL,          -- bcrypt hash
    real_name   VARCHAR(64),
    email       VARCHAR(128),
    phone       VARCHAR(20),
    avatar_url  VARCHAR(512),
    status      SMALLINT     NOT NULL DEFAULT 1, -- 1=active, 0=disabled
    last_login  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ                      -- 软删除
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_status ON users(status) WHERE deleted_at IS NULL;
```

#### roles — 角色表

```sql
CREATE TABLE roles (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(64) NOT NULL UNIQUE,    -- super_admin, admin, operator, viewer
    label       VARCHAR(64) NOT NULL,           -- 显示名称
    description TEXT,
    is_builtin  BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### permissions — 权限表

```sql
CREATE TABLE permissions (
    id          BIGSERIAL PRIMARY KEY,
    resource    VARCHAR(64) NOT NULL,           -- task, robot, alarm, system...
    action      VARCHAR(64) NOT NULL,           -- create, read, update, delete, execute...
    description TEXT,
    UNIQUE(resource, action)
);
```

#### user_roles / role_permissions — 关联表

```sql
CREATE TABLE user_roles (
    user_id BIGINT NOT NULL REFERENCES users(id),
    role_id BIGINT NOT NULL REFERENCES roles(id),
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE role_permissions (
    role_id       BIGINT NOT NULL REFERENCES roles(id),
    permission_id BIGINT NOT NULL REFERENCES permissions(id),
    PRIMARY KEY (role_id, permission_id)
);
```

#### audit_logs — 审计日志表

```sql
CREATE TABLE audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT,
    username    VARCHAR(64),
    action      VARCHAR(32)  NOT NULL,          -- CREATE, UPDATE, DELETE, LOGIN, LOGOUT...
    resource    VARCHAR(64)  NOT NULL,
    resource_id VARCHAR(64),
    detail      JSONB,                          -- 操作详情
    ip          VARCHAR(45),
    user_agent  VARCHAR(512),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id, created_at);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource, resource_id, created_at);
CREATE INDEX idx_audit_logs_time ON audit_logs(created_at);
```

---

## 3. PostgreSQL — vista_core（核心业务）

### 3.1 ER 关系总览

```
┌──────────┐  1:N  ┌───────────┐  1:N  ┌────────────────┐
│  sites   │◄─────►│  floors   │◄─────►│  maps          │
└──────────┘       └───────────┘       └────────────────┘
     │ 1:N              │ 1:N
     │                  │
┌────▼──────┐     ┌────▼──────────┐
│  robots   │     │inspect_points │
└────┬──────┘     └────┬──────────┘
     │                 │
     │ 1:N        N:M (通过 task_waypoints)
     │                 │
┌────▼──────┐     ┌────▼──────┐
│robot_logs │     │   tasks   │
└───────────┘     └────┬──────┘
                       │ 1:N
                  ┌────▼──────────┐
                  │task_executions│
                  └────┬──────────┘
                       │ 1:N
                  ┌────▼──────────────┐
                  │execution_results  │
                  └───────────────────┘

┌──────────┐  1:N  ┌───────────────┐
│  alarms  │◄─────►│alarm_histories│
└──────────┘       └───────────────┘
```

### 3.2 场站与地图

#### sites — 场站表

```sql
CREATE TABLE sites (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    code        VARCHAR(32)  NOT NULL UNIQUE,
    address     TEXT,
    longitude   DOUBLE PRECISION,
    latitude    DOUBLE PRECISION,
    status      SMALLINT     NOT NULL DEFAULT 1,
    config      JSONB        DEFAULT '{}',       -- 场站级配置参数
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);
```

#### floors — 楼层表

```sql
CREATE TABLE floors (
    id          BIGSERIAL PRIMARY KEY,
    site_id     BIGINT       NOT NULL REFERENCES sites(id),
    name        VARCHAR(64)  NOT NULL,
    floor_num   INTEGER      NOT NULL,           -- 楼层编号，支持负数
    elevation   DOUBLE PRECISION,                -- 海拔高度 (m)
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE(site_id, floor_num)
);
```

#### maps — 地图表

```sql
CREATE TABLE maps (
    id            BIGSERIAL PRIMARY KEY,
    floor_id      BIGINT       NOT NULL REFERENCES floors(id),
    name          VARCHAR(128) NOT NULL,
    version       INTEGER      NOT NULL DEFAULT 1,
    map_type      VARCHAR(16)  NOT NULL,          -- 2d_grid, 2d_image, 3d_model
    file_url      VARCHAR(512) NOT NULL,           -- MinIO 地图文件 URL
    origin_x      DOUBLE PRECISION NOT NULL DEFAULT 0, -- 地图原点 X
    origin_y      DOUBLE PRECISION NOT NULL DEFAULT 0, -- 地图原点 Y
    resolution    DOUBLE PRECISION,                -- 栅格分辨率 (m/pixel)
    width         INTEGER,
    height        INTEGER,
    metadata      JSONB        DEFAULT '{}',
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_maps_floor ON maps(floor_id, is_active);
```

#### geo_fences — 电子围栏表

```sql
CREATE TABLE geo_fences (
    id          BIGSERIAL PRIMARY KEY,
    floor_id    BIGINT       NOT NULL REFERENCES floors(id),
    name        VARCHAR(128) NOT NULL,
    fence_type  VARCHAR(16)  NOT NULL,            -- no_go, slow_down, alert_zone
    geometry    JSONB        NOT NULL,             -- GeoJSON Polygon
    params      JSONB        DEFAULT '{}',         -- 速度限制等参数
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### 3.3 巡检点与路线

#### inspect_points — 巡检点表

```sql
CREATE TABLE inspect_points (
    id            BIGSERIAL PRIMARY KEY,
    floor_id      BIGINT       NOT NULL REFERENCES floors(id),
    name          VARCHAR(128) NOT NULL,
    code          VARCHAR(32)  NOT NULL,
    pos_x         DOUBLE PRECISION NOT NULL,
    pos_y         DOUBLE PRECISION NOT NULL,
    pos_z         DOUBLE PRECISION DEFAULT 0,
    heading       DOUBLE PRECISION DEFAULT 0,      -- 朝向角度 (degree)
    action_type   VARCHAR(32)  NOT NULL,            -- photo, detect, operate, composite
    action_config JSONB        DEFAULT '{}',        -- 动作参数（拍照角度、检测类型等）
    dwell_time    INTEGER      NOT NULL DEFAULT 5,  -- 停留时间 (秒)
    description   TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ,
    UNIQUE(floor_id, code)
);

CREATE INDEX idx_inspect_points_floor ON inspect_points(floor_id) WHERE deleted_at IS NULL;
```

#### inspect_routes — 巡检路线表

```sql
CREATE TABLE inspect_routes (
    id          BIGSERIAL PRIMARY KEY,
    site_id     BIGINT       NOT NULL REFERENCES sites(id),
    name        VARCHAR(128) NOT NULL,
    description TEXT,
    route_type  VARCHAR(16)  NOT NULL DEFAULT 'single_floor', -- single_floor, multi_floor
    config      JSONB        DEFAULT '{}',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);

CREATE TABLE route_waypoints (
    id              BIGSERIAL PRIMARY KEY,
    route_id        BIGINT  NOT NULL REFERENCES inspect_routes(id),
    inspect_point_id BIGINT NOT NULL REFERENCES inspect_points(id),
    seq_order       INTEGER NOT NULL,
    UNIQUE(route_id, seq_order)
);
```

### 3.4 设备管理

#### robots — 机器人表

```sql
CREATE TABLE robots (
    id              BIGSERIAL PRIMARY KEY,
    site_id         BIGINT       REFERENCES sites(id),
    name            VARCHAR(128) NOT NULL,
    serial_number   VARCHAR(64)  NOT NULL UNIQUE,
    model           VARCHAR(64),                    -- 机器人型号
    robot_type      VARCHAR(32)  NOT NULL DEFAULT 'quadruped',
    status          VARCHAR(16)  NOT NULL DEFAULT 'offline',
    -- online, offline, charging, error, maintenance
    current_floor_id BIGINT      REFERENCES floors(id),
    pos_x           DOUBLE PRECISION,
    pos_y           DOUBLE PRECISION,
    heading         DOUBLE PRECISION,
    battery_level   SMALLINT,                       -- 0-100
    network_quality SMALLINT,                       -- 0-100
    run_mode        VARCHAR(16)  DEFAULT 'idle',    -- idle, autonomous, manual, returning
    firmware_ver    VARCHAR(32),
    software_ver    VARCHAR(32),
    config          JSONB        DEFAULT '{}',
    last_heartbeat  TIMESTAMPTZ,
    registered_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_robots_site ON robots(site_id);
CREATE INDEX idx_robots_status ON robots(status);
CREATE INDEX idx_robots_serial ON robots(serial_number);
```

#### charging_stations — 充电桩表

```sql
CREATE TABLE charging_stations (
    id          BIGSERIAL PRIMARY KEY,
    floor_id    BIGINT       NOT NULL REFERENCES floors(id),
    name        VARCHAR(128) NOT NULL,
    pos_x       DOUBLE PRECISION NOT NULL,
    pos_y       DOUBLE PRECISION NOT NULL,
    heading     DOUBLE PRECISION NOT NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'idle', -- idle, charging, fault
    robot_id    BIGINT       REFERENCES robots(id),   -- 当前使用的机器人
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### 3.5 任务管理

#### tasks — 任务表

```sql
CREATE TABLE tasks (
    id            BIGSERIAL PRIMARY KEY,
    site_id       BIGINT       NOT NULL REFERENCES sites(id),
    name          VARCHAR(256) NOT NULL,
    task_type     VARCHAR(16)  NOT NULL,            -- once, scheduled, triggered
    route_id      BIGINT       REFERENCES inspect_routes(id),
    robot_id      BIGINT       REFERENCES robots(id), -- 指定机器人 (可为空=自动分配)
    priority      SMALLINT     NOT NULL DEFAULT 5,  -- 1(最高) - 10(最低)
    schedule_config JSONB,                          -- cron 表达式 / 触发条件
    status        VARCHAR(16)  NOT NULL DEFAULT 'created',
    -- created, pending, assigned, executing, paused, completed, failed, canceled
    config        JSONB        DEFAULT '{}',        -- 任务级参数覆盖
    created_by    BIGINT       NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_site_status ON tasks(site_id, status);
CREATE INDEX idx_tasks_schedule ON tasks(task_type, status)
    WHERE task_type IN ('scheduled', 'triggered') AND status = 'pending';
```

#### task_executions — 任务执行记录表

```sql
CREATE TABLE task_executions (
    id            BIGSERIAL PRIMARY KEY,
    task_id       BIGINT       NOT NULL REFERENCES tasks(id),
    robot_id      BIGINT       NOT NULL REFERENCES robots(id),
    status        VARCHAR(16)  NOT NULL DEFAULT 'running',
    -- running, paused, completed, failed, canceled
    started_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMPTZ,
    progress      SMALLINT     DEFAULT 0,           -- 0-100
    total_points  INTEGER      NOT NULL DEFAULT 0,
    done_points   INTEGER      NOT NULL DEFAULT 0,
    error_msg     TEXT,
    summary       JSONB        DEFAULT '{}',        -- 执行摘要统计
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_exec_task ON task_executions(task_id, started_at);
CREATE INDEX idx_task_exec_robot ON task_executions(robot_id, status);
```

#### execution_results — 执行结果表（每个巡检点的结果）

```sql
CREATE TABLE execution_results (
    id              BIGSERIAL PRIMARY KEY,
    execution_id    BIGINT      NOT NULL REFERENCES task_executions(id),
    inspect_point_id BIGINT     NOT NULL REFERENCES inspect_points(id),
    seq_order       INTEGER     NOT NULL,
    status          VARCHAR(16) NOT NULL,           -- success, failed, skipped
    arrived_at      TIMESTAMPTZ,
    left_at         TIMESTAMPTZ,
    action_result   JSONB       DEFAULT '{}',       -- 动作执行结果
    images          JSONB       DEFAULT '[]',       -- 抓拍图片 URL 列表
    ai_results      JSONB       DEFAULT '[]',       -- AI 识别结果列表
    sensor_snapshot JSONB       DEFAULT '{}',       -- 传感器数据快照
    error_msg       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exec_results_exec ON execution_results(execution_id, seq_order);
```

### 3.6 告警管理

#### alarms — 告警表

```sql
CREATE TABLE alarms (
    id            BIGSERIAL PRIMARY KEY,
    site_id       BIGINT       NOT NULL REFERENCES sites(id),
    alarm_type    VARCHAR(32)  NOT NULL,             -- device, environment, ai, task
    alarm_source  VARCHAR(64)  NOT NULL,             -- 告警来源标识
    source_id     VARCHAR(64),                       -- 来源对象 ID
    level         SMALLINT     NOT NULL,             -- 1=紧急, 2=重要, 3=一般, 4=提示
    title         VARCHAR(256) NOT NULL,
    content       TEXT,
    status        VARCHAR(16)  NOT NULL DEFAULT 'open',
    -- open, acknowledged, resolved, closed
    acknowledged_by BIGINT,
    acknowledged_at TIMESTAMPTZ,
    resolved_at   TIMESTAMPTZ,
    metadata      JSONB        DEFAULT '{}',         -- 附加数据 (阈值、实际值等)
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alarms_site_status ON alarms(site_id, status, level);
CREATE INDEX idx_alarms_type ON alarms(alarm_type, created_at);
CREATE INDEX idx_alarms_time ON alarms(created_at);
```

#### alarm_rules — 告警规则表

```sql
CREATE TABLE alarm_rules (
    id            BIGSERIAL PRIMARY KEY,
    site_id       BIGINT       REFERENCES sites(id), -- NULL = 全局规则
    name          VARCHAR(128) NOT NULL,
    alarm_type    VARCHAR(32)  NOT NULL,
    condition     JSONB        NOT NULL,              -- 规则条件表达式
    level         SMALLINT     NOT NULL,
    merge_window  INTEGER      DEFAULT 300,           -- 合并窗口 (秒)
    cooldown      INTEGER      DEFAULT 60,            -- 冷却时间 (秒)
    notify_config JSONB        DEFAULT '{}',          -- 通知方式配置
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

#### alarm_histories — 告警处理历史

```sql
CREATE TABLE alarm_histories (
    id          BIGSERIAL PRIMARY KEY,
    alarm_id    BIGINT       NOT NULL REFERENCES alarms(id),
    action      VARCHAR(32)  NOT NULL,               -- created, acknowledged, assigned,
                                                     -- commented, resolved, closed
    operator_id BIGINT,
    comment     TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alarm_hist_alarm ON alarm_histories(alarm_id, created_at);
```

### 3.7 AI 识别结果

#### ai_recognition_records — AI 识别记录表

```sql
CREATE TABLE ai_recognition_records (
    id              BIGSERIAL PRIMARY KEY,
    execution_id    BIGINT       REFERENCES task_executions(id),
    inspect_point_id BIGINT      REFERENCES inspect_points(id),
    robot_id        BIGINT       NOT NULL REFERENCES robots(id),
    recognition_type VARCHAR(32) NOT NULL,           -- meter_read, anomaly, object_detect
    image_url       VARCHAR(512) NOT NULL,
    result          JSONB        NOT NULL,            -- 识别结果
    confidence      DOUBLE PRECISION,                 -- 置信度
    is_anomaly      BOOLEAN      NOT NULL DEFAULT FALSE,
    reviewed        BOOLEAN      NOT NULL DEFAULT FALSE,
    reviewed_by     BIGINT,
    review_result   JSONB,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_records_exec ON ai_recognition_records(execution_id);
CREATE INDEX idx_ai_records_anomaly ON ai_recognition_records(is_anomaly, created_at)
    WHERE is_anomaly = TRUE;
```

---

## 4. InfluxDB — vista_tsdb（时序数据）

### 4.1 Measurement 设计

#### robot_telemetry — 机器人遥测

```
Measurement: robot_telemetry
Tags:
  - robot_id     (string)   机器人 ID
  - site_id      (string)   场站 ID
  - metric_type  (string)   position, battery, network, imu

Fields (根据 metric_type):
  position:
    - pos_x        (float)
    - pos_y        (float)
    - pos_z        (float)
    - heading      (float)
    - speed        (float)

  battery:
    - level        (integer)  0-100
    - voltage      (float)    V
    - current      (float)    A
    - temperature  (float)    °C

  network:
    - rssi         (integer)  dBm
    - latency      (integer)  ms
    - packet_loss  (float)    %
```

#### sensor_data — 传感器数据

```
Measurement: sensor_data
Tags:
  - robot_id         (string)
  - site_id          (string)
  - sensor_type      (string)   temperature, humidity, gas, vibration
  - inspect_point_id (string)

Fields:
  temperature:
    - value     (float)    °C

  humidity:
    - value     (float)    %RH

  gas:
    - co        (float)    ppm
    - h2s       (float)    ppm
    - ch4       (float)    %LEL
    - o2        (float)    %VOL

  vibration:
    - x_acc     (float)    m/s²
    - y_acc     (float)    m/s²
    - z_acc     (float)    m/s²
    - rms       (float)    m/s²
```

### 4.2 数据保留策略

| 精度 | 保留周期 | 说明 |
|------|----------|------|
| 原始数据 | 7 天 | 全精度，用于实时监控 |
| 1 分钟聚合 | 90 天 | 均值/最大/最小，用于趋势分析 |
| 1 小时聚合 | 1 年 | 用于长期报表 |
| 1 天聚合 | 永久 | 用于历史统计 |

---

## 5. Redis 数据结构设计

| Key 模式 | 类型 | TTL | 用途 |
|----------|------|-----|------|
| `session:{token}` | String (JSON) | 24h | 用户会话信息 |
| `robot:status:{id}` | Hash | 60s | 机器人实时状态缓存 |
| `robot:pos:{id}` | String (JSON) | 5s | 机器人最新位置 |
| `task:lock:{task_id}` | String | 30s | 任务调度分布式锁 |
| `alarm:dedup:{hash}` | String | 5min | 告警去重窗口 |
| `rate:{user_id}:{api}` | String (counter) | 1min | API 限流计数器 |
| `ws:room:{site}:{floor}` | Set | — | WebSocket 房间成员 |
| `config:global` | Hash | 5min | 全局配置缓存 |

---

## 6. MinIO 存储桶设计

| 桶名称 | 用途 | 生命周期 |
|--------|------|----------|
| `vista-maps` | 地图文件（栅格图、3D 模型） | 永久 |
| `vista-images` | 巡检抓拍图片 | 热 7 天 → 温 90 天 → 删除 |
| `vista-videos` | 视频录像 | 热 7 天 → 温 30 天 → 删除 |
| `vista-firmware` | 固件/软件包 | 保留最近 10 个版本 |
| `vista-reports` | 生成的报表 PDF | 365 天 |
| `vista-exports` | 临时导出文件 | 24 小时自动清理 |

### 对象命名规范

```
vista-images/
├── {site_id}/
│   └── {date}/
│       └── {execution_id}/
│           └── {point_code}_{timestamp}_{seq}.jpg

vista-videos/
├── {site_id}/
│   └── {date}/
│       └── {robot_id}/
│           └── {start_time}_{duration}.mp4
```

---

## 7. 数据库迁移策略

- 使用 `golang-migrate` 管理 PostgreSQL Schema 变更
- 迁移文件命名：`{version}_{description}.up.sql` / `{version}_{description}.down.sql`
- 每次变更必须包含 up 和 down 脚本
- 生产环境变更需 DBA 审核，禁止 `DROP TABLE` / `TRUNCATE`
- 大表结构变更使用 `pg_repack` 或在线 DDL 工具

```
migrations/
├── 000001_create_iam_tables.up.sql
├── 000001_create_iam_tables.down.sql
├── 000002_create_site_tables.up.sql
├── 000002_create_site_tables.down.sql
├── 000003_create_device_tables.up.sql
├── ...
```

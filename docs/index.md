---
hide:
  - navigation
---

# VISTA 智能巡检调度系统

<div style="text-align:center;margin:40px 0 20px 0;">
<span style="font-size:1.4em;font-weight:600;color:#3f51b5;">Visual Intelligent Surveillance & Task Automation</span>
</div>

---

**VISTA** 是面向工业场景的 **四足机器人智能巡检调度平台**，提供从任务编排、自主巡检、实时监控、远程操控到数据分析的全链路闭环能力。

<div class="grid cards" markdown>

-   :material-sitemap:{ .lg .middle } **架构设计**

    ---

    系统架构总览、技术选型、部署方案

    [:octicons-arrow-right-24: 系统架构总览](01-architecture-overview.md)

-   :material-cog:{ .lg .middle } **详细设计**

    ---

    模块设计、数据库设计、接口规范

    [:octicons-arrow-right-24: 模块详细设计](03-module-design.md)

-   :material-calendar-check:{ .lg .middle } **项目管理**

    ---

    任务分解、Sprint 计划、协作规范

    [:octicons-arrow-right-24: 开发任务分解](08-development-tasks.md)

-   :material-shield-check:{ .lg .middle } **质量与运维**

    ---

    性能、安全、可用性、测试策略

    [:octicons-arrow-right-24: 非功能性需求](07-non-functional-requirements.md)

</div>

---

## 核心能力

| 能力 | 说明 |
|------|------|
| :material-map-marker-path: **智能巡检** | 多楼层自主导航、定时/条件触发、多机协同调度 |
| :material-monitor-eye: **实时监控** | 2D/3D 地图可视化、实时位姿跟踪、视频流 |
| :material-gamepad-variant: **远程操控** | 键盘/手柄控制、云台操作、机械臂远程操作 |
| :material-brain: **AI 识别** | 仪表读数、异常检测、智能告警 |
| :material-bell-alert: **告警中心** | 多级告警、规则引擎、闭环管理 |
| :material-chart-box: **数据中心** | 传感器数据、巡检报表、趋势分析 |

## 文档版本

!!! info "当前版本"
    - **版本号**：v0.1.0-draft
    - **状态**：架构设计阶段
    - 本文档使用 AI 辅助生成，经过人工审核
    - 技术选型为初步方案，可根据实际需求调整

## 快速导航

- **我是架构师** → 从 [系统架构总览](01-architecture-overview.md) 开始
- **我是开发者** → 从 [开发任务分解](08-development-tasks.md) 找到你的任务
- **我是项目经理** → 从 [Sprint 迭代计划](09-sprint-plan.md) 了解排期
- **我是运维** → 从 [部署架构](06-deployment-architecture.md) 了解部署方案

# Harness 中间件系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 4 层 Harness 中间件系统（Context Injector / Permission Manager / Progress Writer / Verification Runner）并集成到现有 NL→commands 管道。

**Architecture:** 在 `src/lib/harness/` 下创建 7 个独立模块文件 + 1 个前端确认弹窗组件 + 1 个 Rust 后端命令模块。每个中间件可独立测试。主 Pipeline 通过 `harnessPipeline.ts` 编排，从 `useAiSubmit.ts` 调用入口。

**Tech Stack:** TypeScript 5.8 + React 19.1 + Zustand 5.0 + Rust 2021 + Tauri v2

---

### Task 1: 创建共享类型定义

**Files:** Create `src/lib/harness/types.ts`

- [ ] 定义所有共享 TypeScript 类型和接口

### Task 2: 创建默认规则集和模板

**Files:** Create `src/lib/harness/defaults.ts`

- [ ] 定义 alwaysDeny / alwaysAllow / alwaysAsk 规则集
- [ ] 定义默认 HarnessConfig
- [ ] 定义默认 AGENTS.md 模板

### Task 3: 实现 Context Injector

**Files:** Create `src/lib/harness/contextInjector.ts`

- [ ] 实现 AGENTS.md 读取/缓存/默认模板创建
- [ ] 实现 System Prompt 组装（AGENTS.md + 原有提示词 + PROGRESS.md 摘要）

### Task 4: 实现 Permission Manager

**Files:** Create `src/lib/harness/permissionManager.ts`

- [ ] 实现规则引擎（deny > allow > ask 三级匹配）
- [ ] 实现审计日志记录

### Task 5: 实现 Progress Writer

**Files:** Create `src/lib/harness/progressWriter.ts`

- [ ] 实现 PROGRESS.md 读写
- [ ] 实现长任务判断 + 进度快照生成

### Task 6: 实现 Verification Runner

**Files:** Create `src/lib/harness/verificationRunner.ts`

- [ ] 实现验收命令执行 + 退出码检查
- [ ] 实现失败回传 AI 重试循环

### Task 7: 实现主 Pipeline 编排器

**Files:** Create `src/lib/harness/harnessPipeline.ts`

- [ ] 实现 5 阶段 Pipeline 编排
- [ ] 导出统一入口函数

### Task 8: 实现权限确认弹窗

**Files:** Create `src/components/ConfirmDialog.tsx`

- [ ] 实现 CommandStep 确认弹窗 UI
- [ ] 支持"拒绝"/"允许本次"/"全部允许"三种操作

### Task 9: 实现 Rust 后端命令

**Files:** Create `src-tauri/src/harness_commands.rs`

- [ ] 实现 read_agents_md / write_progress_md / read_progress_md / run_verify_cmd

### Task 10: 注册 Rust 模块

**Files:** Modify `src-tauri/src/lib.rs`, `src-tauri/src/main.rs`

- [ ] 在 lib.rs 中声明 harness_commands 模块
- [ ] 在 main.rs 中注册新命令

### Task 11: 集成到 useAiSubmit

**Files:** Modify `src/hooks/useAiSubmit.ts`

- [ ] 将 submitAiQuery 迁移到调用 harnessPipeline
- [ ] 集成 ConfirmDialog 状态管理

### Task 12: 编写默认 AGENTS.md 模板

**Files:** Create `AGENTS.md` (项目根目录)

- [ ] 包含项目技术栈、代码规范、验收命令的定义

### Task 13: 更新 SettingsModal

**Files:** Modify `src/components/SettingsModal.tsx`, `src/stores/settingsStore.ts`

- [ ] 新增 Harness 规则配置 Tab
- [ ] 支持自定义 alwaysDeny / alwaysAsk 规则

---

**Phase 1 完成标准:**
- [ ] `npx tsc --noEmit` 通过
- [ ] `cargo check` 通过
- [ ] 默认 AGENTS.md 存在于项目根目录
- [ ] 所有 7 个 harness 模块独立可导入

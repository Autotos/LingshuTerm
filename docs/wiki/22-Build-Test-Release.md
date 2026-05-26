# 22 — 构建、测试与发布

## 开发环境

### 系统要求

| 平台 | 要求 |
|------|------|
| Windows | Visual Studio Build Tools (C++ workload) + Windows 10+ |
| macOS | Xcode Command Line Tools + macOS 12+ |
| Linux | `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev` |

### 运行时依赖

- Node.js >= 18
- Rust >= 1.80 (via `rustup`)
- npm >= 9

## 构建命令

```bash
# 安装依赖
npm install

# 前端开发服务器 (HMR, localhost:1420)
npm run dev

# Tauri 开发模式 (前端 HMR + Rust 热编译)
npm run tauri:dev

# TypeScript 类型检查
npx tsc --noEmit

# Rust 类型检查
cd src-tauri && cargo check

# 生产构建 (生成 .msi / .dmg / .deb)
npm run tauri:build
```

## 构建产物

| 平台 | 产物 |
|------|------|
| Windows | `src-tauri/target/release/bundle/msi/LingshuTerm2_3.x.x_x64.msi` |
| macOS | `src-tauri/target/release/bundle/dmg/LingshuTerm2_3.x.x_x64.dmg` |
| Linux | `src-tauri/target/release/bundle/deb/lingshu-term2_3.x.x_amd64.deb` |

### Tauri 构建配置 ([tauri.conf.json](../src-tauri/tauri.conf.json))

```json
{
  "productName": "LingshuTerm2",
  "version": "3.4.0",
  "identifier": "com.lingshu.term2",
  "bundle": {
    "active": true,
    "targets": "msi"
  }
}
```

## 测试

### 前端测试

```bash
# 运行所有测试
npx vitest run

# Watch 模式
npx vitest

# 运行特定文件
npx vitest run src/lib/__tests__/aiService.test.ts

# 覆盖率报告
npx vitest run --coverage
```

**测试文件清单**：

| 测试文件 | 覆盖模块 |
|---------|---------|
| [aiService.test.ts](../src/lib/__tests__/aiService.test.ts) | AI API 客户端 |
| [aiDetect.test.ts](../src/lib/__tests__/aiDetect.test.ts) | 输入类型检测 |
| [ansi.test.ts](../src/lib/__tests__/ansi.test.ts) | ANSI 转义序列解析 |
| [outputDispatch.test.ts](../src/lib/__tests__/outputDispatch.test.ts) | 输出类型调度 |
| [sessionUtils.test.ts](../src/lib/__tests__/sessionUtils.test.ts) | Session ID 路由 |
| [terminalAction.test.ts](../src/lib/__tests__/terminalAction.test.ts) | 终端创建动作解析 |
| [connectionStore.test.ts](../src/stores/__tests__/connectionStore.test.ts) | 连接 Store |
| [connection.test.ts](../src/models/__tests__/connection.test.ts) | 连接模型 |

**测试环境**：Vitest 4.1 + jsdom + @testing-library/react 16.3

### Rust 测试

```bash
# 运行所有 Rust 测试
cd src-tauri && cargo test

# 运行特定模块
cargo test connection    # connection.rs 中的测试
cargo test block         # block.rs 中的测试
cargo test harness       # harness_commands.rs 中的测试
```

**测试覆盖模块**：
- `connection.rs` — SSH 连接、Telnet IAC 协商、Session ID 格式、序列化
- `block.rs` — 命令包装、退出码计算
- `harness_commands.rs` — 文件路径生成、路径消毒

## 版本号管理

版本号遵循 SemVer，需在三个文件中同步更新：

| 文件 | 字段 | 当前版本 |
|------|------|---------|
| [package.json](../package.json) | `version` | 3.4.0 |
| [tauri.conf.json](../src-tauri/tauri.conf.json) | `version` | 3.4.0 |
| [Cargo.toml](../src-tauri/Cargo.toml) | `version` | 3.4.0 |

## 发布流程

```bash
# 1. 更新版本号 (package.json, tauri.conf.json, Cargo.toml)
# 2. TypeScript 类型检查通过
npx tsc --noEmit

# 3. Rust 编译通过
cd src-tauri && cargo check

# 4. 运行测试
npx vitest run && cargo test

# 5. 构建发布包
npm run tauri:build

# 6. 提交并推送
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "chore: bump version to x.y.z"
git push origin main

# 7. 创建 GitHub Release (需要安装 gh CLI)
gh release create vx.y.z --title "vx.y.z - Release Title" --notes "Release notes..."
```

## CI/CD 建议

```yaml
# .github/workflows/build.yml (建议模板)
name: Build and Test
on: [push, pull_request]
jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx vitest run

  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cd src-tauri && cargo check
      - run: cd src-tauri && cargo test
```

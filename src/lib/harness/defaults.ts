/**
 * Harness middleware — default configuration and rule sets.
 *
 * Provides sensible defaults for:
 *   1. Guard rules (alwaysDeny / alwaysAllow / alwaysAsk)
 *   2. HarnessConfig
 *   3. AGENTS.md template
 */

import type { GuardRule, HarnessConfig } from './types';

// ─── Default guard rules ─────────────────────────────────────────

const DENY_RULES: GuardRule[] = [
  { label: 'rm-rf-root', pattern: 'rm\\s+-rf\\s+/', action: 'deny', reason: '递归删除根目录' },
  { label: 'rm-rf-root-preserve', pattern: 'rm\\s+-rf\\s+--no-preserve-root\\s+/', action: 'deny', reason: '强制删除根目录' },
  { label: 'rm-rf-home', pattern: 'rm\\s+-rf\\s+~', action: 'deny', reason: '递归删除用户主目录' },
  { label: 'dd-overwrite', pattern: 'dd\\s+if=.*of=/dev/', action: 'deny', reason: '覆写磁盘设备' },
  { label: 'redirect-device', pattern: '>\\s*/dev/sd', action: 'deny', reason: '覆写磁盘设备' },
  { label: 'mkfs-format', pattern: 'mk(fs|e2fs)', action: 'deny', reason: '格式化磁盘' },
  { label: 'fork-bomb', pattern: ':\\(\\)\\{\\s*:\\|:&\\s*\\};:', action: 'deny', reason: 'Fork bomb 攻击' },
  { label: 'chmod-777-root', pattern: 'chmod\\s+-R\\s+777\\s+/', action: 'deny', reason: '全局权限开放' },
  { label: 'chmod-000-root', pattern: 'chmod\\s+-R\\s+000\\s+/', action: 'deny', reason: '全局权限锁定' },
  { label: 'chown-root', pattern: 'chown\\s+-R\\s+.*\\s+/', action: 'deny', reason: '递归变更根目录所有者' },
];

const ALLOW_RULES: GuardRule[] = [
  // Read-only / informational
  { label: 'ls', pattern: '^ls\\b', action: 'allow' },
  { label: 'cd', pattern: '^cd\\b', action: 'allow' },
  { label: 'pwd', pattern: '^pwd\\b', action: 'allow' },
  { label: 'cat', pattern: '^cat\\b', action: 'allow' },
  { label: 'head', pattern: '^head\\b', action: 'allow' },
  { label: 'tail', pattern: '^tail\\b', action: 'allow' },
  { label: 'echo', pattern: '^echo\\b', action: 'allow' },
  { label: 'grep', pattern: '^grep\\b', action: 'allow' },
  { label: 'find', pattern: '^find\\b', action: 'allow' },
  { label: 'which', pattern: '^which\\b', action: 'allow' },
  { label: 'whoami', pattern: '^whoami\\b', action: 'allow' },
  { label: 'date', pattern: '^date\\b', action: 'allow' },
  { label: 'uname', pattern: '^uname\\b', action: 'allow' },
  { label: 'wc', pattern: '^wc\\b', action: 'allow' },
  { label: 'sort', pattern: '^sort\\b', action: 'allow' },
  { label: 'uniq', pattern: '^uniq\\b', action: 'allow' },
  { label: 'cut', pattern: '^cut\\b', action: 'allow' },
  { label: 'tr', pattern: '^tr\\b', action: 'allow' },
  { label: 'awk', pattern: '^awk\\b', action: 'allow' },
  { label: 'sed', pattern: '^sed\\b', action: 'allow' },
  { label: 'du', pattern: '^du\\b', action: 'allow' },
  { label: 'df', pattern: '^df\\b', action: 'allow' },
  { label: 'free', pattern: '^free\\b', action: 'allow' },
  { label: 'ps', pattern: '^ps\\b', action: 'allow' },
  { label: 'top', pattern: '^top\\b', action: 'allow' },
  { label: 'uptime', pattern: '^uptime\\b', action: 'allow' },
  { label: 'ping', pattern: '^ping\\b', action: 'allow' },
  { label: 'curl', pattern: '^curl\\b', action: 'allow' },
  { label: 'wget', pattern: '^wget\\b', action: 'allow' },
  { label: 'nslookup', pattern: '^nslookup\\b', action: 'allow' },
  { label: 'dig', pattern: '^dig\\b', action: 'allow' },
  // Dev tool commands (safe)
  { label: 'npm-test', pattern: '^npm\\s+(test|run\\s+(test|build|lint))', action: 'allow' },
  { label: 'pnpm-test', pattern: '^pnpm\\s+(test|build|lint)', action: 'allow' },
  { label: 'yarn-test', pattern: '^yarn\\s+(test|build)$', action: 'allow' },
  { label: 'cargo-check', pattern: '^cargo\\s+(check|test|fmt|clippy)', action: 'allow' },
  { label: 'tsc-check', pattern: '^(npx\\s+)?tsc\\s+--noEmit', action: 'allow' },
  { label: 'vitest', pattern: '^(npx\\s+)?vitest\\s+run', action: 'allow' },
  { label: 'git-status', pattern: '^git\\s+(status|log|diff|branch)', action: 'allow' },
  // Package managers (check-only)
  { label: 'npm-list', pattern: '^npm\\s+(list|view|outdated)', action: 'allow' },
  { label: 'cargo-search', pattern: '^cargo\\s+search\\b', action: 'allow' },
];

const ASK_RULES: GuardRule[] = [
  { label: 'rm', pattern: '^rm\\b', action: 'ask', reason: '删除文件/目录操作' },
  { label: 'mv', pattern: '^mv\\b', action: 'ask', reason: '移动/重命名文件' },
  { label: 'cp-r', pattern: 'cp\\s+-[rR]', action: 'ask', reason: '递归复制目录' },
  { label: 'chmod', pattern: '^chmod\\b', action: 'ask', reason: '修改文件权限' },
  { label: 'chown', pattern: '^chown\\b', action: 'ask', reason: '修改文件所有者' },
  { label: 'kill', pattern: '^kill\\b', action: 'ask', reason: '终止进程' },
  { label: 'pkill', pattern: '^pkill\\b', action: 'ask', reason: '批量终止进程' },
  { label: 'systemctl', pattern: '^systemctl\\b', action: 'ask', reason: '系统服务管理' },
  { label: 'reboot', pattern: '^reboot\\b', action: 'ask', reason: '重启系统' },
  { label: 'shutdown', pattern: '^shutdown\\b', action: 'ask', reason: '关闭系统' },
  { label: 'npm-install', pattern: '^npm\\s+(install|uninstall|update)\\b', action: 'ask', reason: '安装/卸载 npm 包' },
  { label: 'pip-install', pattern: '^pip\\d*\\s+(install|uninstall)\\b', action: 'ask', reason: '安装/卸载 Python 包' },
  { label: 'docker', pattern: '^docker\\b', action: 'ask', reason: 'Docker 容器操作' },
  { label: 'git-push', pattern: '^git\\s+(push|commit|merge|rebase)', action: 'ask', reason: 'Git 写操作' },
  { label: 'npm-publish', pattern: '^npm\\s+publish\\b', action: 'ask', reason: '发布 npm 包' },
  { label: 'cargo-publish', pattern: '^cargo\\s+publish\\b', action: 'ask', reason: '发布 crate' },
];

// ─── Default HarnessConfig ───────────────────────────────────────

export const DEFAULT_HARNESS_CONFIG: HarnessConfig = {
  guardRules: [...DENY_RULES, ...ALLOW_RULES, ...ASK_RULES],
  agentsPath: 'AGENTS.md',
  progressPath: 'PROGRESS.md',
  maxVerifyRetries: 3,
  longTaskStepThreshold: 3,
  longTaskLengthThreshold: 500,
};

// ─── Default AGENTS.md template ──────────────────────────────────

export const DEFAULT_AGENTS_MD = `# AGENTS.md — LingshuTerm 项目规范

你是一位专业的终端运维助手，运行在 LingshuTerm 3.0 智能终端中。
你必须严格遵守本文件中的所有规范和约束。

## 技术栈

- **前端**: React 19.1 + TypeScript 5.8 + Tailwind CSS 3.4 + Zustand 5.0
- **后端**: Rust Edition 2021 + Tauri v2 + Tokio 1
- **终端**: xterm.js 5.5 + portable-pty 0.8
- **SSH**: russh 0.60 (ring 后端)
- **测试**: Vitest 4.1 (前端) + cargo test (Rust)

## 代码规范

1. 组件使用 PascalCase 命名，不使用 default export
2. Hook 使用 \`use\` 前缀
3. Store 使用 \`useXxxStore\` 导出
4. TypeScript 严格模式，禁止 \`any\` 类型（除非必要的回退）
5. 命令必须是可以直接执行的完整命令，不要使用占位符
6. 如果任务需要多个步骤，按执行顺序排列
7. 返回值必须只包含 JSON 数组，不包含解释文字或 Markdown
8. 如果用户的描述不明确，返回空数组 []

## 平台感知规则

**绝对不要同时为多个平台生成命令！** 系统提示词开头会告知你当前的操作系统。

1. 根据"当前操作系统"选择正确的命令语法：
   - **Windows** → PowerShell 或 CMD 命令
   - **macOS** → zsh/bash 命令（BSD 风格）
   - **Linux** → bash 命令（GNU 风格）
2. 如果查询类任务的第一步不确定环境，首先生成 \`uname -s\` 或 \`ver\` 来确认平台
3. 包管理器按平台选择：
   - Windows: \`winget\` 或 \`choco\`
   - macOS: \`brew\` 或系统内置命令
   - Debian/Ubuntu: \`apt\` / \`dpkg\`
   - RHEL/CentOS/Fedora: \`dnf\` / \`yum\` / \`rpm\`
   - Arch: \`pacman\`

## 安全禁区

以下命令绝对不允许执行：
- \`rm -rf /\` 及其变体
- \`dd if=... of=/dev/...\` 磁盘覆写
- \`mkfs\` / \`mke2fs\` 磁盘格式化
- \`chmod -R 777 /\` 全局权限变更
- Fork bomb \`:(){ :|:& };:\`
- 任何 \`> /dev/sda\` 直接写入设备

## 验收命令

任务完成后，自动执行以下验收命令：

\`\`\`bash
npm run build
npx tsc --noEmit
\`\`\`

\`\`\`bash
cargo check
\`\`\`

只有当所有验收命令退出码为 0 时，任务才算真正完成。
`;

export const DEFAULT_SOUL_MD = `## 性格设定

你是一位**简洁、高效、专业**的终端运维助手。

### 回答风格
- 回复**简洁直接**，避免冗长的解释
- 用事实和数据说话，不编造信息
- 遇到错误时冷静分析原因，给出可行的修复方案
- 主动提示潜在风险（如权限问题、磁盘空间不足）

### 语言偏好
- 默认使用**中文**回复
- 技术术语保留英文原名
- 命令和代码使用原始语言
`;

/** Predefined personality profiles available in settings. */
export const SOUL_PRESETS: Record<string, string> = {
  default: DEFAULT_SOUL_MD,

  steady: `## 性格设定
你是一位**沉稳严谨**的终端助手。
- 回复时先说"好的"或"收到"，确认理解后再行动
- 语气专业、克制，用词精准
- 遇到异常先排查原因，不猜测
- 示例："好的，请把完整统计内容发过来。" / "收到，请展示具体的统计数据。"`,

  casual: `## 性格设定
你是一位**轻松随和**的终端助手。
- 用"～"和轻松语气回复
- 像朋友聊天一样自然
- 示例："收到啦，快说说具体统计结果吧～" / "好嘞，我这边准备好了，直接讲就行。"`,

  terse: `## 性格设定
你是一位**干练利落**的终端助手。
- 回复极度精简，直奔主题
- 不讲废话，不加修饰
- 示例："请讲。" / "直接上报统计结果。"`,

  curious: `## 性格设定
你是一位**好奇活泼**的终端助手。
- 用"哇"、"终于"等带有情绪感的词语
- 对结果表现出期待
- 示例："哇，那快分享下详细统计情况！" / "终于整理完啦，我听听结果如何～"`,

  cool: `## 性格设定
你是一位**高冷简约**的终端助手。
- 回复极短，话少但到位
- 不使用语气词
- 示例："嗯，说吧。" / "知晓，继续。"`,

  gentle: `## 性格设定
你是一位**温柔耐心**的终端助手。
- 语气温柔，给人踏实感
- 先肯定再行动
- 示例："辛苦整理了，我认真看一下统计内容。" / "不着急，慢慢来。"`,

  funny: `## 性格设定
你是一位**幽默打趣**的终端助手。
- 用俏皮话和网络用语活跃气氛
- 但关键时刻依然认真执行
- 示例："坐等你的最终统计成果！" / "好家伙，整完了？速速呈上数据～"`,
};


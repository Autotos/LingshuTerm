import { describe, it, expect } from 'vitest';
import { detectTerminalCreateIntent, diagnosticTrace, parseLlmAction, actionToConnectionConfig } from '@/lib/terminalAction';
import type { TerminalCreateAction } from '@/lib/terminalAction';

// ─── detectTerminalCreateIntent ────────────────────────────────────

describe('detectTerminalCreateIntent - SSH', () => {
  it('detects "新建SSH终端，IP:10.168.1.127 User: cyl Passwd: Lidny520,."', () => {
    const result = detectTerminalCreateIntent('新建SSH终端，IP:10.168.1.127 User: cyl Passwd: Lidny520,.');
    expect(result).not.toBeNull();
    expect(result!.payload.protocol).toBe('ssh');
    expect(result!.payload.host).toBe('10.168.1.127');
    expect(result!.payload.username).toBe('cyl');
    expect(result!.payload.password).toBe('Lidny520,.');
    expect(result!.payload.port).toBe(22);
  });

  it('detects "SSH连接192.168.1.100 用户root 密码admin123 端口2222"', () => {
    const result = detectTerminalCreateIntent('SSH连接192.168.1.100 用户root 密码admin123 端口2222');
    expect(result).not.toBeNull();
    expect(result!.payload.protocol).toBe('ssh');
    expect(result!.payload.host).toBe('192.168.1.100');
    expect(result!.payload.username).toBe('root');
    expect(result!.payload.password).toBe('admin123');
    expect(result!.payload.port).toBe(2222);
  });

  it('detects "新建终端SSH连接10.168.1.127 用户：cyl, 密码：xxxxx"', () => {
    const result = detectTerminalCreateIntent('新建终端SSH连接10.168.1.127 用户：cyl, 密码：xxxxx');
    expect(result).not.toBeNull();
    expect(result!.payload.protocol).toBe('ssh');
    expect(result!.payload.host).toBe('10.168.1.127');
    expect(result!.payload.username).toBe('cyl');
    expect(result!.payload.password).toBe('xxxxx');
  });

  it('detects "打开远程SSH到192.168.1.1 user:admin pass:secret"', () => {
    const result = detectTerminalCreateIntent('打开远程SSH到192.168.1.1 user:admin pass:secret');
    expect(result).not.toBeNull();
    expect(result!.payload.protocol).toBe('ssh');
    expect(result!.payload.host).toBe('192.168.1.1');
    expect(result!.payload.username).toBe('admin');
    expect(result!.payload.password).toBe('secret');
  });

  it('detects user@host pattern: "ssh root@10.0.0.1 密码mypass"', () => {
    const result = detectTerminalCreateIntent('ssh root@10.0.0.1 密码mypass');
    expect(result).not.toBeNull();
    expect(result!.payload.host).toBe('10.0.0.1');
    expect(result!.payload.username).toBe('root');
    expect(result!.payload.password).toBe('mypass');
  });

  it('defaults username=root and port=22 when not specified', () => {
    const result = detectTerminalCreateIntent('SSH连接到10.0.0.1');
    expect(result).not.toBeNull();
    expect(result!.payload.host).toBe('10.0.0.1');
    expect(result!.payload.username).toBe('root');
    expect(result!.payload.port).toBe(22);
    expect(result!.payload.password).toBe('');
  });

  it('handles host label "Host: my.server.com"', () => {
    const result = detectTerminalCreateIntent('新建SSH Host: my.server.com 用户admin');
    expect(result).not.toBeNull();
    expect(result!.payload.host).toBe('my.server.com');
    expect(result!.payload.username).toBe('admin');
  });

  it('returns null when no host is present', () => {
    const result = detectTerminalCreateIntent('新建SSH连接 用户admin 密码123');
    expect(result).toBeNull();
  });

  it('returns null for non-SSH input', () => {
    const result = detectTerminalCreateIntent('查看当前目录文件');
    expect(result).toBeNull();
  });

  it('preserves password punctuation (passwords can contain any chars)', () => {
    const result = detectTerminalCreateIntent('ssh 10.0.0.1 Passwd: hello!,.');
    expect(result).not.toBeNull();
    expect(result!.payload.password).toBe('hello!,.');
  });
});

// ─── Telnet ────────────────────────────────────────────────────────

describe('detectTerminalCreateIntent - Telnet', () => {
  it('detects "新建Telnet连接192.168.1.1 端口23"', () => {
    const result = detectTerminalCreateIntent('新建Telnet连接192.168.1.1 端口23');
    expect(result).not.toBeNull();
    expect(result!.payload.protocol).toBe('telnet');
    expect(result!.payload.host).toBe('192.168.1.1');
    expect(result!.payload.port).toBe(23);
  });

  it('detects "telnet终端 host:10.0.0.1 port:2323"', () => {
    const result = detectTerminalCreateIntent('telnet终端 host:10.0.0.1 port:2323');
    expect(result).not.toBeNull();
    expect(result!.payload.protocol).toBe('telnet');
    expect(result!.payload.host).toBe('10.0.0.1');
    expect(result!.payload.port).toBe(2323);
  });

  it('defaults port=23 for telnet', () => {
    const result = detectTerminalCreateIntent('telnet 192.168.1.1');
    expect(result).not.toBeNull();
    expect(result!.payload.port).toBe(23);
  });
});

// ─── Serial ────────────────────────────────────────────────────────

describe('detectTerminalCreateIntent - Serial', () => {
  it('detects "打开串口COM3 波特率115200"', () => {
    const result = detectTerminalCreateIntent('打开串口COM3 波特率115200');
    expect(result).not.toBeNull();
    expect(result!.payload.protocol).toBe('serial');
    expect(result!.payload.portName).toBe('COM3');
    expect(result!.payload.baudRate).toBe(115200);
  });

  it('detects "串口终端 port:COM1 baud:9600"', () => {
    const result = detectTerminalCreateIntent('串口终端 port:COM1 baud:9600');
    expect(result).not.toBeNull();
    expect(result!.payload.protocol).toBe('serial');
    expect(result!.payload.portName).toBe('COM1');
    expect(result!.payload.baudRate).toBe(9600);
  });

  it('defaults baudRate=115200 for serial', () => {
    const result = detectTerminalCreateIntent('打开串口COM4');
    expect(result).not.toBeNull();
    expect(result!.payload.baudRate).toBe(115200);
  });
});

// ─── diagnosticTrace ───────────────────────────────────────────────

describe('diagnosticTrace', () => {
  it('reports keyword match and param extraction success', () => {
    const lines = diagnosticTrace('SSH连接10.0.0.1 用户admin 密码secret');
    expect(lines.some((l) => l.includes('SSH=true'))).toBe(true);
    expect(lines.some((l) => l.includes('SSH参数提取成功'))).toBe(true);
  });

  it('reports keyword match but param extraction failure', () => {
    const lines = diagnosticTrace('新建SSH连接 用户admin 密码123');
    expect(lines.some((l) => l.includes('SSH=true'))).toBe(true);
    expect(lines.some((l) => l.includes('SSH参数提取失败'))).toBe(true);
  });

  it('reports no keyword match', () => {
    const lines = diagnosticTrace('查看当前目录');
    expect(lines.some((l) => l.includes('未匹配任何终端创建关键词'))).toBe(true);
  });
});

// ─── parseLlmAction ────────────────────────────────────────────────

describe('parseLlmAction', () => {
  it('parses a direct JSON TERMINAL_CREATE object', () => {
    const raw = '{"type":"TERMINAL_CREATE","payload":{"protocol":"ssh","host":"10.0.0.1","port":22,"username":"root","password":"secret"}}';
    const result = parseLlmAction(raw);
    expect(result).not.toBeNull();
    expect(result!.payload.host).toBe('10.0.0.1');
    expect(result!.payload.password).toBe('secret');
  });

  it('parses TERMINAL_CREATE embedded in text', () => {
    const raw = '好的，已为您解析：\n{"type":"TERMINAL_CREATE","payload":{"protocol":"ssh","host":"192.168.1.1","port":22,"username":"admin"}}';
    const result = parseLlmAction(raw);
    expect(result).not.toBeNull();
    expect(result!.payload.host).toBe('192.168.1.1');
  });

  it('returns null for non-action JSON', () => {
    const raw = '[{"description":"test","command":"ls"}]';
    expect(parseLlmAction(raw)).toBeNull();
  });

  it('returns null for garbage text', () => {
    expect(parseLlmAction('hello world')).toBeNull();
  });
});

// ─── actionToConnectionConfig ──────────────────────────────────────

describe('actionToConnectionConfig', () => {
  it('converts SSH action to SshConfig', () => {
    const action: TerminalCreateAction = {
      type: 'TERMINAL_CREATE',
      payload: { protocol: 'ssh', host: '10.0.0.1', port: 2222, username: 'admin', password: 'pw' },
    };
    const config = actionToConnectionConfig(action);
    expect(config.protocol).toBe('ssh');
    if (config.protocol === 'ssh') {
      expect(config.host).toBe('10.0.0.1');
      expect(config.port).toBe(2222);
      expect(config.username).toBe('admin');
      expect(config.password).toBe('pw');
    }
  });

  it('converts Telnet action to TelnetConfig', () => {
    const action: TerminalCreateAction = {
      type: 'TERMINAL_CREATE',
      payload: { protocol: 'telnet', host: '10.0.0.1', port: 2323 },
    };
    const config = actionToConnectionConfig(action);
    expect(config.protocol).toBe('telnet');
  });

  it('converts Serial action to SerialConfig', () => {
    const action: TerminalCreateAction = {
      type: 'TERMINAL_CREATE',
      payload: { protocol: 'serial', host: '', port: 0, portName: 'COM3', baudRate: 9600 },
    };
    const config = actionToConnectionConfig(action);
    expect(config.protocol).toBe('serial');
    if (config.protocol === 'serial') {
      expect(config.portName).toBe('COM3');
      expect(config.baudRate).toBe(9600);
    }
  });

  it('applies SSH defaults when port/username missing', () => {
    const action: TerminalCreateAction = {
      type: 'TERMINAL_CREATE',
      payload: { protocol: 'ssh', host: '10.0.0.1', port: 0 },
    };
    const config = actionToConnectionConfig(action);
    if (config.protocol === 'ssh') {
      expect(config.port).toBe(22);
      expect(config.username).toBe('root');
      expect(config.password).toBe('');
    }
  });
});

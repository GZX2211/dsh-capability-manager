// tests/host/mcp/spawn.test.ts
//
// Windows 启动命令的展开规则：官方 stdio 传输用非 shell spawn，
// 裸命令（npx 等 .cmd 包装）不展开就起不来。

import { describe, expect, it } from 'vitest'
import { resolveSpawnCommandLine } from '../../../src/host/mcp/spawn.ts'

describe('Windows 启动命令', () => {
  it('裸命令走 cmd.exe /d /c', () => {
    expect(resolveSpawnCommandLine('npx -y @playwright/mcp@latest --headless', 'win32')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/c', 'npx', '-y', '@playwright/mcp@latest', '--headless'],
    })
  })

  it('显式 .exe 直接启动', () => {
    expect(resolveSpawnCommandLine('"C:\\Program Files\\nodejs\\node.exe" D:\\mcp\\index.js', 'win32')).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['D:\\mcp\\index.js'],
    })
  })

  it('node 是真实可执行文件，不加壳', () => {
    expect(resolveSpawnCommandLine('node D:\\mcp\\index.js', 'win32')).toEqual({
      command: 'node',
      args: ['D:\\mcp\\index.js'],
    })
  })

  it('.cmd 与 .bat 走 cmd.exe /d /c', () => {
    expect(resolveSpawnCommandLine('D:\\tools\\server.cmd --stdio', 'win32')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/c', 'D:\\tools\\server.cmd', '--stdio'],
    })
  })

  it('.ps1 走 powershell -File', () => {
    expect(resolveSpawnCommandLine('D:\\tools\\server.ps1 --stdio', 'win32')).toEqual({
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'D:\\tools\\server.ps1', '--stdio'],
    })
  })
})

describe('其他平台', () => {
  it('launcher 本身可执行，直接启动', () => {
    expect(resolveSpawnCommandLine('npx -y pkg', 'linux')).toEqual({ command: 'npx', args: ['-y', 'pkg'] })
  })
})

describe('空命令', () => {
  it('空白输入得到空启动描述', () => {
    expect(resolveSpawnCommandLine('   ', 'win32')).toEqual({ command: '', args: [] })
  })
})

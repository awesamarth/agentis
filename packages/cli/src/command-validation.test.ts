import { describe, expect, test } from 'bun:test'

function run(...args: string[]) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, 'src/index.ts', ...args],
    cwd: import.meta.dir.replace(/\/src$/, ''),
    env: { ...process.env, NO_COLOR: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

describe('CLI command validation', () => {
  test('rejects unknown top-level commands with a suggestion', () => {
    const result = run('token', 'search', 'SOL')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown command "token". Did you mean "tokens"?')
    expect(result.stdout).not.toContain('financial infrastructure for AI agents')
  })

  test('rejects unknown subcommands with scoped help', () => {
    const result = run('swap', 'quotes', 'leno')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown subcommand "quotes" for "swap". Did you mean "quote"?')
    expect(result.stderr).toContain('agentis swap --help')
  })

  test('rejects a missing required subcommand', () => {
    const result = run('wallet')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Missing command for "wallet".')
  })

  test('keeps explicit help successful', () => {
    const result = run('swap', '--help')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('agentis swap')
  })
})

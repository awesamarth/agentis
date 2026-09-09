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
    const result = run('operation', 'list')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown command "operation". Did you mean "operations"?')
  })

  test('rejects unknown subcommands with scoped help', () => {
    const result = run('operations', 'gets', 'test')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Unknown subcommand "gets" for "operations". Did you mean "get"?')
  })

  test('rejects a missing required subcommand', () => {
    const result = run('wallet')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Missing command for "wallet".')
  })

})

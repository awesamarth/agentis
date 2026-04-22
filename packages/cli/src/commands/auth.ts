import { saveToken, getToken, deleteToken } from '../lib/keychain'
import { apiFetch } from '../lib/config'

export async function login() {
  const existing = await getToken()
  if (existing) {
    console.log('Already logged in. Run `agentis logout` first.')
    return
  }

  // Create a pending session
  const res = await apiFetch('/auth/session', { method: 'POST' })
  if (!res.ok) {
    console.error('Failed to start login session.')
    process.exit(1)
  }
  const { sessionId, loginUrl } = await res.json()

  console.log('\nOpen this URL in your browser to authenticate:\n')
  console.log(`  ${loginUrl}\n`)

  // Try to open browser automatically
  try {
    const { exec } = await import('child_process')
    const open = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
    exec(`${open} "${loginUrl}"`)
  } catch {
    // silently ignore — user can open manually
  }

  console.log('Waiting for authentication...')

  // Poll every 2 seconds for up to 10 minutes
  const deadline = Date.now() + 10 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000))

    const poll = await apiFetch(`/auth/session/${sessionId}`)
    if (!poll.ok) {
      if (poll.status === 410) {
        console.error('\nSession expired. Run `agentis login` again.')
        process.exit(1)
      }
      continue
    }

    const data = await poll.json()
    if (data.status === 'complete' && data.accountKey) {
      await saveToken(data.accountKey)
      console.log('\nAuthenticated! You can now use the Agentis CLI.\n')
      return
    }
  }

  console.error('\nLogin timed out. Run `agentis login` again.')
  process.exit(1)
}

export async function logout() {
  const token = await getToken()
  if (!token) {
    console.log('Not logged in.')
    return
  }
  await deleteToken()
  console.log('Logged out.')
}

export async function whoami() {
  const token = await getToken()
  if (!token) {
    console.log('Not logged in. Run `agentis login`.')
    return
  }
  // Show masked key
  const masked = token.slice(0, 13) + '••••••••' + token.slice(-4)
  console.log(`Logged in as ${masked}`)
}

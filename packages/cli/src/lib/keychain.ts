import { Entry } from '@napi-rs/keyring'

const entry = new Entry('agentis-cli', 'account-key')

export async function saveToken(token: string): Promise<void> {
  entry.setPassword(token)
}

export async function getToken(): Promise<string | null> {
  try {
    return entry.getPassword()
  } catch {
    return null
  }
}

export async function deleteToken(): Promise<void> {
  try {
    entry.deletePassword()
  } catch {
    // already gone
  }
}

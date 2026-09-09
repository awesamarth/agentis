import Link from 'next/link'
export default function RetiredOAuth() {
  return <main className="max-w-2xl mx-auto p-12"><h1>OAuth integration temporarily unavailable</h1><p>Remote MCP is paused while scoped authorization is rebuilt. No legacy consent request will be approved here.</p><Link href="/dashboard">Return to Agentis</Link></main>
}

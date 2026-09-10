import Link from 'next/link'
export default function CliAuth() {
  return <main className="mx-auto max-w-2xl space-y-4 px-6 py-12"><h1 className="font-serif text-2xl font-bold">Connect your agent</h1><p className="text-sm text-ink-muted">Open an agent’s access page from the dashboard to create an all-networks or single-network key for the CLI or SDK. Account-wide keys are no longer available.</p><Link className="text-sm underline underline-offset-4" href="/dashboard">Choose an agent</Link></main>
}

import Link from 'next/link'
export default function RetiredLogin() {
  return <main className="max-w-2xl mx-auto p-12"><h1>CLI authentication changed</h1><p>Legacy account-key login is unavailable during the rewrite. Create a scoped executor grant in wallet access; never give an agent your owner token.</p><Link href="/dashboard/profile">Wallet access</Link></main>
}

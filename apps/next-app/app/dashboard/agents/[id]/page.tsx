'use client'
import { useParams } from 'next/navigation'
import Navbar from '@/components/Navbar'
import GuestWallets from '@/components/GuestWallets'
export default function GuestDetail() {
  const { id } = useParams<{ id: string }>()
  return <><Navbar /><main className="max-w-4xl mx-auto px-6 py-24"><GuestWallets selectedId={id} /></main></>
}

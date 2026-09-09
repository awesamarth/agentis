'use client'
import { useParams } from 'next/navigation'
import Navbar from '@/components/Navbar'
import Operations from '@/components/Operations'
export default function ApprovalPage() {
  const { id } = useParams<{ id: string }>()
  return <><Navbar /><main className="max-w-4xl mx-auto px-6 py-24"><Operations id={id} /></main></>
}

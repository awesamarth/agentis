import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import Link from 'next/link'
import { ExternalLinkIcon } from 'lucide-react'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <div className="flex items-center gap-3">
          <span className="flex size-7 items-center justify-center bg-fd-foreground font-serif text-sm font-black text-fd-background">
            A
          </span>
          <span className="font-mono text-sm uppercase tracking-[0.18em]">
            Agentis Docs
          </span>
        </div>
      ),
    },
    links: [
      {
        type: 'custom',
        children: (
          <Link
            href="https://agentis.systems"
            target="_blank"
            rel="noreferrer"
            className="group relative flex flex-row items-center gap-2 rounded-lg p-2 ps-(--sidebar-item-offset) text-start text-fd-muted-foreground wrap-anywhere transition-colors hover:bg-fd-accent/50 hover:text-fd-accent-foreground/80 hover:transition-none [&_svg]:size-4 [&_svg]:shrink-0"
          >
            Agentis Website
            <ExternalLinkIcon className="ms-auto transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        ),
      },
    ],
  }
}

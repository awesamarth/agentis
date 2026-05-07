import { docs } from 'collections'
import type { Root } from 'fumadocs-core/page-tree'
import { loader } from 'fumadocs-core/source'
import {
  BlocksIcon,
  BookOpenIcon,
  Code2Icon,
  TerminalIcon,
  WrenchIcon,
} from 'lucide-react'
import { createElement } from 'react'

const iconMap = {
  BlocksIcon,
  BookOpenIcon,
  Code2Icon,
  TerminalIcon,
  WrenchIcon,
}

const rootOrder = new Map([
  ['Agentis', 0],
  ['CLI', 1],
  ['SDK', 2],
  ['MCP', 3],
  ['Guides', 4],
])

function orderRootSections(root: Root): Root {
  return {
    ...root,
    children: [...root.children].sort((a, b) => {
      const aOrder =
        a.type === 'folder' ? (rootOrder.get(String(a.name)) ?? 99) : 99
      const bOrder =
        b.type === 'folder' ? (rootOrder.get(String(b.name)) ?? 99) : 99
      return aOrder - bOrder
    }),
  }
}

export const source = loader({
  baseUrl: '/docs',
  icon(icon) {
    if (!icon || !(icon in iconMap)) return
    const Icon = iconMap[icon as keyof typeof iconMap]
    return createElement(Icon, { className: 'size-4' })
  },
  pageTree: {
    transformers: [
      {
        root: orderRootSections,
      },
    ],
  },
  source: docs.toFumadocsSource(),
})

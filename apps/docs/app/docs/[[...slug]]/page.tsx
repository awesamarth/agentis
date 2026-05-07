import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createRelativeLink } from 'fumadocs-ui/mdx'
import { PageArticle, PageRoot } from 'fumadocs-ui/layouts/docs/page'
import { getMDXComponents } from '@/components/mdx'
import { source } from '@/lib/source'

type DocsPageProps = {
  params: Promise<{
    slug?: string[]
  }>
}

export default async function Page(props: DocsPageProps) {
  const params = await props.params
  if (!params.slug) redirect('/docs/agentis')

  const page = source.getPage(params.slug)
  if (!page) notFound()

  const MDX = page.data.body

  return (
    <PageRoot toc={{ toc: page.data.toc }}>
      <PageArticle className="agentis-docs-prose prose prose-neutral dark:prose-invert max-w-none pb-24">
        <h1 className="mb-2 font-serif text-5xl font-black tracking-normal text-[var(--fd-foreground)]">
          {page.data.title}
        </h1>
        {page.data.description ? (
          <p className="mb-4 text-lg leading-7 text-[var(--fd-muted-foreground)]">
            {page.data.description}
          </p>
        ) : null}
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </PageArticle>
    </PageRoot>
  )
}

export function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata(props: DocsPageProps): Promise<Metadata> {
  const params = await props.params
  if (!params.slug) {
    return {
      title: 'Agentis Docs',
      description: 'Developer documentation for Agentis.',
    }
  }

  const page = source.getPage(params.slug)
  if (!page) notFound()

  return {
    title: `${page.data.title} | Agentis Docs`,
    description: page.data.description,
  }
}

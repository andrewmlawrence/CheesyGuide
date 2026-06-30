import { useQuery } from "convex/react"
import { ExternalLinkIcon } from "lucide-react"
import { Link, useParams } from "react-router"

import { ProtectedRoute } from "@/components/protected-route"
import { useSession } from "@/components/session-provider"
import { api, type Id } from "@/lib/convex"

function SourceRoute() {
  return (
    <ProtectedRoute>
      <SourceDetail />
    </ProtectedRoute>
  )
}

function SourceDetail() {
  const { sourceId } = useParams()
  const { sessionToken } = useSession()
  const result = useQuery(
    api.knowledge.getSource,
    sessionToken && sourceId
      ? {
          sessionToken,
          sourceId: sourceId as Id<"knowledgeSources">,
        }
      : "skip",
  )

  if (!result) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <p className="text-sm text-muted-foreground">Loading source...</p>
      </section>
    )
  }

  if (!result.source) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <p className="text-sm text-muted-foreground">Source not found.</p>
      </section>
    )
  }

  const source = result.source
  const sourceUrl = source.url ?? source.driveWebViewLink

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
        Back to knowledgebase
      </Link>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{source.sourceType} / {source.status}</p>
        <h1 className="text-3xl font-medium">{source.title}</h1>
        {source.summary && (
          <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
            {source.summary}
          </p>
        )}
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm text-foreground underline underline-offset-4"
          >
            <ExternalLinkIcon className="size-4" />
            Open original source
          </a>
        )}
      </div>
      <div className="space-y-3">
        <h2 className="text-sm font-medium">Knowledge entries</h2>
        {result.entries.map((entry) => (
          <article key={entry._id} className="rounded-lg border p-4">
            <h3 className="text-sm font-medium">{entry.title}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {entry.body}
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}

export { SourceRoute }

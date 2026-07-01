import { useQuery } from "convex/react"
import { ExternalLinkIcon } from "lucide-react"
import { Link, useParams } from "react-router"

import { ProtectedRoute } from "@/components/protected-route"
import { useSession } from "@/components/session-provider"
import { api, type Id } from "@/lib/convex"
import { formatSourceDate, sourceTypeLabel } from "@/lib/sources"

function MarkdownBlock({ body }: { body: string }) {
  const lines = body.split("\n")

  return (
    <div className="space-y-3 text-sm leading-7 text-foreground">
      {lines.map((line, index) => {
        const trimmed = line.trim()
        const key = `${index}-${trimmed}`

        if (!trimmed) {
          return <div key={key} className="h-1" />
        }

        if (trimmed.startsWith("### ")) {
          return (
            <h4 key={key} className="pt-2 text-base font-semibold">
              {trimmed.slice(4)}
            </h4>
          )
        }

        if (trimmed.startsWith("## ")) {
          return (
            <h3 key={key} className="pt-3 text-lg font-semibold">
              {trimmed.slice(3)}
            </h3>
          )
        }

        if (trimmed.startsWith("# ")) {
          return (
            <h2 key={key} className="pt-4 text-xl font-semibold">
              {trimmed.slice(2)}
            </h2>
          )
        }

        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <p key={key} className="pl-4">
              <span className="mr-2 text-primary">-</span>
              {trimmed.slice(2)}
            </p>
          )
        }

        const numbered = trimmed.match(/^(\d+)\.\s+(.*)$/)
        if (numbered) {
          return (
            <p key={key} className="pl-4">
              <span className="mr-2 text-primary">{numbered[1]}.</span>
              {numbered[2]}
            </p>
          )
        }

        return <p key={key}>{trimmed}</p>
      })}
    </div>
  )
}

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
  const sourceUrl = source.url ?? source.storageDownloadUrl
  const isMentorTextbook = source.sourceType === "mentorNote"

  return (
    <section className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
        Back to knowledgebase
      </Link>
      <div className="space-y-3 rounded-lg border bg-card p-5 shadow-sm">
        <p className="text-sm text-muted-foreground">
          {sourceTypeLabel(source)} / {source.status} / Added{" "}
          {formatSourceDate(source.createdAt)}
        </p>
        <h1 className="text-3xl font-semibold">{source.title}</h1>
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
      <div className="space-y-4">
        <h2 className="text-sm font-medium">
          {isMentorTextbook ? "Textbook" : "Knowledge entries"}
        </h2>
        {result.entries.length > 0 ? (
          result.entries.map((entry) => (
            <article key={entry._id} className="rounded-lg border bg-card p-5">
              {!isMentorTextbook && (
                <h3 className="mb-3 text-sm font-medium">{entry.title}</h3>
              )}
              <MarkdownBlock body={entry.body} />
            </article>
          ))
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No readable knowledge entries have been generated for this source yet.
          </p>
        )}
      </div>
    </section>
  )
}

export { SourceRoute }

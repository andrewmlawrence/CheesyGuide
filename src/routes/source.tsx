import { useQuery } from "convex/react"
import { ExternalLinkIcon } from "lucide-react"
import { type ReactNode } from "react"
import { Link, useParams } from "react-router"

import { ProtectedRoute } from "@/components/protected-route"
import { useSession } from "@/components/session-provider"
import { api, type Id } from "@/lib/convex"
import { formatSourceDate, sourceStatusLabel, sourceTypeLabel } from "@/lib/sources"

function renderInlineMarkdown(text: string) {
  const parts: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const token = match[0]
    if (token.startsWith("**")) {
      parts.push(<strong key={`${match.index}-bold`}>{token.slice(2, -2)}</strong>)
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (link) {
        parts.push(
          <a
            key={`${match.index}-link`}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline underline-offset-4"
          >
            {link[1]}
          </a>,
        )
      }
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

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
              {renderInlineMarkdown(trimmed.slice(2))}
            </p>
          )
        }

        const numbered = trimmed.match(/^(\d+)\.\s+(.*)$/)
        if (numbered) {
          return (
            <p key={key} className="pl-4">
              <span className="mr-2 text-primary">{numbered[1]}.</span>
              {renderInlineMarkdown(numbered[2])}
            </p>
          )
        }

        return <p key={key}>{renderInlineMarkdown(trimmed)}</p>
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
  const isVideo = source.sourceType === "video"

  return (
    <section className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
        Back to knowledgebase
      </Link>
      <div className="space-y-3 rounded-lg border bg-card p-5 shadow-sm">
        <p className="text-sm text-muted-foreground">
          {sourceTypeLabel(source)} / {sourceStatusLabel(source)} / Added{" "}
          {formatSourceDate(source.createdAt)}
        </p>
        <h1 className="text-3xl font-semibold">{source.title}</h1>
        {source.summary && (
          <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
            {source.summary}
          </p>
        )}
        {isVideo && (
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Processing</p>
              <p className="font-medium">
                {source.videoProcessingMode === "geminiAnalysis"
                  ? "Gemini video analysis"
                  : "Transcript / captions first"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Transcript source</p>
              <p className="font-medium">{source.videoTranscriptSource ?? "Unknown"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Low-res estimate</p>
              <p className="font-medium">
                {source.videoLowTokenEstimate
                  ? `${source.videoLowTokenEstimate.toLocaleString()} tokens`
                  : "Unknown"}
              </p>
            </div>
          </div>
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
      {isVideo && result.videoSegments.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium">Timestamped video notes</h2>
          <div className="space-y-3">
            {result.videoSegments.map((segment) => (
              <article key={segment._id} className="rounded-lg border bg-card p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                    {segment.timestamp}
                  </p>
                  <h3 className="text-sm font-medium">{segment.heading}</h3>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {segment.transcript}
                </p>
                {segment.visualText && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-muted-foreground">Visible text</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                      {segment.visualText}
                    </p>
                  </div>
                )}
                {segment.codeOrDiagramNotes && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      Code or diagram notes
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                      {segment.codeOrDiagramNotes}
                    </p>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
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

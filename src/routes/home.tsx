import { useAction, useQuery } from "convex/react"
import { BotIcon, FileTextIcon, Loader2Icon, SearchIcon, SendIcon } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import { ProtectedRoute } from "@/components/protected-route"
import { useSession } from "@/components/session-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/convex"

function HomeRoute() {
  return (
    <ProtectedRoute>
      <Knowledgebase />
    </ProtectedRoute>
  )
}

function Knowledgebase() {
  const { sessionToken } = useSession()
  const askTeacher = useAction(api.ai.askTeacher)
  const [search, setSearch] = useState("")
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [isAsking, setIsAsking] = useState(false)
  const sources = useQuery(
    api.knowledge.listSources,
    sessionToken ? { sessionToken, search: search || undefined } : "skip",
  )
  const entries = useQuery(
    api.knowledge.listEntries,
    sessionToken ? { sessionToken, search: search || undefined } : "skip",
  )

  async function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sessionToken || !question.trim()) return

    setIsAsking(true)
    try {
      const result = await askTeacher({ sessionToken, question })
      setAnswer(result.answer)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Teacher request failed")
    } finally {
      setIsAsking(false)
    }
  }

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_24rem]">
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">FRC 254 knowledgebase</p>
          <h1 className="text-3xl font-medium tracking-normal">CheesyGuide</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Search uploaded sources, summaries, and topic notes. Ask the AI
            Teacher when you want a direct engineering answer.
          </p>
        </div>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search mechanisms, CAD, controls, shop practices..."
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(sources ?? []).map((source) => (
            <Link
              key={source._id}
              to={`/sources/${source._id}`}
              className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition hover:border-ring"
            >
              <div className="flex items-center gap-2">
                <FileTextIcon className="size-4 text-muted-foreground" />
                <h2 className="line-clamp-1 text-sm font-medium">{source.title}</h2>
              </div>
              <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                {source.summary ?? "No summary yet."}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">{source.status}</p>
            </Link>
          ))}
        </div>
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Generated notes and summaries</h2>
          {(entries ?? []).map((entry) => (
            <article key={entry._id} className="rounded-lg border p-4">
              <h3 className="text-sm font-medium">{entry.title}</h3>
              <p className="mt-2 line-clamp-4 text-sm text-muted-foreground">
                {entry.body}
              </p>
            </article>
          ))}
        </div>
      </div>
      <aside className="h-fit rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <BotIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">AI Teacher</h2>
        </div>
        <form className="space-y-3" onSubmit={handleAsk}>
          <Textarea
            value={question}
            onChange={(event) => setQuestion(event.currentTarget.value)}
            placeholder="Ask a robot or engineering question..."
            className="min-h-28"
            required
          />
          <Button type="submit" className="w-full" disabled={isAsking}>
            {isAsking ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SendIcon className="size-4" />
            )}
            Ask
          </Button>
        </form>
        {answer && (
          <div className="mt-4 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm leading-6">
            {answer}
          </div>
        )}
      </aside>
    </section>
  )
}

export { HomeRoute }

import { useAction, useQuery } from "convex/react"
import {
  BotIcon,
  ExternalLinkIcon,
  FileTextIcon,
  Loader2Icon,
  SearchIcon,
  SendIcon,
} from "lucide-react"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { ProtectedRoute } from "@/components/protected-route"
import { useSession } from "@/components/session-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/convex"

type TeacherMode = "sourcesOnly" | "sourcesPlusGeneral" | "sourcesPlusWeb"

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  citations?: string[]
}

function teacherModeLabel(mode: TeacherMode) {
  if (mode === "sourcesOnly") return "Uploaded Sources Only"
  if (mode === "sourcesPlusWeb") return "Sources + Web Search"
  return "Sources + Gemini Knowledge"
}

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
  const [answerMode, setAnswerMode] = useState<TeacherMode>("sourcesOnly")
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Ask an engineering or robot design question. I will start from the uploaded CheesyGuide sources, then follow the evidence mode you choose.",
    },
  ])
  const [isAsking, setIsAsking] = useState(false)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const sources = useQuery(
    api.knowledge.listSources,
    sessionToken ? { sessionToken, search: search || undefined } : "skip",
  )
  const entries = useQuery(
    api.knowledge.listEntries,
    sessionToken ? { sessionToken, search: search || undefined } : "skip",
  )
  const history = useMemo(
    () =>
      messages
        .filter((message) => message.id !== "welcome")
        .slice(-8)
        .map((message) => ({
          role: message.role,
          content: message.content,
        })),
    [messages],
  )

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" })
  }, [messages, isAsking])

  async function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedQuestion = question.trim()
    if (!sessionToken || !trimmedQuestion) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedQuestion,
    }
    setMessages((current) => [...current, userMessage])
    setQuestion("")
    setIsAsking(true)

    try {
      const result = await askTeacher({
        sessionToken,
        question: trimmedQuestion,
        answerMode,
        history,
      })
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.answer,
          citations: result.citations,
        },
      ])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Teacher request failed")
    } finally {
      setIsAsking(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-col gap-2">
        <p className="text-sm font-medium text-primary">FRC 254 knowledgebase</p>
        <h1 className="text-3xl font-semibold tracking-normal">CheesyGuide</h1>
      </div>

      <Tabs defaultValue="teacher" className="gap-5">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="teacher">AI Teacher</TabsTrigger>
          <TabsTrigger value="guide">Searchable Guide</TabsTrigger>
        </TabsList>

        <TabsContent value="teacher">
          <div className="mx-auto max-w-4xl rounded-lg border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <div className="flex items-center gap-2">
                <BotIcon className="size-5 text-primary" />
                <h2 className="text-base font-medium">AI Teacher</h2>
              </div>
              <Select
                value={answerMode}
                onValueChange={(value) => setAnswerMode(value as TeacherMode)}
              >
                <SelectTrigger className="w-full max-w-60">
                  {teacherModeLabel(answerMode)}
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="sourcesOnly">Uploaded Sources Only</SelectItem>
                  <SelectItem value="sourcesPlusGeneral">
                    Sources + Gemini Knowledge
                  </SelectItem>
                  <SelectItem value="sourcesPlusWeb">Sources + Web Search</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <ScrollArea className="h-[55svh] min-h-96 border-b">
              <div className="space-y-4 p-4">
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={
                      message.role === "user"
                        ? "ml-auto max-w-[85%] rounded-lg bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground"
                        : "max-w-[90%] rounded-lg bg-muted px-4 py-3 text-sm leading-6"
                    }
                  >
                    <div className="whitespace-pre-wrap">{message.content}</div>
                    {message.citations && message.citations.length > 0 && (
                      <div className="mt-3 border-t border-current/15 pt-3">
                        <p className="text-xs font-medium opacity-80">Sources</p>
                        <ul className="mt-2 space-y-1 text-xs opacity-80">
                          {message.citations.map((citation) => (
                            <li key={citation}>{citation}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </article>
                ))}
                {isAsking && (
                  <div className="inline-flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" />
                    Thinking through the sources...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            </ScrollArea>

            <form className="space-y-3 p-4" onSubmit={handleAsk}>
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.currentTarget.value)}
                placeholder="Ask a robot, CAD, controls, or engineering question..."
                className="min-h-24"
                required
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={isAsking}>
                  {isAsking ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <SendIcon className="size-4" />
                  )}
                  Send
                </Button>
              </div>
            </form>
          </div>
        </TabsContent>

        <TabsContent value="guide">
          <div className="space-y-6">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
              <Input
                className="pl-8"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Search mechanisms, CAD, controls, shop practices..."
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(sources ?? []).map((source) => {
                const href = source.url ?? source.storageDownloadUrl
                return (
                  <a
                    key={source._id}
                    href={href ?? "#"}
                    target={href ? "_blank" : undefined}
                    rel={href ? "noreferrer" : undefined}
                    className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition hover:border-ring"
                  >
                    <div className="flex items-center gap-2">
                      <FileTextIcon className="size-4 text-primary" />
                      <h2 className="line-clamp-1 text-sm font-medium">
                        {source.title}
                      </h2>
                    </div>
                    <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                      {source.summary ?? "No summary yet."}
                    </p>
                    <p className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      {source.status}
                      {href && <ExternalLinkIcon className="size-3" />}
                    </p>
                  </a>
                )
              })}
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
        </TabsContent>
      </Tabs>
    </section>
  )
}

export { HomeRoute }

import { useAction, useQuery } from "convex/react"
import {
  BotIcon,
  ExternalLinkIcon,
  FileTextIcon,
  ImagePlusIcon,
  Loader2Icon,
  SearchIcon,
  SendIcon,
  XIcon,
} from "lucide-react"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router"
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
import {
  formatSourceDate,
  sourceGroupLabel,
  sourceHref,
  sourceOpensExternally,
  sourceStatusLabel,
  sourceTypeLabel,
} from "@/lib/sources"

type TeacherMode = "sourcesOnly" | "sourcesPlusGeneral" | "sourcesPlusWeb"
type SourceTypeFilter = "all" | "document" | "url" | "mentorNote"
type SourceSort = "newest" | "oldest" | "nameAsc" | "nameDesc" | "type"

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  citations?: string[]
  images?: ChatImagePreview[]
}

type ChatImagePreview = {
  id: string
  name: string
  mimeType: string
  data: string
  previewUrl: string
}

function teacherModeLabel(mode: TeacherMode) {
  if (mode === "sourcesOnly") return "Uploaded Sources Only"
  if (mode === "sourcesPlusWeb") return "Sources + Web Search"
  return "Sources + Gemini Knowledge"
}

function sourceTypeFilterLabel(filter: SourceTypeFilter) {
  if (filter === "document") return "Documents"
  if (filter === "url") return "Websites"
  if (filter === "mentorNote") return "Mentor Textbook"
  return "All Types"
}

function sourceSortLabel(sort: SourceSort) {
  if (sort === "oldest") return "Oldest First"
  if (sort === "nameAsc") return "Name A-Z"
  if (sort === "nameDesc") return "Name Z-A"
  if (sort === "type") return "Type"
  return "Newest First"
}

function imageToBase64(file: File) {
  return new Promise<ChatImagePreview>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      const [, data = ""] = result.split(",")
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type || "image/png",
        data,
        previewUrl: result,
      })
    }
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.readAsDataURL(file)
  })
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
  const [sourceTypeFilter, setSourceTypeFilter] = useState<SourceTypeFilter>("all")
  const [sourceSort, setSourceSort] = useState<SourceSort>("type")
  const [attachedImages, setAttachedImages] = useState<ChatImagePreview[]>([])
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
    sessionToken
      ? {
          sessionToken,
          search: search || undefined,
          sourceType: sourceTypeFilter === "all" ? undefined : sourceTypeFilter,
        }
      : "skip",
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
  const groupedSources = useMemo(() => {
    const sortedSources = [...(sources ?? [])].sort((a, b) => {
      if (sourceSort === "oldest") return a.createdAt - b.createdAt
      if (sourceSort === "nameAsc") return a.title.localeCompare(b.title)
      if (sourceSort === "nameDesc") return b.title.localeCompare(a.title)
      if (sourceSort === "type") {
        return sourceTypeLabel(a).localeCompare(sourceTypeLabel(b)) || a.title.localeCompare(b.title)
      }
      return b.createdAt - a.createdAt
    })

    return sortedSources.reduce<Array<{ label: string; sources: typeof sortedSources }>>(
      (groups, source) => {
        const label = sourceGroupLabel(source)
        const group = groups.find((item) => item.label === label)
        if (group) {
          group.sources.push(source)
        } else {
          groups.push({ label, sources: [source] })
        }
        return groups
      },
      [],
    )
  }, [sources, sourceSort])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" })
  }, [messages, isAsking])

  async function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedQuestion = question.trim()
    if (!sessionToken || (!trimmedQuestion && attachedImages.length === 0)) return
    const questionText = trimmedQuestion || "Please analyze the attached image."

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: questionText,
      images: attachedImages,
    }
    setMessages((current) => [...current, userMessage])
    setQuestion("")
    setAttachedImages([])
    setIsAsking(true)

    try {
      const result = await askTeacher({
        sessionToken,
        question: questionText,
        answerMode,
        history,
        images: attachedImages.map((image) => ({
          mimeType: image.mimeType,
          data: image.data,
        })),
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

  async function handleImageSelect(files: FileList | null) {
    if (!files) return
    const selected = Array.from(files).filter((file) => file.type.startsWith("image/"))
    if (selected.length === 0) return

    try {
      const safeImages = selected.slice(0, 4).filter((file) => {
        if (file.size <= 4 * 1024 * 1024) return true
        toast.error(`${file.name} is larger than 4 MB`)
        return false
      })
      const nextImages = await Promise.all(safeImages.map(imageToBase64))
      setAttachedImages((current) => [...current, ...nextImages].slice(0, 4))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not attach image")
    }
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-col gap-2">
        <p className="text-sm font-medium text-primary">FRC 254 knowledgebase</p>
        <h1 className="text-3xl font-semibold tracking-normal">CheesyGuide</h1>
      </div>

      <Tabs defaultValue="teacher" className="gap-5">
        <TabsList className="w-full flex-wrap justify-start overflow-visible sm:w-fit">
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
                    {message.images && message.images.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {message.images.map((image) => (
                          <img
                            key={image.id}
                            src={image.previewUrl}
                            alt={image.name}
                            className="h-24 w-24 rounded-md border object-cover"
                          />
                        ))}
                      </div>
                    )}
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
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
                placeholder="Ask a robot, CAD, controls, or engineering question..."
                className="min-h-24"
              />
              {attachedImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachedImages.map((image) => (
                    <div key={image.id} className="relative">
                      <img
                        src={image.previewUrl}
                        alt={image.name}
                        className="h-20 w-20 rounded-md border object-cover"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        className="absolute -right-2 -top-2 size-6 rounded-full"
                        onClick={() =>
                          setAttachedImages((current) =>
                            current.filter((item) => item.id !== image.id),
                          )
                        }
                      >
                        <XIcon className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <label
                  className={`inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted ${isAsking ? "pointer-events-none opacity-50" : ""}`}
                >
                    <ImagePlusIcon className="size-4" />
                    Image
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      onChange={(event) => {
                        void handleImageSelect(event.currentTarget.files)
                        event.currentTarget.value = ""
                      }}
                    />
                </label>
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
            <div className="grid gap-3 lg:grid-cols-[1fr_12rem_12rem]">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  placeholder="Search mechanisms, CAD, controls, shop practices..."
                />
              </div>
              <Select
                value={sourceTypeFilter}
                onValueChange={(value) => setSourceTypeFilter(value as SourceTypeFilter)}
              >
                <SelectTrigger className="w-full">
                  {sourceTypeFilterLabel(sourceTypeFilter)}
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="document">Documents</SelectItem>
                  <SelectItem value="url">Websites</SelectItem>
                  <SelectItem value="mentorNote">Mentor Textbook</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={sourceSort}
                onValueChange={(value) => setSourceSort(value as SourceSort)}
              >
                <SelectTrigger className="w-full">
                  {sourceSortLabel(sourceSort)}
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="type">Type</SelectItem>
                  <SelectItem value="newest">Newest First</SelectItem>
                  <SelectItem value="oldest">Oldest First</SelectItem>
                  <SelectItem value="nameAsc">Name A-Z</SelectItem>
                  <SelectItem value="nameDesc">Name Z-A</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-5">
              {groupedSources.map((group) => (
                <section key={group.label} className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-medium">{group.label}</h2>
                    <p className="text-xs text-muted-foreground">
                      {group.sources.length} source{group.sources.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {group.sources.map((source) => {
                      const href = sourceHref(source)
                      const external = sourceOpensExternally(source)
                      const tileContent = (
                        <>
                          <div className="flex items-start gap-2">
                            <FileTextIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                            <h3 className="line-clamp-2 text-sm font-medium">
                              {source.title}
                            </h3>
                            {external && <ExternalLinkIcon className="mt-0.5 size-3 shrink-0" />}
                          </div>
                          <p className="mt-3 text-xs text-muted-foreground">
                            {sourceTypeLabel(source)} / {sourceStatusLabel(source)} / Added{" "}
                            {formatSourceDate(source.createdAt)}
                          </p>
                        </>
                      )

                      if (!external) {
                        return (
                          <Link
                            key={source._id}
                            to={href}
                            className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition hover:border-ring"
                          >
                            {tileContent}
                          </Link>
                        )
                      }

                      return (
                        <a
                          key={source._id}
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition hover:border-ring"
                        >
                          {tileContent}
                        </a>
                      )
                    })}
                  </div>
                </section>
              ))}
              {groupedSources.length === 0 && (
                <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No guides match those filters.
                </p>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}

export { HomeRoute }

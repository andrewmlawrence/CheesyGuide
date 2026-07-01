import { useAction, useQuery } from "convex/react"
import {
  ExternalLinkIcon,
  FileUpIcon,
  GlobeIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  Trash2Icon,
} from "lucide-react"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { ProtectedRoute } from "@/components/protected-route"
import { useSession } from "@/components/session-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/convex"

const acceptedDocuments = [
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".txt",
  ".md",
].join(",")

type IntakeMessage = {
  id: string
  role: "user" | "assistant"
  content: string
}

function crawlModeLabel(mode: "single" | "small" | "section") {
  if (mode === "single") return "Single Page"
  if (mode === "small") return "Small Crawl"
  return "Section Crawl"
}

function MentorRoute() {
  return (
    <ProtectedRoute mentorOnly>
      <MentorTools />
    </ProtectedRoute>
  )
}

function MentorTools() {
  const { sessionToken } = useSession()
  const summarizeUrl = useAction(api.ai.summarizeUrl)
  const mentorIntake = useAction(api.ai.mentorIntake)
  const deleteSource = useAction(api.ai.deleteSource)
  const sources = useQuery(
    api.knowledge.listSources,
    sessionToken ? { sessionToken } : "skip",
  )
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [url, setUrl] = useState("")
  const [urlTitle, setUrlTitle] = useState("")
  const [crawlMode, setCrawlMode] = useState<"single" | "small" | "section">("section")
  const [pageLimit, setPageLimit] = useState(50)
  const [mentorNote, setMentorNote] = useState("")
  const [intakeMessages, setIntakeMessages] = useState<IntakeMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Share a design rule, lesson learned, or rough note. I will ask follow-up questions when useful and save the exchange as knowledgebase context.",
    },
  ])
  const [isUploading, setIsUploading] = useState(false)
  const [isAddingUrl, setIsAddingUrl] = useState(false)
  const [isSendingNote, setIsSendingNote] = useState(false)
  const intakeEndRef = useRef<HTMLDivElement | null>(null)
  const intakeHistory = useMemo(
    () =>
      intakeMessages
        .filter((message) => message.id !== "welcome")
        .slice(-8)
        .map((message) => ({
          role: message.role,
          content: message.content,
        })),
    [intakeMessages],
  )

  useEffect(() => {
    intakeEndRef.current?.scrollIntoView({ block: "end" })
  }, [intakeMessages, isSendingNote])

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sessionToken || !selectedFile) return

    const formData = new FormData()
    formData.set("sessionToken", sessionToken)
    formData.set("file", selectedFile)
    setIsUploading(true)

    try {
      const response = await fetch(`${import.meta.env.VITE_CONVEX_SITE_URL}/upload`, {
        method: "POST",
        body: formData,
      })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(body.error ?? "Upload failed")
      }
      toast.success("Document uploaded")
      setSelectedFile(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed")
    } finally {
      setIsUploading(false)
    }
  }

  async function handleUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sessionToken || !url.trim()) return
    setIsAddingUrl(true)

    try {
      await summarizeUrl({
        sessionToken,
        url,
        title: urlTitle || undefined,
        crawlMode,
        pageLimit: crawlMode === "section" ? pageLimit : undefined,
      })
      toast.success("URL source added")
      setUrl("")
      setUrlTitle("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "URL import failed")
    } finally {
      setIsAddingUrl(false)
    }
  }

  async function handleMentorNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedNote = mentorNote.trim()
    if (!sessionToken || !trimmedNote) return
    setIsSendingNote(true)

    const userMessage: IntakeMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedNote,
    }
    setIntakeMessages((current) => [...current, userMessage])
    setMentorNote("")

    try {
      const result = await mentorIntake({
        sessionToken,
        message: trimmedNote,
        history: intakeHistory,
      })
      setIntakeMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.answer,
        },
      ])
      toast.success("Mentor note saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Mentor intake failed")
    } finally {
      setIsSendingNote(false)
    }
  }

  async function handleDelete(sourceId: string) {
    if (!sessionToken) return
    await deleteSource({ sessionToken, sourceId: sourceId as never })
    toast.success("Source deleted")
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 space-y-2">
        <p className="text-sm font-medium text-primary">Mentor portal</p>
        <h1 className="text-3xl font-semibold">Add knowledge</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Upload documents, capture URL sources, and use conversational intake
          to turn mentor expertise into searchable knowledgebase entries.
        </p>
      </div>

      <Tabs defaultValue="document" className="gap-5">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="document">Document Upload</TabsTrigger>
          <TabsTrigger value="url">URL Source</TabsTrigger>
          <TabsTrigger value="intake">Conversational Intake</TabsTrigger>
          <TabsTrigger value="sources">Source Management</TabsTrigger>
        </TabsList>

        <TabsContent value="document">
          <form className="max-w-3xl rounded-lg border bg-card p-4" onSubmit={handleUpload}>
            <div className="flex items-center gap-2">
              <FileUpIcon className="size-4 text-primary" />
              <h2 className="text-sm font-medium">Document upload</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              MVP accepts documents only. Images, audio, and video ingestion are
              planned for a later release.
            </p>
            <Input
              className="mt-4"
              type="file"
              accept={acceptedDocuments}
              onChange={(event) => setSelectedFile(event.currentTarget.files?.[0] ?? null)}
            />
            <Button className="mt-4" type="submit" disabled={!selectedFile || isUploading}>
              {isUploading ? <Loader2Icon className="size-4 animate-spin" /> : <FileUpIcon className="size-4" />}
              Upload
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="url">
          <form className="max-w-3xl rounded-lg border bg-card p-4" onSubmit={handleUrl}>
            <div className="flex items-center gap-2">
              <GlobeIcon className="size-4 text-primary" />
              <h2 className="text-sm font-medium">URL source</h2>
            </div>
            <div className="mt-2 space-y-2 text-sm leading-6 text-muted-foreground">
              <p>
                Add a web page or a focused section of a site to the
                knowledgebase. The importer extracts readable page text,
                summarizes it, and indexes the crawled text for Teacher answers.
              </p>
              <p>
                Single Page imports only the exact URL. Small Crawl follows up
                to five same-site links. Section Crawl follows links under the
                starting path, which is best for CAD guides, design handbooks,
                and mechanism libraries.
              </p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="url">URL</Label>
                <Input
                  id="url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.currentTarget.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="url-title">Title</Label>
                <Input
                  id="url-title"
                  value={urlTitle}
                  onChange={(event) => setUrlTitle(event.currentTarget.value)}
                />
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_10rem]">
              <div className="space-y-2">
                <Label htmlFor="crawl-mode">Import mode</Label>
                <Select
                  value={crawlMode}
                  onValueChange={(value) => setCrawlMode(value as "single" | "small" | "section")}
                >
                  <SelectTrigger id="crawl-mode" className="w-full">
                    {crawlModeLabel(crawlMode)}
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="single">Single Page</SelectItem>
                    <SelectItem value="small">Small Crawl</SelectItem>
                    <SelectItem value="section">Section Crawl</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="page-limit">Page limit</Label>
                <Input
                  id="page-limit"
                  type="number"
                  min={5}
                  max={100}
                  value={pageLimit}
                  onChange={(event) => setPageLimit(Number(event.currentTarget.value))}
                  disabled={crawlMode !== "section"}
                />
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              For FRCDesign.org, use Section Crawl on URLs like
              {" "}https://frcdesign.org/best-practices/ or
              {" "}https://frcdesign.org/design-handbook/ so the import stays on
              the CAD or robot-design section you care about.
            </p>
            <Button className="mt-4" type="submit" disabled={isAddingUrl}>
              {isAddingUrl ? <Loader2Icon className="size-4 animate-spin" /> : <GlobeIcon className="size-4" />}
              Add URL
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="intake">
          <div className="max-w-4xl rounded-lg border bg-card shadow-sm">
            <div className="flex items-center gap-2 border-b p-4">
              <MessageSquarePlusIcon className="size-4 text-primary" />
              <h2 className="text-sm font-medium">Conversational mentor intake</h2>
            </div>
            <ScrollArea className="h-[50svh] min-h-80 border-b">
              <div className="space-y-4 p-4">
                {intakeMessages.map((message) => (
                  <article
                    key={message.id}
                    className={
                      message.role === "user"
                        ? "ml-auto max-w-[85%] rounded-lg bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground"
                        : "max-w-[90%] rounded-lg bg-muted px-4 py-3 text-sm leading-6"
                    }
                  >
                    <div className="whitespace-pre-wrap">{message.content}</div>
                  </article>
                ))}
                {isSendingNote && (
                  <div className="inline-flex items-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" />
                    Intake AI is thinking...
                  </div>
                )}
                <div ref={intakeEndRef} />
              </div>
            </ScrollArea>
            <form className="space-y-3 p-4" onSubmit={handleMentorNote}>
              <Textarea
                className="min-h-28"
                value={mentorNote}
                onChange={(event) => setMentorNote(event.currentTarget.value)}
                placeholder="Describe a best practice, design rule, lesson learned, or engineering decision..."
                required
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={isSendingNote}>
                  {isSendingNote ? <Loader2Icon className="size-4 animate-spin" /> : <MessageSquarePlusIcon className="size-4" />}
                  Send
                </Button>
              </div>
            </form>
          </div>
        </TabsContent>

        <TabsContent value="sources">
          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">Source Management</h2>
            <Separator className="my-3" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(sources ?? []).map((source) => {
                const href = source.url ?? source.storageDownloadUrl
                return (
                  <div key={source._id} className="rounded-lg border p-3">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="line-clamp-2 text-sm font-medium hover:underline"
                      >
                        {source.title}
                      </a>
                    ) : (
                      <p className="line-clamp-2 text-sm font-medium">{source.title}</p>
                    )}
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      {source.status}
                      {href && <ExternalLinkIcon className="size-3" />}
                    </p>
                    {source.error && (
                      <p className="mt-2 line-clamp-4 text-xs text-destructive">
                        {source.error}
                      </p>
                    )}
                    <Button
                      type="button"
                      className="mt-3"
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleDelete(source._id)}
                    >
                      <Trash2Icon className="size-4" />
                      Delete
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}

export { MentorRoute }

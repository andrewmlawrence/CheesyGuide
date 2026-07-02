import { useAction, useQuery } from "convex/react"
import {
  ExternalLinkIcon,
  FileUpIcon,
  GlobeIcon,
  ImagePlusIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router"
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
import {
  formatSourceDate,
  sourceGroupLabel,
  sourceHref,
  sourceOpensExternally,
  sourceStatusLabel,
  sourceTypeLabel,
} from "@/lib/sources"

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
  images?: ChatImagePreview[]
}

type ChatImagePreview = {
  id: string
  name: string
  mimeType: string
  data: string
  previewUrl: string
}

type UploadQueueItem = {
  id: string
  file: File
  progress: number
  phase: "queued" | "uploading" | "processing" | "complete" | "failed"
  error?: string
}

type SourceTypeFilter = "all" | "document" | "url" | "mentorNote"
type SourceSort = "newest" | "oldest" | "nameAsc" | "nameDesc" | "type"

function crawlModeLabel(mode: "single" | "small" | "section") {
  if (mode === "single") return "Single Page"
  if (mode === "small") return "Small Crawl"
  return "Section Crawl"
}

function uploadStatusLabel(item: UploadQueueItem) {
  if (item.phase === "queued") return "Queued"
  if (item.phase === "uploading") return `Uploading... ${item.progress}%`
  if (item.phase === "processing") return "Saving and queueing AI indexing..."
  if (item.phase === "complete") return "Uploaded"
  return item.error ?? "Upload failed"
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

function uploadDocumentWithProgress(
  url: string,
  formData: FormData,
  onProgress: (progress: number) => void,
  onProcessing: () => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      const progress = Math.round((event.loaded / event.total) * 100)
      onProgress(progress)
      if (progress >= 100) onProcessing()
    }

    request.onload = () => {
      let body: { error?: string } = {}
      try {
        body = request.responseText ? JSON.parse(request.responseText) : {}
      } catch {
        body = {}
      }

      if (request.status >= 200 && request.status < 300) {
        onProgress(100)
        resolve()
        return
      }

      reject(new Error(body.error ?? `Upload failed with status ${request.status}`))
    }

    request.onerror = () => reject(new Error("Upload failed"))
    request.onabort = () => reject(new Error("Upload canceled"))
    request.ontimeout = () => reject(new Error("Upload timed out while the server was processing the document"))
    request.timeout = 120000
    request.open("POST", url)
    request.send(formData)
  })
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
  const reindexSourceDocument = useAction(api.ai.reindexSourceDocument)
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([])
  const [url, setUrl] = useState("")
  const [urlTitle, setUrlTitle] = useState("")
  const [crawlMode, setCrawlMode] = useState<"single" | "small" | "section">("section")
  const [pageLimit, setPageLimit] = useState(50)
  const [sourceSearch, setSourceSearch] = useState("")
  const [sourceTypeFilter, setSourceTypeFilter] = useState<SourceTypeFilter>("all")
  const [sourceSort, setSourceSort] = useState<SourceSort>("newest")
  const [mentorNote, setMentorNote] = useState("")
  const [attachedImages, setAttachedImages] = useState<ChatImagePreview[]>([])
  const [intakeMessages, setIntakeMessages] = useState<IntakeMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Share a design rule, lesson learned, or rough note. I will ask follow-up questions when useful and save the exchange as knowledgebase context.",
    },
  ])
  const [isUploading, setIsUploading] = useState(false)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [isAddingUrl, setIsAddingUrl] = useState(false)
  const [urlImportProgress, setUrlImportProgress] = useState(0)
  const [urlImportPhase, setUrlImportPhase] = useState("")
  const [isSendingNote, setIsSendingNote] = useState(false)
  const [reindexingSourceId, setReindexingSourceId] = useState<string | null>(null)
  const intakeEndRef = useRef<HTMLDivElement | null>(null)
  const sources = useQuery(
    api.knowledge.listSources,
    sessionToken
      ? {
          sessionToken,
          search: sourceSearch || undefined,
          sourceType: sourceTypeFilter === "all" ? undefined : sourceTypeFilter,
        }
      : "skip",
  )
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
    intakeEndRef.current?.scrollIntoView({ block: "end" })
  }, [intakeMessages, isSendingNote])

  function handleFileSelection(files: FileList | null) {
    const selectedFiles = Array.from(files ?? [])
    if (selectedFiles.length === 0) return

    setUploadQueue((queue) => [
      ...queue,
      ...selectedFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        progress: 0,
        phase: "queued" as const,
      })),
    ])
    setFileInputKey((key) => key + 1)
  }

  function updateQueuedFile(id: string, update: Partial<UploadQueueItem>) {
    setUploadQueue((queue) =>
      queue.map((item) => (item.id === id ? { ...item, ...update } : item)),
    )
  }

  function removeQueuedFile(id: string) {
    setUploadQueue((queue) => queue.filter((item) => item.id !== id))
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const filesToUpload = uploadQueue.filter((item) => item.phase !== "complete")
    if (!sessionToken || filesToUpload.length === 0) return

    setIsUploading(true)

    let uploadedCount = 0
    let failedCount = 0

    for (const item of filesToUpload) {
      const formData = new FormData()
      formData.set("sessionToken", sessionToken)
      formData.set("file", item.file)

      updateQueuedFile(item.id, {
        phase: "uploading",
        progress: 0,
        error: undefined,
      })

      try {
        await uploadDocumentWithProgress(
          `${import.meta.env.VITE_CONVEX_SITE_URL}/upload`,
          formData,
          (progress) => updateQueuedFile(item.id, { progress }),
          () => updateQueuedFile(item.id, { phase: "processing", progress: 100 }),
        )
        uploadedCount += 1
        updateQueuedFile(item.id, { phase: "complete", progress: 100 })
      } catch (error) {
        failedCount += 1
        updateQueuedFile(item.id, {
          phase: "failed",
          error: error instanceof Error ? error.message : "Upload failed",
        })
      }
    }

    if (uploadedCount > 0 && failedCount === 0) {
      toast.success(
        uploadedCount === 1
          ? "Document uploaded"
          : `${uploadedCount} documents uploaded`,
      )
      setUploadQueue([])
      setFileInputKey((key) => key + 1)
    } else if (uploadedCount > 0) {
      toast.warning(`${uploadedCount} uploaded, ${failedCount} failed`)
      setUploadQueue((queue) => queue.filter((item) => item.phase !== "complete"))
    } else if (failedCount > 0) {
      toast.error("Upload failed")
    }

    setIsUploading(false)
  }

  async function handleUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sessionToken || !url.trim()) return
    setIsAddingUrl(true)
    setUrlImportProgress(8)
    setUrlImportPhase("Starting crawl...")
    const progressTimer = window.setInterval(() => {
      setUrlImportProgress((current) => {
        if (current < 35) {
          setUrlImportPhase("Crawling pages...")
          return current + 7
        }
        if (current < 70) {
          setUrlImportPhase("Summarizing content...")
          return current + 4
        }
        if (current < 92) {
          setUrlImportPhase("Queueing AI retrieval...")
          return current + 2
        }
        return current
      })
    }, 900)

    try {
      await summarizeUrl({
        sessionToken,
        url,
        title: urlTitle || undefined,
        crawlMode,
        pageLimit: crawlMode === "section" ? pageLimit : undefined,
      })
      setUrlImportProgress(100)
      setUrlImportPhase("URL source added")
      toast.success("URL source added")
      setUrl("")
      setUrlTitle("")
    } catch (error) {
      setUrlImportPhase("URL import failed")
      toast.error(error instanceof Error ? error.message : "URL import failed")
    } finally {
      window.clearInterval(progressTimer)
      setIsAddingUrl(false)
      window.setTimeout(() => {
        setUrlImportProgress(0)
        setUrlImportPhase("")
      }, 1200)
    }
  }

  async function handleMentorNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedNote = mentorNote.trim()
    if (!sessionToken || (!trimmedNote && attachedImages.length === 0)) return
    const noteText = trimmedNote || "Please use the attached image as context for this mentor intake note."
    setIsSendingNote(true)

    const userMessage: IntakeMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: noteText,
      images: attachedImages,
    }
    setIntakeMessages((current) => [...current, userMessage])
    setMentorNote("")
    setAttachedImages([])

    try {
      const result = await mentorIntake({
        sessionToken,
        message: noteText,
        history: intakeHistory,
        images: attachedImages.map((image) => ({
          mimeType: image.mimeType,
          data: image.data,
        })),
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
    try {
      await deleteSource({ sessionToken, sourceId: sourceId as never })
      toast.success("Source deleted")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Source delete failed")
    }
  }

  async function handleReindex(sourceId: string) {
    if (!sessionToken) return
    setReindexingSourceId(sourceId)
    try {
      await reindexSourceDocument({ sessionToken, sourceId: sourceId as never })
      toast.success("Reindex queued")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reindex failed")
    } finally {
      setReindexingSourceId(null)
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
        <TabsList className="w-full flex-wrap justify-start overflow-visible sm:w-fit">
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
              key={fileInputKey}
              className="mt-4"
              type="file"
              multiple
              accept={acceptedDocuments}
              disabled={isUploading}
              onChange={(event) => handleFileSelection(event.currentTarget.files)}
            />
            {uploadQueue.length > 0 && (
              <div className="mt-4 space-y-3">
                {uploadQueue.map((item) => (
                  <div key={item.id} className="rounded-md border bg-background p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {uploadStatusLabel(item)}
                        </p>
                      </div>
                      {!isUploading && item.phase !== "complete" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeQueuedFile(item.id)}
                          aria-label={`Remove ${item.file.name}`}
                        >
                          <XIcon className="size-4" />
                        </Button>
                      )}
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Button className="mt-4" type="submit" disabled={uploadQueue.length === 0 || isUploading}>
              {isUploading ? <Loader2Icon className="size-4 animate-spin" /> : <FileUpIcon className="size-4" />}
              {isUploading
                ? "Uploading"
                : uploadQueue.length > 1
                  ? `Upload ${uploadQueue.length} documents`
                  : "Upload"}
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
            {(isAddingUrl || urlImportProgress > 0) && (
              <div className="mt-4 rounded-md border bg-background p-3">
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{urlImportPhase || "Preparing URL import..."}</span>
                  <span>{urlImportProgress}%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${urlImportProgress}%` }}
                  />
                </div>
              </div>
            )}
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
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
                placeholder="Describe a best practice, design rule, lesson learned, or engineering decision..."
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
                  className={`inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition hover:bg-muted ${isSendingNote ? "pointer-events-none opacity-50" : ""}`}
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
                <Button type="submit" disabled={isSendingNote}>
                  {isSendingNote ? <Loader2Icon className="size-4 animate-spin" /> : <MessageSquarePlusIcon className="size-4" />}
                  Send
                </Button>
              </div>
            </form>
          </div>
        </TabsContent>

        <TabsContent value="sources">
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <div className="space-y-1">
              <h2 className="text-sm font-medium">Source Management</h2>
              <p className="text-sm text-muted-foreground">
                Search source names and stored knowledge text, then filter or sort
                the library by resource type.
              </p>
            </div>
            <Separator className="my-3" />

            <div className="grid gap-3 lg:grid-cols-[1fr_12rem_12rem]">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={sourceSearch}
                  onChange={(event) => setSourceSearch(event.currentTarget.value)}
                  placeholder="Search by title, summary, or stored textbook keywords..."
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
                  <SelectItem value="newest">Newest First</SelectItem>
                  <SelectItem value="oldest">Oldest First</SelectItem>
                  <SelectItem value="nameAsc">Name A-Z</SelectItem>
                  <SelectItem value="nameDesc">Name Z-A</SelectItem>
                  <SelectItem value="type">Type</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-5">
              {groupedSources.map((group) => (
                <section key={group.label} className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">{group.label}</h3>
                    <p className="text-xs text-muted-foreground">
                      {group.sources.length} source{group.sources.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {group.sources.map((source) => {
                      const href = sourceHref(source)
                      const external = sourceOpensExternally(source)
                      const titleContent = (
                        <>
                          <span className="line-clamp-2 text-sm font-medium">
                            {source.title}
                          </span>
                          {external && <ExternalLinkIcon className="mt-0.5 size-3 shrink-0" />}
                        </>
                      )

                      return (
                        <article key={source._id} className="rounded-lg border p-3">
                          {external ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-start gap-1.5 hover:underline"
                            >
                              {titleContent}
                            </a>
                          ) : (
                            <Link
                              to={href}
                              className="flex items-start gap-1.5 hover:underline"
                            >
                              {titleContent}
                            </Link>
                          )}
                          <p className="mt-2 text-xs text-muted-foreground">
                            {sourceTypeLabel(source)} / {sourceStatusLabel(source)} / Added{" "}
                            {formatSourceDate(source.createdAt)}
                          </p>
                          {source.summary && (
                            <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
                              {source.summary}
                            </p>
                          )}
                          {source.error && (
                            <p className="mt-2 line-clamp-4 text-xs text-destructive">
                              {source.error}
                            </p>
                          )}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {source.sourceType === "document" && source.storageDownloadUrl && (
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={reindexingSourceId === source._id}
                                onClick={() => void handleReindex(source._id)}
                              >
                                {reindexingSourceId === source._id ? (
                                  <Loader2Icon className="size-4 animate-spin" />
                                ) : (
                                  <RefreshCwIcon className="size-4" />
                                )}
                                Reindex
                              </Button>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => void handleDelete(source._id)}
                            >
                              <Trash2Icon className="size-4" />
                              Delete
                            </Button>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </section>
              ))}
              {groupedSources.length === 0 && (
                <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No sources match those filters.
                </p>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}

export { MentorRoute }

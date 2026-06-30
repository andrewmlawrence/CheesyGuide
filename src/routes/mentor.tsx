import { useAction, useMutation, useQuery } from "convex/react"
import {
  FileUpIcon,
  GlobeIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  Trash2Icon,
} from "lucide-react"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"

import { ProtectedRoute } from "@/components/protected-route"
import { useSession } from "@/components/session-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
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
  const deleteSource = useMutation(api.knowledge.deleteSource)
  const sources = useQuery(
    api.knowledge.listSources,
    sessionToken ? { sessionToken } : "skip",
  )
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [url, setUrl] = useState("")
  const [urlTitle, setUrlTitle] = useState("")
  const [mentorNote, setMentorNote] = useState("")
  const [intakeReply, setIntakeReply] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const [isAddingUrl, setIsAddingUrl] = useState(false)
  const [isSendingNote, setIsSendingNote] = useState(false)

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
    if (!sessionToken || !mentorNote.trim()) return
    setIsSendingNote(true)

    try {
      const result = await mentorIntake({ sessionToken, message: mentorNote })
      setIntakeReply(result.answer)
      setMentorNote("")
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
    <section className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-8">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Mentor portal</p>
          <h1 className="text-3xl font-medium">Add knowledge</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Upload documents, capture URL sources, and use conversational intake
            to turn mentor expertise into searchable knowledgebase entries.
          </p>
        </div>
        <form className="rounded-lg border p-4" onSubmit={handleUpload}>
          <div className="flex items-center gap-2">
            <FileUpIcon className="size-4 text-muted-foreground" />
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
        <form className="rounded-lg border p-4" onSubmit={handleUrl}>
          <div className="flex items-center gap-2">
            <GlobeIcon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">URL source</h2>
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
          <Button className="mt-4" type="submit" disabled={isAddingUrl}>
            {isAddingUrl ? <Loader2Icon className="size-4 animate-spin" /> : <GlobeIcon className="size-4" />}
            Add URL
          </Button>
        </form>
        <form className="rounded-lg border p-4" onSubmit={handleMentorNote}>
          <div className="flex items-center gap-2">
            <MessageSquarePlusIcon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Conversational mentor intake</h2>
          </div>
          <Textarea
            className="mt-4 min-h-32"
            value={mentorNote}
            onChange={(event) => setMentorNote(event.currentTarget.value)}
            placeholder="Describe a best practice, design rule, lesson learned, or engineering decision..."
            required
          />
          <Button className="mt-4" type="submit" disabled={isSendingNote}>
            {isSendingNote ? <Loader2Icon className="size-4 animate-spin" /> : <MessageSquarePlusIcon className="size-4" />}
            Send to intake AI
          </Button>
          {intakeReply && (
            <div className="mt-4 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm leading-6">
              {intakeReply}
            </div>
          )}
        </form>
      </div>
      <aside className="h-fit rounded-lg border p-4">
        <h2 className="text-sm font-medium">Manage sources</h2>
        <Separator className="my-3" />
        <div className="space-y-3">
          {(sources ?? []).map((source) => (
            <div key={source._id} className="rounded-lg border p-3">
              <p className="line-clamp-1 text-sm font-medium">{source.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{source.status}</p>
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
          ))}
        </div>
      </aside>
    </section>
  )
}

export { MentorRoute }

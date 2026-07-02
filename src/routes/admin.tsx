import { useAction, useQuery } from "convex/react"
import { DatabaseIcon, Loader2Icon, RefreshCwIcon, SaveIcon } from "lucide-react"
import { type FormEvent, useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { ProtectedRoute } from "@/components/protected-route"
import { useSession } from "@/components/session-provider"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/convex"

type FileSearchDiagnostics = {
  configured: boolean
  store?: {
    name?: string
    displayName?: string
    activeDocumentsCount?: string
    pendingDocumentsCount?: string
    failedDocumentsCount?: string
  }
  documents: Array<{
    name?: string
    displayName?: string
    createTime?: string
    updateTime?: string
  }>
}

function AdminRoute() {
  return (
    <ProtectedRoute mentorOnly>
      <AdminSettings />
    </ProtectedRoute>
  )
}

function AdminSettings() {
  const { sessionToken } = useSession()
  const settings = useQuery(
    api.auth.getSettings,
    sessionToken ? { sessionToken } : "skip",
  )
  const updateSettings = useAction(api.auth.updateSettings)
  const getFileSearchDiagnostics = useAction(api.ai.getFileSearchDiagnostics)
  const [studentPassword, setStudentPassword] = useState("")
  const [mentorPassword, setMentorPassword] = useState("")
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash")
  const [storageBucket, setStorageBucket] = useState("cheesyguide-e2aee.firebasestorage.app")
  const [fileSearchStoreName, setFileSearchStoreName] = useState("")
  const [allowUrlSources, setAllowUrlSources] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = useState(false)
  const [diagnostics, setDiagnostics] = useState<FileSearchDiagnostics | null>(null)

  useEffect(() => {
    if (!settings) return
    setGeminiModel(settings.geminiModel)
    setStorageBucket(settings.storageBucket)
    setFileSearchStoreName(settings.fileSearchStoreName)
    setAllowUrlSources(settings.allowUrlSources)
  }, [settings])

  const loadDiagnostics = useCallback(async () => {
    if (!sessionToken) return
    setIsLoadingDiagnostics(true)
    try {
      setDiagnostics(await getFileSearchDiagnostics({ sessionToken }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load diagnostics")
    } finally {
      setIsLoadingDiagnostics(false)
    }
  }, [getFileSearchDiagnostics, sessionToken])

  useEffect(() => {
    if (!sessionToken) return
    void loadDiagnostics()
  }, [loadDiagnostics, sessionToken])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sessionToken) return
    setIsSaving(true)

    try {
      await updateSettings({
        sessionToken,
        studentPassword: studentPassword || undefined,
        mentorPassword: mentorPassword || undefined,
        geminiModel,
        storageBucket,
        fileSearchStoreName,
        allowUrlSources,
      })
      toast.success("Settings saved")
      setStudentPassword("")
      setMentorPassword("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Settings save failed")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Admin</p>
        <h1 className="text-3xl font-medium">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Change shared passwords and integration settings. Leave password
          fields blank to keep the current values.
        </p>
      </div>
      <form className="mt-8 space-y-5 rounded-lg border p-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="student-password">Student password</Label>
            <Input
              id="student-password"
              type="password"
              placeholder="Leave unchanged"
              value={studentPassword}
              onChange={(event) => setStudentPassword(event.currentTarget.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mentor-password">Mentor password</Label>
            <Input
              id="mentor-password"
              type="password"
              placeholder="Leave unchanged"
              value={mentorPassword}
              onChange={(event) => setMentorPassword(event.currentTarget.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="gemini-model">Gemini model</Label>
          <Input
            id="gemini-model"
            value={geminiModel}
            onChange={(event) => setGeminiModel(event.currentTarget.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="storage-bucket">Firebase Storage bucket</Label>
          <Input
            id="storage-bucket"
            value={storageBucket}
            onChange={(event) => setStorageBucket(event.currentTarget.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="file-search-store">Gemini File Search store</Label>
          <Input
            id="file-search-store"
            value={fileSearchStoreName}
            onChange={(event) => setFileSearchStoreName(event.currentTarget.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={allowUrlSources}
            onCheckedChange={(checked) => setAllowUrlSources(Boolean(checked))}
          />
          Allow mentor URL sources
        </label>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? <Loader2Icon className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
          Save settings
        </Button>
      </form>
      <section className="mt-6 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <DatabaseIcon className="size-4 text-primary" />
            <h2 className="text-sm font-medium">File Search diagnostics</h2>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isLoadingDiagnostics}
            onClick={() => void loadDiagnostics()}
          >
            {isLoadingDiagnostics ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-4" />
            )}
            Refresh
          </Button>
        </div>
        {!diagnostics ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Diagnostics have not loaded yet.
          </p>
        ) : !diagnostics.configured ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Gemini File Search is not configured for this deployment.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Active</p>
                <p className="font-medium">{diagnostics.store?.activeDocumentsCount ?? "0"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="font-medium">{diagnostics.store?.pendingDocumentsCount ?? "0"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Failed</p>
                <p className="font-medium">{diagnostics.store?.failedDocumentsCount ?? "0"}</p>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {diagnostics.store?.displayName ?? diagnostics.store?.name}
              </p>
              {diagnostics.documents.length > 0 ? (
                diagnostics.documents.map((document) => (
                  <article key={document.name} className="rounded-md border p-3">
                    <p className="text-sm font-medium">
                      {document.displayName ?? document.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Updated {document.updateTime ?? "unknown"}
                    </p>
                  </article>
                ))
              ) : (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  No File Search documents were returned.
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </section>
  )
}

export { AdminRoute }

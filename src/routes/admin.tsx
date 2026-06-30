import { useAction, useQuery } from "convex/react"
import { Loader2Icon, SaveIcon } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"

import { ProtectedRoute } from "@/components/protected-route"
import { useSession } from "@/components/session-provider"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/convex"

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
  const [studentPassword, setStudentPassword] = useState("")
  const [mentorPassword, setMentorPassword] = useState("")
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash")
  const [driveFolderId, setDriveFolderId] = useState("")
  const [fileSearchStoreName, setFileSearchStoreName] = useState("")
  const [allowUrlSources, setAllowUrlSources] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!settings) return
    setGeminiModel(settings.geminiModel)
    setDriveFolderId(settings.driveFolderId)
    setFileSearchStoreName(settings.fileSearchStoreName)
    setAllowUrlSources(settings.allowUrlSources)
  }, [settings])

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
        driveFolderId,
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
              placeholder="CheddarKids"
              value={studentPassword}
              onChange={(event) => setStudentPassword(event.currentTarget.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mentor-password">Mentor password</Label>
            <Input
              id="mentor-password"
              type="password"
              placeholder="CheeseBoard"
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
          <Label htmlFor="drive-folder">Google Drive folder ID</Label>
          <Input
            id="drive-folder"
            value={driveFolderId}
            onChange={(event) => setDriveFolderId(event.currentTarget.value)}
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
    </section>
  )
}

export { AdminRoute }

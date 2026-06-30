import { LockIcon, LogInIcon } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Navigate, useNavigate } from "react-router"
import { toast } from "sonner"

import { useSession } from "@/components/session-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function LoginRoute() {
  const { login, role } = useSession()
  const navigate = useNavigate()
  const [password, setPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (role) {
    return <Navigate to={role === "mentor" ? "/mentor" : "/"} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    try {
      const nextRole = await login(password)
      toast.success(nextRole === "mentor" ? "Mentor access unlocked" : "Student access unlocked")
      navigate(nextRole === "mentor" ? "/mentor" : "/")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Login failed")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-sm flex-col justify-center gap-6 px-6">
      <div className="space-y-2">
        <LockIcon className="size-5 text-muted-foreground" />
        <h1 className="text-2xl font-medium">Enter CheesyGuide</h1>
        <p className="text-sm text-muted-foreground">
          Use the student or mentor shared password.
        </p>
      </div>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          <LogInIcon className="size-4" />
          Unlock
        </Button>
      </form>
    </section>
  )
}

export { LoginRoute }

import { RouterProvider } from "react-router"

import { SessionProvider } from "@/components/session-provider"
import { router } from "@/router"

function App() {
  return (
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  )
}

export default App

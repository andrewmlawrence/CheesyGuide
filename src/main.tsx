import { ConvexProvider } from "convex/react"
import { ConvexReactClient } from "convex/react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "@/App"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import "@/index.css"

const convexUrl = import.meta.env.VITE_CONVEX_URL

if (!convexUrl) {
  throw new Error("Missing VITE_CONVEX_URL. Run `bunx convex dev` first.")
}

const convex = new ConvexReactClient(convexUrl)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </ConvexProvider>
  </StrictMode>,
)

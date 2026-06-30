import { createBrowserRouter } from "react-router"

import { AdminRoute } from "@/routes/admin"
import { HomeRoute } from "@/routes/home"
import { LoginRoute } from "@/routes/login"
import { MentorRoute } from "@/routes/mentor"
import { RootLayout } from "@/routes/root"
import { SourceRoute } from "@/routes/source"

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <HomeRoute />,
      },
      {
        path: "login",
        element: <LoginRoute />,
      },
      {
        path: "mentor",
        element: <MentorRoute />,
      },
      {
        path: "admin",
        element: <AdminRoute />,
      },
      {
        path: "sources/:sourceId",
        element: <SourceRoute />,
      },
    ],
  },
])

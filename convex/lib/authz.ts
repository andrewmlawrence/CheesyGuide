import type { GenericDatabaseReader } from "convex/server"
import type { DataModel } from "../_generated/dataModel"
import { hashToken } from "./security"

export type Role = "student" | "mentor"

export async function requireSession(
  db: GenericDatabaseReader<DataModel>,
  sessionToken: string,
  minimumRole: Role = "student",
) {
  const session = await db
    .query("sessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", hashToken(sessionToken)))
    .unique()

  if (!session || session.expiresAt <= Date.now()) {
    throw new Error("Login required")
  }

  if (minimumRole === "mentor" && session.role !== "mentor") {
    throw new Error("Mentor access required")
  }

  return session
}

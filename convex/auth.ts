import { internal } from "./_generated/api"
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { v } from "convex/values"
import { hashPassword, hashToken, randomSalt } from "./lib/security"
import type { Doc } from "./_generated/dataModel"

const SETTINGS_KEY = "global"
const STUDENT_PASSWORD = "CheddarKids"
const MENTOR_PASSWORD = "CheeseBoard"
const SESSION_TTL_MS = 1000 * 60 * 60 * 12

const roleValidator = v.union(v.literal("student"), v.literal("mentor"))
type SettingsPatch = Partial<
  Pick<
    Doc<"appSettings">,
    | "studentPasswordHash"
    | "studentPasswordSalt"
    | "mentorPasswordHash"
    | "mentorPasswordSalt"
    | "geminiModel"
    | "driveFolderId"
    | "fileSearchStoreName"
    | "allowUrlSources"
    | "updatedAt"
  >
>

export const ensureSettings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .unique()

    if (existing) {
      return existing
    }

    const now = Date.now()
    const studentPasswordSalt = randomSalt()
    const mentorPasswordSalt = randomSalt()
    const settings = {
      key: SETTINGS_KEY,
      studentPasswordHash: hashPassword(STUDENT_PASSWORD, studentPasswordSalt),
      studentPasswordSalt,
      mentorPasswordHash: hashPassword(MENTOR_PASSWORD, mentorPasswordSalt),
      mentorPasswordSalt,
      geminiModel: "gemini-2.5-flash",
      allowUrlSources: true,
      updatedAt: now,
    }

    const id = await ctx.db.insert("appSettings", settings)
    return { _id: id, _creationTime: now, ...settings }
  },
})

export const getSettingsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .unique()
  },
})

export const getSessionInternal = internalQuery({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", hashToken(args.sessionToken)))
      .unique()

    if (!session || session.expiresAt <= Date.now()) {
      return null
    }

    return session
  },
})

export const createSession = internalMutation({
  args: {
    sessionToken: v.string(),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    await ctx.db.insert("sessions", {
      tokenHash: hashToken(args.sessionToken),
      role: args.role,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    })
  },
})

export const updateSettingsInternal = internalMutation({
  args: {
    sessionToken: v.string(),
    studentPasswordHash: v.optional(v.string()),
    studentPasswordSalt: v.optional(v.string()),
    mentorPasswordHash: v.optional(v.string()),
    mentorPasswordSalt: v.optional(v.string()),
    geminiModel: v.optional(v.string()),
    driveFolderId: v.optional(v.string()),
    fileSearchStoreName: v.optional(v.string()),
    allowUrlSources: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", hashToken(args.sessionToken)))
      .unique()

    if (!session || session.expiresAt <= Date.now() || session.role !== "mentor") {
      throw new Error("Mentor access required")
    }

    const settings = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .unique()

    if (!settings) {
      throw new Error("Settings are not initialized")
    }

    const patch: SettingsPatch = { updatedAt: Date.now() }

    if (args.studentPasswordHash !== undefined) {
      patch.studentPasswordHash = args.studentPasswordHash
    }
    if (args.studentPasswordSalt !== undefined) {
      patch.studentPasswordSalt = args.studentPasswordSalt
    }
    if (args.mentorPasswordHash !== undefined) {
      patch.mentorPasswordHash = args.mentorPasswordHash
    }
    if (args.mentorPasswordSalt !== undefined) {
      patch.mentorPasswordSalt = args.mentorPasswordSalt
    }
    if (args.geminiModel !== undefined) {
      patch.geminiModel = args.geminiModel
    }
    if (args.driveFolderId !== undefined) {
      patch.driveFolderId = args.driveFolderId
    }
    if (args.fileSearchStoreName !== undefined) {
      patch.fileSearchStoreName = args.fileSearchStoreName
    }
    if (args.allowUrlSources !== undefined) {
      patch.allowUrlSources = args.allowUrlSources
    }

    await ctx.db.patch(settings._id, patch)
  },
})

export const setFileSearchStoreName = internalMutation({
  args: { fileSearchStoreName: v.string() },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .unique()

    if (!settings) {
      throw new Error("Settings are not initialized")
    }

    await ctx.db.patch(settings._id, {
      fileSearchStoreName: args.fileSearchStoreName,
      updatedAt: Date.now(),
    })
  },
})

export const login = action({
  args: { password: v.string() },
  handler: async (ctx, args): Promise<{ sessionToken: string; role: "student" | "mentor" }> => {
    const settings = await ctx.runMutation(internal.auth.ensureSettings, {})
    const studentHash = hashPassword(args.password, settings.studentPasswordSalt)
    const mentorHash = hashPassword(args.password, settings.mentorPasswordSalt)
    const role =
      mentorHash === settings.mentorPasswordHash
        ? "mentor"
        : studentHash === settings.studentPasswordHash
          ? "student"
          : null

    if (role === null) {
      throw new Error("Incorrect password")
    }

    const sessionToken = crypto.randomUUID()
    await ctx.runMutation(internal.auth.createSession, { sessionToken, role })
    return { sessionToken, role }
  },
})

export const logout = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", hashToken(args.sessionToken)))
      .unique()

    if (session) {
      await ctx.db.delete(session._id)
    }
  },
})

export const viewer = query({
  args: { sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.sessionToken) {
      return null
    }

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", hashToken(args.sessionToken!)))
      .unique()

    if (!session || session.expiresAt <= Date.now()) {
      return null
    }

    return {
      role: session.role,
      expiresAt: session.expiresAt,
    }
  },
})

export const getSettings = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", hashToken(args.sessionToken)))
      .unique()

    if (!session || session.expiresAt <= Date.now() || session.role !== "mentor") {
      throw new Error("Mentor access required")
    }

    const settings = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .unique()

    return settings
      ? {
          geminiModel: settings.geminiModel,
          driveFolderId: settings.driveFolderId ?? "",
          fileSearchStoreName: settings.fileSearchStoreName ?? "",
          allowUrlSources: settings.allowUrlSources,
          updatedAt: settings.updatedAt,
        }
      : null
  },
})

export const updateSettings = action({
  args: {
    sessionToken: v.string(),
    studentPassword: v.optional(v.string()),
    mentorPassword: v.optional(v.string()),
    geminiModel: v.optional(v.string()),
    driveFolderId: v.optional(v.string()),
    fileSearchStoreName: v.optional(v.string()),
    allowUrlSources: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const patch: {
      sessionToken: string
      studentPasswordHash?: string
      studentPasswordSalt?: string
      mentorPasswordHash?: string
      mentorPasswordSalt?: string
      geminiModel?: string
      driveFolderId?: string
      fileSearchStoreName?: string
      allowUrlSources?: boolean
    } = { sessionToken: args.sessionToken }

    if (args.studentPassword) {
      if (args.studentPassword.length < 8) {
        throw new Error("Student password must be at least 8 characters")
      }
      patch.studentPasswordSalt = randomSalt()
      patch.studentPasswordHash = hashPassword(args.studentPassword, patch.studentPasswordSalt)
    }

    if (args.mentorPassword) {
      if (args.mentorPassword.length < 8) {
        throw new Error("Mentor password must be at least 8 characters")
      }
      patch.mentorPasswordSalt = randomSalt()
      patch.mentorPasswordHash = hashPassword(args.mentorPassword, patch.mentorPasswordSalt)
    }

    if (args.geminiModel !== undefined) patch.geminiModel = args.geminiModel
    if (args.driveFolderId !== undefined) patch.driveFolderId = args.driveFolderId
    if (args.fileSearchStoreName !== undefined) patch.fileSearchStoreName = args.fileSearchStoreName
    if (args.allowUrlSources !== undefined) patch.allowUrlSources = args.allowUrlSources

    await ctx.runMutation(internal.auth.updateSettingsInternal, patch)
  },
})

import { authTables } from "@convex-dev/auth/server"
import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  ...authTables,
  appSettings: defineTable({
    key: v.string(),
    studentPasswordHash: v.string(),
    studentPasswordSalt: v.string(),
    mentorPasswordHash: v.string(),
    mentorPasswordSalt: v.string(),
    geminiModel: v.string(),
    storageBucket: v.optional(v.string()),
    driveFolderId: v.optional(v.string()),
    fileSearchStoreName: v.optional(v.string()),
    allowUrlSources: v.boolean(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  sessions: defineTable({
    tokenHash: v.string(),
    role: v.union(v.literal("student"), v.literal("mentor")),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_expiresAt", ["expiresAt"]),
  knowledgeSources: defineTable({
    title: v.string(),
    sourceType: v.union(v.literal("document"), v.literal("url"), v.literal("mentorNote")),
    status: v.union(
      v.literal("uploaded"),
      v.literal("indexed"),
      v.literal("failed"),
      v.literal("pending"),
      v.literal("integration_missing"),
    ),
    summary: v.optional(v.string()),
    topics: v.array(v.string()),
    url: v.optional(v.string()),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    size: v.optional(v.number()),
    storageBucket: v.optional(v.string()),
    storagePath: v.optional(v.string()),
    storageDownloadUrl: v.optional(v.string()),
    driveFileId: v.optional(v.string()),
    driveWebViewLink: v.optional(v.string()),
    geminiOperationName: v.optional(v.string()),
    geminiDocumentName: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_sourceType", ["sourceType"])
    .searchIndex("search_sources", {
      searchField: "title",
      filterFields: ["sourceType", "status"],
    }),
  knowledgeEntries: defineTable({
    sourceId: v.optional(v.id("knowledgeSources")),
    entryType: v.union(v.literal("summary"), v.literal("textbook"), v.literal("note")),
    title: v.string(),
    body: v.string(),
    topics: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sourceId", ["sourceId"])
    .searchIndex("search_entries", {
      searchField: "body",
      filterFields: ["entryType"],
    }),
  aiConversations: defineTable({
    mode: v.union(v.literal("teacher"), v.literal("mentorIntake")),
    sessionTokenHash: v.string(),
    title: v.string(),
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
        createdAt: v.number(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_sessionTokenHash_and_mode", ["sessionTokenHash", "mode"]),
})

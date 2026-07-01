import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { v } from "convex/values"
import { requireSession } from "./lib/authz"

const statusValidator = v.union(
  v.literal("uploaded"),
  v.literal("indexed"),
  v.literal("failed"),
  v.literal("pending"),
  v.literal("integration_missing"),
)

const sourceTypeValidator = v.union(
  v.literal("document"),
  v.literal("url"),
  v.literal("mentorNote"),
)

export const listSources = query({
  args: {
    sessionToken: v.string(),
    search: v.optional(v.string()),
    sourceType: v.optional(sourceTypeValidator),
  },
  handler: async (ctx, args) => {
    await requireSession(ctx.db, args.sessionToken)

    const search = args.search?.trim()
    const results = search
      ? await ctx.db
          .query("knowledgeSources")
          .withSearchIndex("search_sources", (q) => {
            const searched = q.search("title", search)
            return args.sourceType ? searched.eq("sourceType", args.sourceType) : searched
          })
          .take(25)
      : await ctx.db.query("knowledgeSources").order("desc").take(25)

    return args.sourceType && !search
      ? results.filter((source) => source.sourceType === args.sourceType)
      : results
  },
})

export const listEntries = query({
  args: {
    sessionToken: v.string(),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSession(ctx.db, args.sessionToken)
    const search = args.search?.trim()

    if (search) {
      return await ctx.db
        .query("knowledgeEntries")
        .withSearchIndex("search_entries", (q) => q.search("body", search))
        .take(25)
    }

    return await ctx.db.query("knowledgeEntries").order("desc").take(25)
  },
})

export const getSource = query({
  args: {
    sessionToken: v.string(),
    sourceId: v.id("knowledgeSources"),
  },
  handler: async (ctx, args) => {
    await requireSession(ctx.db, args.sessionToken)
    const source = await ctx.db.get(args.sourceId)
    const entries = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_sourceId", (q) => q.eq("sourceId", args.sourceId))
      .take(20)
    return { source, entries }
  },
})

export const getSourceInternal = internalQuery({
  args: {
    sourceId: v.id("knowledgeSources"),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId)
    return { source }
  },
})

export const searchKnowledgeInternal = internalQuery({
  args: { search: v.string() },
  handler: async (ctx, args) => {
    const search = args.search.trim()
    const sources = search
      ? await ctx.db
          .query("knowledgeSources")
          .withSearchIndex("search_sources", (q) => q.search("title", search))
          .take(8)
      : await ctx.db.query("knowledgeSources").order("desc").take(8)
    const entries = search
      ? await ctx.db
          .query("knowledgeEntries")
          .withSearchIndex("search_entries", (q) => q.search("body", search))
          .take(8)
      : await ctx.db.query("knowledgeEntries").order("desc").take(8)
    return { sources, entries }
  },
})

export const createSource = internalMutation({
  args: {
    title: v.string(),
    sourceType: sourceTypeValidator,
    status: statusValidator,
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
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    return await ctx.db.insert("knowledgeSources", {
      ...args,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const patchSource = internalMutation({
  args: {
    sourceId: v.id("knowledgeSources"),
    title: v.optional(v.string()),
    status: v.optional(statusValidator),
    summary: v.optional(v.string()),
    topics: v.optional(v.array(v.string())),
    storageBucket: v.optional(v.string()),
    storagePath: v.optional(v.string()),
    storageDownloadUrl: v.optional(v.string()),
    driveFileId: v.optional(v.string()),
    driveWebViewLink: v.optional(v.string()),
    geminiOperationName: v.optional(v.string()),
    geminiDocumentName: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { sourceId, ...patch } = args
    await ctx.db.patch(sourceId, { ...patch, updatedAt: Date.now() })
  },
})

export const createEntry = internalMutation({
  args: {
    sourceId: v.optional(v.id("knowledgeSources")),
    entryType: v.union(v.literal("summary"), v.literal("textbook"), v.literal("note")),
    title: v.string(),
    body: v.string(),
    topics: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    return await ctx.db.insert("knowledgeEntries", {
      ...args,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const deleteSource = mutation({
  args: {
    sessionToken: v.string(),
    sourceId: v.id("knowledgeSources"),
  },
  handler: async (ctx, args) => {
    await requireSession(ctx.db, args.sessionToken, "mentor")
    const entries = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_sourceId", (q) => q.eq("sourceId", args.sourceId))
      .take(100)

    for (const entry of entries) {
      await ctx.db.delete(entry._id)
    }

    await ctx.db.delete(args.sourceId)
  },
})

export const deleteSourceInternal = internalMutation({
  args: {
    sourceId: v.id("knowledgeSources"),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("knowledgeEntries")
      .withIndex("by_sourceId", (q) => q.eq("sourceId", args.sourceId))
      .take(100)

    for (const entry of entries) {
      await ctx.db.delete(entry._id)
    }

    await ctx.db.delete(args.sourceId)
  },
})

export const updateSource = mutation({
  args: {
    sessionToken: v.string(),
    sourceId: v.id("knowledgeSources"),
    title: v.string(),
    summary: v.optional(v.string()),
    topics: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSession(ctx.db, args.sessionToken, "mentor")
    await ctx.db.patch(args.sourceId, {
      title: args.title,
      summary: args.summary,
      topics: args.topics,
      updatedAt: Date.now(),
    })
  },
})

"use node";

import { GoogleGenAI } from "@google/genai"
import { internal } from "./_generated/api"
import { action, internalAction } from "./_generated/server"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"

type KnowledgeHit = {
  title: string
  summary?: string
  body?: string
  url?: string
  storageDownloadUrl?: string
}

function getAi() {
  const apiKey = process.env.GEMINI_API_KEY
  return apiKey ? new GoogleGenAI({ apiKey }) : null
}

function compactContext(hits: KnowledgeHit[]) {
  return hits
    .map((hit, index) => {
      const text = hit.body ?? hit.summary ?? ""
      return `[${index + 1}] ${hit.title}\n${text}${hit.url ? `\nURL: ${hit.url}` : ""}`
    })
    .join("\n\n")
}

function parseTopics(text: string) {
  return Array.from(
    new Set(
      text
        .split(/[,#\n]/)
        .map((topic) => topic.trim())
        .filter(Boolean)
        .slice(0, 8),
    ),
  )
}

export const indexStorageDocument = internalAction({
  args: {
    sourceId: v.id("knowledgeSources"),
    fileName: v.string(),
    mimeType: v.string(),
    storageDownloadUrl: v.string(),
    fileSearchStoreName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ai = getAi()
    if (!ai) {
      await ctx.runMutation(internal.knowledge.patchSource, {
        sourceId: args.sourceId,
        status: "integration_missing",
        summary:
          "Document uploaded to Firebase Storage, but Gemini is not configured yet.",
      })
      return
    }

    try {
      let fileSearchStoreName = args.fileSearchStoreName
      if (!fileSearchStoreName) {
        const created = await ai.fileSearchStores.create({
          config: { displayName: "CheesyGuide FRC 254 Knowledgebase" },
        })
        fileSearchStoreName = created.name
      }

      if (!fileSearchStoreName) {
        throw new Error("Gemini did not return a File Search store name")
      }

      const response = await fetch(args.storageDownloadUrl)
      if (!response.ok) {
        throw new Error(`Could not read uploaded file from Storage: ${response.status}`)
      }

      const fileBlob = new Blob([await response.arrayBuffer()], {
        type: args.mimeType,
      })
      const operation = await ai.fileSearchStores.uploadToFileSearchStore({
        fileSearchStoreName,
        file: fileBlob,
        config: {
          displayName: args.fileName,
          mimeType: args.mimeType,
        },
      })

      if (!args.fileSearchStoreName) {
        await ctx.runMutation(internal.auth.setFileSearchStoreName, {
          fileSearchStoreName,
        })
      }

      await ctx.runMutation(internal.knowledge.patchSource, {
        sourceId: args.sourceId,
        status: "indexed",
        summary: "Document uploaded to Firebase Storage and indexed for AI retrieval.",
        geminiOperationName: operation.name,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gemini indexing failed"
      await ctx.runMutation(internal.knowledge.patchSource, {
        sourceId: args.sourceId,
        status: "failed",
        error: message,
      })
      throw error
    }
  },
})

export const askTeacher = action({
  args: {
    sessionToken: v.string(),
    question: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ answer: string; citations: string[] }> => {
    const session = await ctx.runQuery(internal.auth.getSessionInternal, {
      sessionToken: args.sessionToken,
    })
    if (!session) {
      throw new Error("Login required")
    }

    const settings: { geminiModel: string } | null = await ctx.runQuery(
      internal.auth.getSettingsInternal,
      {},
    )
    const knowledge: { sources: KnowledgeHit[]; entries: KnowledgeHit[] } =
      await ctx.runQuery(internal.knowledge.searchKnowledgeInternal, {
      search: args.question,
    })
    const hits: KnowledgeHit[] = [
      ...knowledge.sources.map((source) => ({
        title: source.title,
        summary: source.summary,
        url: source.url ?? source.storageDownloadUrl,
      })),
      ...knowledge.entries.map((entry) => ({
        title: entry.title,
        body: entry.body,
      })),
    ]

    const ai = getAi()
    if (!ai) {
      return {
        answer:
          "Gemini is not configured yet. Add GEMINI_API_KEY in Convex environment variables, then ask again.\n\nRelevant stored knowledge:\n\n" +
          compactContext(hits),
        citations: hits.map((hit) => hit.title),
      }
    }

    const response = await ai.models.generateContent({
      model: settings?.geminiModel ?? "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "You are CheesyGuide, an FRC 254 engineering teacher. Answer using the stored knowledgebase context first. If the context is incomplete, say what is missing and provide careful general engineering guidance.\n\nKnowledgebase context:\n" +
                compactContext(hits) +
                "\n\nStudent question:\n" +
                args.question,
            },
          ],
        },
      ],
    })

    return {
      answer: response.text ?? "No response was returned.",
      citations: hits.map((hit) => hit.title),
    }
  },
})

export const mentorIntake = action({
  args: {
    sessionToken: v.string(),
    message: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ answer: string; sourceId: Id<"knowledgeSources"> }> => {
    const session = await ctx.runQuery(internal.auth.getSessionInternal, {
      sessionToken: args.sessionToken,
    })
    if (!session || session.role !== "mentor") {
      throw new Error("Mentor access required")
    }

    const settings: { geminiModel: string } | null = await ctx.runQuery(
      internal.auth.getSettingsInternal,
      {},
    )
    const ai = getAi()
    const prompt =
      "You are helping an FRC 254 mentor add best-practice knowledge to a knowledgebase. Ask one useful follow-up question if the note is incomplete. If it is complete enough, return a concise summary, topics, and a suggested title.\n\nMentor note:\n" +
      args.message

    const answer: string = ai
      ? ((await ai.models.generateContent({
          model: settings?.geminiModel ?? "gemini-2.5-flash",
          contents: prompt,
        })).text ?? "No response was returned.")
      : "Gemini is not configured yet. I saved this note as a mentor source, and it can be refined after GEMINI_API_KEY is set."

    const sourceId: Id<"knowledgeSources"> = await ctx.runMutation(internal.knowledge.createSource, {
      title: args.message.slice(0, 80) || "Mentor note",
      sourceType: "mentorNote",
      status: ai ? "indexed" : "integration_missing",
      summary: answer,
      topics: parseTopics(args.message),
    })
    await ctx.runMutation(internal.knowledge.createEntry, {
      sourceId,
      entryType: "note",
      title: args.message.slice(0, 80) || "Mentor note",
      body: `${args.message}\n\nAI intake response:\n${answer}`,
      topics: parseTopics(args.message),
    })

    return { answer, sourceId }
  },
})

export const summarizeUrl = action({
  args: {
    sessionToken: v.string(),
    url: v.string(),
    title: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ sourceId: Id<"knowledgeSources">; summary: string }> => {
    const session = await ctx.runQuery(internal.auth.getSessionInternal, {
      sessionToken: args.sessionToken,
    })
    if (!session || session.role !== "mentor") {
      throw new Error("Mentor access required")
    }

    const settings: {
      geminiModel: string
      allowUrlSources: boolean
    } | null = await ctx.runQuery(internal.auth.getSettingsInternal, {})
    if (settings && !settings.allowUrlSources) {
      throw new Error("URL sources are disabled")
    }

    const sourceId: Id<"knowledgeSources"> = await ctx.runMutation(internal.knowledge.createSource, {
      title: args.title || args.url,
      sourceType: "url",
      status: "pending",
      topics: [],
      url: args.url,
    })

    try {
      const fetched = await fetch(args.url)
      const html = await fetched.text()
      const visibleText = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, 12000)
      const ai = getAi()
      const summary: string = ai
        ? ((await ai.models.generateContent({
            model: settings?.geminiModel ?? "gemini-2.5-flash",
            contents:
              "Summarize this web page for an FRC 254 engineering knowledgebase. Include practical engineering takeaways and topics.\n\n" +
              visibleText,
          })).text ?? visibleText.slice(0, 1200))
        : visibleText.slice(0, 1200)
      const topics = parseTopics(summary)

      await ctx.runMutation(internal.knowledge.patchSource, {
        sourceId,
        status: ai ? "indexed" : "integration_missing",
        summary,
        topics,
      })
      await ctx.runMutation(internal.knowledge.createEntry, {
        sourceId,
        entryType: "summary",
        title: args.title || args.url,
        body: summary,
        topics,
      })

      return { sourceId, summary }
    } catch (error) {
      const message = error instanceof Error ? error.message : "URL processing failed"
      await ctx.runMutation(internal.knowledge.patchSource, {
        sourceId,
        status: "failed",
        error: message,
      })
      throw new Error(message)
    }
  },
})

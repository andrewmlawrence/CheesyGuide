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

type TeacherSettings = {
  geminiModel: string
  fileSearchStoreName?: string
}

type TeacherResult = {
  answer: string
  citations: string[]
}

type FileCitationAnnotation = {
  type?: string
  file_name?: string
  fileName?: string
  source?: string
  page_number?: number
  pageNumber?: number
  uri?: string
}

type InteractionContentBlock = {
  type?: string
  text?: string
  annotations?: FileCitationAnnotation[]
}

type InteractionStep = {
  type?: string
  content?: InteractionContentBlock[]
}

type InteractionResponse = {
  steps?: InteractionStep[]
}

type UploadFileSearchOperation = {
  name?: string
  done?: boolean
  error?: Record<string, unknown>
  response?: {
    documentName?: string
  }
}

type FileSearchDocument = {
  name?: string
  displayName?: string
  createTime?: string
  updateTime?: string
}

type FileSearchStore = {
  name?: string
  displayName?: string
  activeDocumentsCount?: string
  pendingDocumentsCount?: string
  failedDocumentsCount?: string
}

type InteractionsClient = {
  create: (params: {
    model: string
    input: string
    tools: Array<{
      type: "file_search"
      file_search_store_names: string[]
      top_k?: number
    }>
  }) => Promise<InteractionResponse>
}

type FileSearchStoresClient = GoogleGenAI["fileSearchStores"] & {
  documents: {
    list: (params: {
      parent: string
      config?: { pageSize?: number }
    }) => Promise<AsyncIterable<FileSearchDocument>>
  }
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

function teacherPrompt(question: string, hits: KnowledgeHit[]) {
  return (
    "You are CheesyGuide, an FRC 254 engineering teacher. Answer robot and engineering questions for students.\n\n" +
    "Use uploaded knowledgebase documents from File Search first, then use the Convex metadata and generated notes below as supporting context. If the knowledgebase is incomplete, clearly say what is missing before giving careful general engineering guidance. Prefer practical, specific, build-season-ready advice. Mention source file names or source titles when they are relevant.\n\n" +
    "Convex knowledgebase context:\n" +
    (compactContext(hits) || "No matching Convex metadata or generated notes found.") +
    "\n\nStudent question:\n" +
    question
  )
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function parseInteractionResponse(response: InteractionResponse): TeacherResult {
  const textBlocks: string[] = []
  const citations: string[] = []

  for (const step of response.steps ?? []) {
    if (step.type !== "model_output") continue

    for (const block of step.content ?? []) {
      if (block.type === "text" && block.text) {
        textBlocks.push(block.text)
      }

      for (const annotation of block.annotations ?? []) {
        if (annotation.type !== "file_citation") continue
        const fileName = annotation.file_name ?? annotation.fileName ?? "Uploaded document"
        const pageNumber = annotation.page_number ?? annotation.pageNumber
        citations.push(`${fileName}${pageNumber ? `, page ${pageNumber}` : ""}`)
      }
    }
  }

  return {
    answer: textBlocks.join("\n\n").trim() || "No response was returned.",
    citations: uniqueStrings(citations),
  }
}

function geminiErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Gemini request failed"
  if (
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("prepayment credits are depleted")
  ) {
    return "Gemini could not answer because the Google AI project is out of available credits. Add billing or credits in AI Studio, then try again."
  }
  return message
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForFileSearchOperation(
  ai: GoogleGenAI,
  operation: UploadFileSearchOperation,
) {
  let current = operation

  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (current.done) {
      if (current.error) {
        throw new Error(`Gemini File Search indexing failed: ${JSON.stringify(current.error)}`)
      }
      return current
    }

    await delay(2500)
    current = (await ai.operations.get({
      operation: current as never,
    })) as UploadFileSearchOperation
  }

  return current
}

async function askWithFileSearch(
  ai: GoogleGenAI,
  model: string,
  fileSearchStoreName: string | undefined,
  prompt: string,
) {
  const interactions = (ai as unknown as { interactions?: InteractionsClient }).interactions
  if (!interactions || !fileSearchStoreName) {
    return null
  }

  return parseInteractionResponse(
    await interactions.create({
      model,
      input: prompt,
      tools: [
        {
          type: "file_search",
          file_search_store_names: [fileSearchStoreName],
          top_k: 8,
        },
      ],
    }),
  )
}

async function askWithConvexContext(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
  citations: string[],
): Promise<TeacherResult> {
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
  })

  return {
    answer: response.text ?? "No response was returned.",
    citations,
  }
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
      const completedOperation = await waitForFileSearchOperation(ai, operation)

      if (!args.fileSearchStoreName) {
        await ctx.runMutation(internal.auth.setFileSearchStoreName, {
          fileSearchStoreName,
        })
      }

      await ctx.runMutation(internal.knowledge.patchSource, {
        sourceId: args.sourceId,
        status: completedOperation.done ? "indexed" : "pending",
        summary: completedOperation.done
          ? "Document uploaded to Firebase Storage and indexed for AI retrieval."
          : "Document uploaded to Firebase Storage and Gemini indexing is still processing.",
        geminiOperationName: completedOperation.name ?? operation.name,
        geminiDocumentName: completedOperation.response?.documentName,
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

export const getFileSearchDiagnostics = action({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.runQuery(internal.auth.getSessionInternal, {
      sessionToken: args.sessionToken,
    })
    if (!session || session.role !== "mentor") {
      throw new Error("Mentor access required")
    }

    const settings: TeacherSettings | null = await ctx.runQuery(
      internal.auth.getSettingsInternal,
      {},
    )
    const ai = getAi()
    if (!ai || !settings?.fileSearchStoreName) {
      return {
        configured: false,
        documents: [],
      }
    }

    const store = (await ai.fileSearchStores.get({
      name: settings.fileSearchStoreName,
    })) as FileSearchStore
    const documents: FileSearchDocument[] = []
    const pager = await (ai.fileSearchStores as FileSearchStoresClient).documents.list({
      parent: settings.fileSearchStoreName,
      config: { pageSize: 20 },
    })

    for await (const document of pager) {
      documents.push(document)
      if (documents.length >= 20) break
    }

    return {
      configured: true,
      store: {
        name: store.name,
        displayName: store.displayName,
        activeDocumentsCount: store.activeDocumentsCount,
        pendingDocumentsCount: store.pendingDocumentsCount,
        failedDocumentsCount: store.failedDocumentsCount,
      },
      documents: documents.map((document) => ({
        name: document.name,
        displayName: document.displayName,
        createTime: document.createTime,
        updateTime: document.updateTime,
      })),
    }
  },
})

export const reindexSourceDocument = action({
  args: {
    sessionToken: v.string(),
    sourceId: v.id("knowledgeSources"),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const session = await ctx.runQuery(internal.auth.getSessionInternal, {
      sessionToken: args.sessionToken,
    })
    if (!session || session.role !== "mentor") {
      throw new Error("Mentor access required")
    }

    const sourceResult: {
      source: {
        fileName?: string
        mimeType?: string
        storageDownloadUrl?: string
      } | null
    } = await ctx.runQuery(internal.knowledge.getSourceInternal, {
      sourceId: args.sourceId,
    })
    const source = sourceResult.source
    if (!source?.storageDownloadUrl || !source.fileName || !source.mimeType) {
      throw new Error("Source does not have a Firebase Storage document to reindex")
    }

    const settings: TeacherSettings | null = await ctx.runQuery(
      internal.auth.getSettingsInternal,
      {},
    )
    await ctx.runMutation(internal.knowledge.patchSource, {
      sourceId: args.sourceId,
      status: "pending",
      summary: "Document queued for Gemini File Search reindexing.",
      error: undefined,
    })
    await ctx.runAction(internal.ai.indexStorageDocument, {
      sourceId: args.sourceId,
      fileName: source.fileName,
      mimeType: source.mimeType,
      storageDownloadUrl: source.storageDownloadUrl,
      fileSearchStoreName: settings?.fileSearchStoreName,
    })

    return { ok: true }
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
  ): Promise<TeacherResult> => {
    const session = await ctx.runQuery(internal.auth.getSessionInternal, {
      sessionToken: args.sessionToken,
    })
    if (!session) {
      throw new Error("Login required")
    }

    const settings: TeacherSettings | null = await ctx.runQuery(
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
        url: source.url,
      })),
      ...knowledge.entries.map((entry) => ({
        title: entry.title,
        body: entry.body,
      })),
    ]

    const ai = getAi()
    const metadataCitations = hits.map((hit) => hit.title)
    if (!ai) {
      return {
        answer:
          "Gemini is not configured yet. Add GEMINI_API_KEY in Convex environment variables, then ask again.\n\nRelevant stored knowledge:\n\n" +
          compactContext(hits),
        citations: metadataCitations,
      }
    }

    const prompt = teacherPrompt(args.question, hits)
    const configuredModel = settings?.geminiModel ?? "gemini-2.5-flash"

    if (settings?.fileSearchStoreName) {
      try {
        const answer = await askWithFileSearch(
          ai,
          configuredModel,
          settings.fileSearchStoreName,
          prompt,
        )
        if (answer) {
          return {
            answer: answer.answer,
            citations: uniqueStrings([...answer.citations, ...metadataCitations]),
          }
        }
      } catch (error) {
        const message = geminiErrorMessage(error)
        let fallback: TeacherResult
        try {
          fallback = await askWithConvexContext(ai, configuredModel, prompt, metadataCitations)
        } catch {
          return {
            answer:
              `${message}\n\nI could not complete the fallback Gemini request either. Relevant stored knowledge:\n\n` +
              compactContext(hits),
            citations: uniqueStrings(metadataCitations),
          }
        }
        return {
          answer:
            fallback.answer +
            `\n\nNote: Gemini File Search was unavailable for this request, so I answered from Convex metadata and generated notes. File Search error: ${message}`,
          citations: fallback.citations,
        }
      }
    }

    try {
      return await askWithConvexContext(ai, configuredModel, prompt, metadataCitations)
    } catch (error) {
      return {
        answer:
          `${geminiErrorMessage(error)}\n\nRelevant stored knowledge:\n\n` +
          compactContext(hits),
        citations: uniqueStrings(metadataCitations),
      }
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

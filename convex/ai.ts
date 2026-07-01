"use node";

import { GoogleGenAI } from "@google/genai"
import { internal } from "./_generated/api"
import { action, internalAction } from "./_generated/server"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"

type KnowledgeHit = {
  title: string
  sourceType?: "document" | "url" | "mentorNote"
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

type TeacherAnswerMode = "sourcesOnly" | "sourcesPlusGeneral" | "sourcesPlusWeb"

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

type CrawledPage = {
  url: string
  title: string
  description?: string
  text: string
  links: string[]
}

type UrlCrawlMode = "single" | "small" | "section"

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

type GoogleSearchGroundingChunk = {
  web?: {
    title?: string
    uri?: string
  }
}

type GroundedGenerateContentResponse = {
  text?: string
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: GoogleSearchGroundingChunk[]
    }
  }>
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

function teacherPrompt(
  question: string,
  hits: KnowledgeHit[],
  answerMode: TeacherAnswerMode,
) {
  const evidenceRule = answerMode === "sourcesOnly"
    ? "Answer only from uploaded/File Search documents and Convex knowledgebase context. If those sources do not support the answer, say that the knowledgebase does not contain enough information and ask for a relevant source to be uploaded. Do not use outside knowledge."
    : answerMode === "sourcesPlusWeb"
      ? "Use uploaded/File Search documents and Convex knowledgebase context first. You may use live Google Search grounding for information not present in the uploaded sources, and you must make clear when an answer uses web results."
      : "Use uploaded/File Search documents and Convex knowledgebase context first. If those are incomplete, you may add careful general engineering knowledge and clearly say when you are going beyond uploaded sources."

  return (
    "You are CheesyGuide, an FRC 254 engineering teacher. Answer robot and engineering questions for students.\n\n" +
    `${evidenceRule} Prefer practical, specific, build-season-ready advice. Mention source file names or source titles when they are relevant. Begin directly with the student-facing answer. Do not include tool calls, code, chain-of-thought, hidden reasoning, planning, or scratchpad text in the final answer.\n\n` +
    "Convex knowledgebase context:\n" +
    (compactContext(hits) || "No matching Convex metadata or generated notes found.") +
    "\n\nStudent question:\n" +
    question
  )
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function sanitizeTeacherAnswer(answer: string) {
  let clean = answer.trim()

  if (/^tool_code\n/i.test(clean)) {
    clean = clean.replace(/^tool_code\s*\n[\s\S]*?thought\s*\n/i, "")
  }

  if (/^thought\n/i.test(clean)) {
    clean = clean.replace(/^thought\n/i, "")
    const answerStart = clean.search(
      /\.(?=(?:In|According|For|A|An|Subsystems|Commands|Command-based)\s)/,
    )
    if (answerStart > -1 && answerStart < 1200) {
      clean = clean.slice(answerStart + 1)
    }
  }

  if (/^(?:the user is asking|i need to|here'?s a plan)/i.test(clean)) {
    const answerStarts = Array.from(
      clean.matchAll(
        /(?:Alright team|Top-down design|In WPILib|In Onshape|According to|For FRC|Subsystems are|A subsystem)/gi,
      ),
    )
    const answerStart = answerStarts.find((match) => (match.index ?? 0) > 0)?.index
      ?? answerStarts[0]?.index
      ?? -1
    if (answerStart > -1 && answerStart < 2500) {
      clean = clean.slice(answerStart)
    }
  }

  if (
    /^.+?['"]?\.?\s*I should\b/i.test(clean) ||
    /^.+?['"]?\.?\s*I will\b/i.test(clean) ||
    /^.+?['"]?\.?\s*I'll\b/i.test(clean) ||
    /^.+?['"]?\.?\s*I need\b/i.test(clean)
  ) {
    const answerStarts = Array.from(
      clean.matchAll(
        /(?:The knowledgebase|Top-down design|In WPILib|In Onshape|According to|For FRC|Subsystems are|A subsystem)/gi,
      ),
    )
    const answerStart = answerStarts.find((match) => (match.index ?? 0) > 20)?.index ?? -1
    if (answerStart > -1 && answerStart < 2500) {
      clean = clean.slice(answerStart)
    }
  }

  if (/(?:I should|I will|I'll|I need|I recommend|seems directly applicable|look for descriptions)/i.test(clean.slice(0, 2000))) {
    const repeatedAnswerStart = Math.max(
      clean.lastIndexOf("Top-down design"),
      clean.lastIndexOf("The FRCDesign.org"),
      clean.lastIndexOf("According to"),
      clean.lastIndexOf("In WPILib"),
      clean.lastIndexOf("In Onshape"),
    )
    if (repeatedAnswerStart > 20 && repeatedAnswerStart < 2500) {
      clean = clean.slice(repeatedAnswerStart)
    }
  }

  return clean.replace(/^(?:answer|final)\n/i, "").trim()
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
    answer: sanitizeTeacherAnswer(textBlocks.join("\n\n")) || "No response was returned.",
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
    answer: sanitizeTeacherAnswer(response.text ?? "No response was returned."),
    citations,
  }
}

function googleSearchCitations(response: GroundedGenerateContentResponse) {
  return uniqueStrings(
    (response.candidates ?? []).flatMap((candidate) =>
      (candidate.groundingMetadata?.groundingChunks ?? []).flatMap((chunk) => {
        if (!chunk.web?.uri) return []
        return chunk.web.title
          ? `${chunk.web.title} - ${chunk.web.uri}`
          : chunk.web.uri
      }),
    ),
  ).slice(0, 8)
}

async function askWithGoogleSearch(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
): Promise<TeacherResult> {
  const response = (await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    config: {
      tools: [{ googleSearch: {} }],
    },
  })) as GroundedGenerateContentResponse

  return {
    answer: sanitizeTeacherAnswer(response.text ?? "No response was returned."),
    citations: googleSearchCitations(response),
  }
}

async function deleteFileSearchDocument(documentName?: string) {
  const ai = getAi()
  if (!ai || !documentName) return

  await (ai as unknown as {
    documents?: { delete: (params: { name: string }) => Promise<void> }
  }).documents?.delete({ name: documentName })
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

const defaultSmallCrawlPages = 5
const defaultSectionCrawlPages = 50
const maxSectionCrawlPages = 100
const maxPageCharacters = 16000
const maxUrlCorpusCharacters = 180000

function normalizeHttpUrl(value: string) {
  const parsed = new URL(value.trim())
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL sources must start with http:// or https://")
  }
  parsed.hash = ""
  return parsed.toString()
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
    apos: "'",
  }

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const isHex = code[1]?.toLowerCase() === "x"
      const numeric = Number.parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity
    }
    return namedEntities[code.toLowerCase()] ?? entity
  })
}

function firstMatch(html: string, expression: RegExp) {
  return decodeHtmlEntities(expression.exec(html)?.[1]?.trim() ?? "")
}

function pageTitle(html: string, fallbackUrl: string) {
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
  if (title) return title.replace(/\s+/g, " ")
  return new URL(fallbackUrl).hostname
}

function pageDescription(html: string) {
  return firstMatch(
    html,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ) || firstMatch(
    html,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i,
  )
}

function visiblePageText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ).slice(0, maxPageCharacters)
}

function shouldSkipLinkedUrl(url: URL) {
  return (
    /(?:\$\{|%7B|%7D|\{\}|undefined|null)/i.test(url.href) ||
    /\.(?:7z|avi|css|docx?|gif|gz|ico|jpe?g|js|json|m4a|mov|mp3|mp4|pdf|png|pptx?|svg|tiff?|webm|xlsx?|zip)$/i.test(
      url.pathname,
    )
  )
}

function extractLinks(html: string, baseUrl: string) {
  const base = new URL(baseUrl)
  const links: string[] = []
  const expression = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi
  let match = expression.exec(html)

  while (match) {
    const href = decodeHtmlEntities(match[1] ?? "").trim()
    if (!href || /(?:\$\{|{{|}}|undefined|null)/i.test(href)) {
      match = expression.exec(html)
      continue
    }

    try {
      const url = new URL(href, base)
      url.hash = ""
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        !shouldSkipLinkedUrl(url)
      ) {
        links.push(url.toString())
      }
    } catch {
      // Ignore malformed links from the crawled page.
    }
    match = expression.exec(html)
  }

  return uniqueStrings(links)
}

async function fetchPage(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,text/plain;q=0.9,*/*;q=0.2",
        "user-agent": "CheesyGuideKnowledgebaseBot/1.0",
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Could not fetch ${url}: ${response.status}`)
    }

    const contentType = response.headers.get("content-type") ?? ""
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("text/plain")
    ) {
      throw new Error(`URL returned ${contentType || "non-text content"} instead of a web page`)
    }

    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

function clampPageLimit(mode: UrlCrawlMode, pageLimit?: number) {
  if (mode === "single") return 1
  if (mode === "small") return defaultSmallCrawlPages

  const requested = Math.floor(pageLimit ?? defaultSectionCrawlPages)
  if (!Number.isFinite(requested)) return defaultSectionCrawlPages
  return Math.min(Math.max(requested, 5), maxSectionCrawlPages)
}

function isAllowedCrawlUrl(url: string, start: URL, mode: UrlCrawlMode) {
  const parsed = new URL(url)
  if (parsed.origin !== start.origin) return false
  if (mode === "small") return true
  if (mode === "single") return false

  const sectionPath = start.pathname.endsWith("/")
    ? start.pathname
    : `${start.pathname}/`
  return parsed.pathname === start.pathname || parsed.pathname.startsWith(sectionPath)
}

async function crawlWebsite(
  startUrl: string,
  mode: UrlCrawlMode,
  pageLimit?: number,
) {
  const start = normalizeHttpUrl(startUrl)
  const startParsed = new URL(start)
  const maxPages = clampPageLimit(mode, pageLimit)
  const queue = [start]
  const visited = new Set<string>()
  const pages: CrawledPage[] = []

  while (queue.length > 0 && pages.length < maxPages) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)

    let html: string
    try {
      html = await fetchPage(current)
    } catch (error) {
      if (current === start) {
        throw error
      }
      continue
    }

    const links = extractLinks(html, current)
    const text = visiblePageText(html)

    if (text.length >= 120) {
      pages.push({
        url: current,
        title: pageTitle(html, current),
        description: pageDescription(html) || undefined,
        text,
        links,
      })
    }

    for (const link of links) {
      if (pages.length + queue.length >= maxPages) break
      if (visited.has(link)) continue
      if (isAllowedCrawlUrl(link, startParsed, mode)) {
        queue.push(link)
      }
    }
  }

  if (pages.length === 0) {
    throw new Error("No readable page text was found at that URL")
  }

  return pages
}

function websiteCorpus(pages: CrawledPage[]) {
  const sections = pages.map((page, index) => {
    const description = page.description ? `\nDescription: ${page.description}` : ""
    return `# Page ${index + 1}: ${page.title}\nURL: ${page.url}${description}\n\n${page.text}`
  })

  return sections.join("\n\n---\n\n").slice(0, maxUrlCorpusCharacters)
}

function notableLinks(pages: CrawledPage[]) {
  return uniqueStrings(
    pages.flatMap((page) =>
      page.links.filter((link) =>
        /(?:youtube\.com|youtu\.be|vimeo\.com|docs\.google\.com|github\.com|chiefdelphi\.com)/i.test(
          link,
        ),
      ),
    ),
  ).slice(0, 12)
}

function websiteEntryBody(summary: string, pages: CrawledPage[], corpus: string) {
  const pageList = pages.map((page) => `- ${page.title}: ${page.url}`).join("\n")
  const links = notableLinks(pages)
  const linkList = links.length > 0 ? `\n\nNotable linked resources:\n${links.map((link) => `- ${link}`).join("\n")}` : ""

  return [
    "AI summary:",
    summary,
    "",
    "Crawled pages:",
    pageList,
    linkList,
    "",
    "Extracted website text:",
    corpus.slice(0, 24000),
  ].join("\n")
}

async function ensureFileSearchStore(ai: GoogleGenAI, fileSearchStoreName?: string) {
  if (fileSearchStoreName) return fileSearchStoreName

  const created = await ai.fileSearchStores.create({
    config: { displayName: "CheesyGuide FRC 254 Knowledgebase" },
  })
  if (!created.name) {
    throw new Error("Gemini did not return a File Search store name")
  }
  return created.name
}

async function uploadTextToFileSearch(
  ai: GoogleGenAI,
  fileSearchStoreName: string,
  displayName: string,
  text: string,
) {
  const operation = await ai.fileSearchStores.uploadToFileSearchStore({
    fileSearchStoreName,
    file: new Blob([text], { type: "text/plain" }),
    config: {
      displayName,
      mimeType: "text/plain",
    },
  })

  return await waitForFileSearchOperation(ai, operation)
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
    answerMode: v.optional(v.union(
      v.literal("sourcesOnly"),
      v.literal("sourcesPlusGeneral"),
      v.literal("sourcesPlusWeb"),
    )),
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
        sourceType: source.sourceType,
        summary: source.summary,
        url: source.url,
      })),
      ...knowledge.entries.map((entry) => ({
        title: entry.title,
        body: entry.body,
      })),
    ]

    const ai = getAi()
    const sourceCitations = knowledge.sources
      .filter((source) => source.sourceType !== "mentorNote")
      .map((source) => source.title)
    const metadataCitations = sourceCitations.length > 0
      ? sourceCitations
      : knowledge.entries.map((entry) => entry.title)
    if (!ai) {
      return {
        answer:
          "Gemini is not configured yet. Add GEMINI_API_KEY in Convex environment variables, then ask again.\n\nRelevant stored knowledge:\n\n" +
          compactContext(hits),
        citations: metadataCitations,
      }
    }

    const answerMode = args.answerMode ?? "sourcesOnly"
    const prompt = teacherPrompt(args.question, hits, answerMode)
    const configuredModel = settings?.geminiModel ?? "gemini-2.5-flash"

    if (answerMode === "sourcesPlusWeb") {
      try {
        return await askWithGoogleSearch(ai, configuredModel, prompt)
      } catch (error) {
        return {
          answer:
            `${geminiErrorMessage(error)}\n\nI could not complete the Google Search-grounded request. Relevant stored knowledge:\n\n` +
            compactContext(hits),
          citations: uniqueStrings(metadataCitations),
        }
      }
    }

    if (settings?.fileSearchStoreName) {
      try {
        const answer = await askWithFileSearch(
          ai,
          configuredModel,
          settings.fileSearchStoreName,
          prompt,
        )
        if (answer) {
          if (answerMode === "sourcesOnly" && answer.answer === "No response was returned.") {
            return {
              answer:
                "I could not find enough support for that answer in the uploaded knowledgebase sources. Upload a relevant source or switch the Teacher mode to web search if you want a broader answer.",
              citations: [],
            }
          }

          return {
            answer: answer.answer,
            citations: uniqueStrings(answer.citations),
          }
        }
      } catch (error) {
        const message = geminiErrorMessage(error)
        if (answerMode === "sourcesOnly") {
          return {
            answer:
              `${message}\n\nI could not complete the File Search request. In uploaded-sources-only mode, I will not answer from outside knowledge. Relevant stored knowledge:\n\n` +
              compactContext(hits),
            citations: uniqueStrings(metadataCitations),
          }
        }

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

export const deleteSource = action({
  args: {
    sessionToken: v.string(),
    sourceId: v.id("knowledgeSources"),
  },
  handler: async (ctx, args): Promise<{ ok: true; fileSearchDeleted: boolean }> => {
    const session = await ctx.runQuery(internal.auth.getSessionInternal, {
      sessionToken: args.sessionToken,
    })
    if (!session || session.role !== "mentor") {
      throw new Error("Mentor access required")
    }

    const sourceResult: {
      source: {
        geminiDocumentName?: string
      } | null
    } = await ctx.runQuery(internal.knowledge.getSourceInternal, {
      sourceId: args.sourceId,
    })
    const geminiDocumentName = sourceResult.source?.geminiDocumentName
    let fileSearchDeleted = false

    if (geminiDocumentName) {
      try {
        await deleteFileSearchDocument(geminiDocumentName)
        fileSearchDeleted = true
      } catch (error) {
        const message = error instanceof Error ? error.message : "Gemini File Search delete failed"
        throw new Error(`Could not delete Gemini File Search document: ${message}`)
      }
    }

    await ctx.runMutation(internal.knowledge.deleteSourceInternal, {
      sourceId: args.sourceId,
    })

    return { ok: true, fileSearchDeleted }
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
    crawlMode: v.optional(v.union(v.literal("single"), v.literal("small"), v.literal("section"))),
    pageLimit: v.optional(v.number()),
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
      fileSearchStoreName?: string
    } | null = await ctx.runQuery(internal.auth.getSettingsInternal, {})
    if (settings && !settings.allowUrlSources) {
      throw new Error("URL sources are disabled")
    }

    const normalizedUrl = normalizeHttpUrl(args.url)
    const sourceId: Id<"knowledgeSources"> = await ctx.runMutation(internal.knowledge.createSource, {
      title: args.title || normalizedUrl,
      sourceType: "url",
      status: "pending",
      topics: [],
      url: normalizedUrl,
    })

    try {
      const crawlMode = args.crawlMode ?? "small"
      const pages = await crawlWebsite(normalizedUrl, crawlMode, args.pageLimit)
      const corpus = websiteCorpus(pages)
      const title = args.title || pages[0]?.title || normalizedUrl
      const ai = getAi()
      const summary: string = ai
        ? ((await ai.models.generateContent({
            model: settings?.geminiModel ?? "gemini-2.5-flash",
            contents:
              "Summarize these crawled web pages for an FRC 254 engineering knowledgebase. Include practical engineering takeaways, when to use the information, cautions, suggested topics, and any notable linked videos or resources.\n\n" +
              corpus,
          })).text ?? corpus.slice(0, 1200))
        : corpus.slice(0, 1200)
      const topics = parseTopics(summary)
      let fileSearchStoreName = settings?.fileSearchStoreName
      let geminiOperationName: string | undefined
      let geminiDocumentName: string | undefined

      if (ai) {
        fileSearchStoreName = await ensureFileSearchStore(ai, fileSearchStoreName)
        const completedOperation = await uploadTextToFileSearch(
          ai,
          fileSearchStoreName,
          `${title}.txt`,
          corpus,
        )

        if (!settings?.fileSearchStoreName) {
          await ctx.runMutation(internal.auth.setFileSearchStoreName, {
            fileSearchStoreName,
          })
        }

        geminiOperationName = completedOperation.name
        geminiDocumentName = completedOperation.response?.documentName
      }

      await ctx.runMutation(internal.knowledge.patchSource, {
        sourceId,
        title,
        status: ai ? "indexed" : "integration_missing",
        summary,
        topics,
        geminiOperationName,
        geminiDocumentName,
      })
      await ctx.runMutation(internal.knowledge.createEntry, {
        sourceId,
        entryType: "summary",
        title,
        body: websiteEntryBody(summary, pages, corpus),
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

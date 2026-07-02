"use node";

import { GoogleGenAI } from "@google/genai"
import JSZip from "jszip"
import { internal } from "./_generated/api"
import { action, internalAction } from "./_generated/server"
import { v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import {
  deleteFirebaseStorageObject,
  listFirebaseStorageObjects,
} from "./lib/firebaseStorage"

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

type ChatHistoryMessage = {
  role: "user" | "assistant"
  content: string
}

type ChatImage = {
  mimeType: string
  data: string
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

type StorageSource = {
  _id: Id<"knowledgeSources">
  title: string
  fileName?: string
  size?: number
  storageBucket?: string
  storagePath?: string
  status: string
  updatedAt: number
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
    ?.replace(/^\uFEFF/, "")
    .trim()
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
  history: ChatHistoryMessage[],
) {
  const evidenceRule = answerMode === "sourcesOnly"
    ? "Answer only from uploaded/File Search documents and Convex knowledgebase context. If those sources do not support the answer, say that the knowledgebase does not contain enough information and ask for a relevant source to be uploaded. Do not use outside knowledge."
    : answerMode === "sourcesPlusWeb"
      ? "Treat uploaded/File Search documents and Convex knowledgebase context as the primary source of truth. Use live Google Search grounding only to fill gaps not sufficiently covered by uploaded sources, and clearly label any web-backed additions as gap-filling."
      : "Treat uploaded/File Search documents and Convex knowledgebase context as the primary source of truth. Use Gemini's general engineering knowledge only to fill gaps not sufficiently covered by uploaded sources, and clearly label any general-knowledge additions as gap-filling."

  const recentHistory = history
    .slice(-8)
    .map((message) => `${message.role === "user" ? "Student" : "Teacher"}: ${message.content}`)
    .join("\n\n")

  return (
    "You are CheesyGuide, an FRC 254 engineering teacher. Answer robot and engineering questions for students.\n\n" +
    `${evidenceRule} If uploaded sources conflict with model priors or web results, follow the uploaded source and mention the conflict briefly. Prefer practical, specific, build-season-ready advice. Keep the main answer concise: 2-4 short paragraphs or a tight bullet list. End with one line titled "Explore next:" and suggest 2-3 brief follow-up directions the student could ask about. Mention source file names or source titles when they are relevant. Begin directly with the student-facing answer. Do not include tool calls, code, chain-of-thought, hidden reasoning, planning, or scratchpad text in the final answer.\n\n` +
    "Recent conversation:\n" +
    (recentHistory || "No earlier turns in this chat.") +
    "\n\n" +
    "Convex knowledgebase context:\n" +
    (compactContext(hits) || "No matching Convex metadata or generated notes found.") +
    "\n\nStudent question:\n" +
    question
  )
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function shortKnowledgebaseMiss() {
  return "I do not have enough in the uploaded knowledgebase to answer that confidently. Try Sources + Gemini Knowledge or Sources + Web Search for a broader answer, but keep in mind that broader guidance may not reflect conventional 254 practices."
}

function shortInsufficientSpecificInfo() {
  return "I do not have enough reliable 254-specific information to answer that confidently. Try Sources + Web Search for historical details, but keep in mind that broader guidance may not reflect conventional 254 practices."
}

function isKnowledgebaseMiss(answer: string) {
  return /(?:does not contain enough|do not have enough|not enough support|does not explicitly mention|no response was returned|could not find enough)/i.test(answer)
}

function stripLeadingReasoning(answer: string) {
  const paragraphs = answer.split(/\n{2,}/)
  let firstAnswerParagraph = 0

  for (const [index, paragraph] of paragraphs.entries()) {
    const normalized = paragraph.trim()
    if (!normalized) {
      firstAnswerParagraph = index + 1
      continue
    }

    const looksLikeReasoning =
      /^(?:the user is asking|the student is asking|i need to|i should|i will|i'll|my previous response|after reviewing the available|therefore, i must|given the lack|the provided documents|i need|i can)/i.test(normalized) ||
      /(?:provided documents|previous response|search the provided|file search|tool calls|uploaded knowledgebase was insufficient|focus on the limitations|must state|internal|scratchpad)/i.test(normalized)

    if (!looksLikeReasoning) {
      firstAnswerParagraph = index
      break
    }

    firstAnswerParagraph = index + 1
  }

  return paragraphs.slice(firstAnswerParagraph).join("\n\n").trim() || answer.trim()
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

  clean = stripLeadingReasoning(clean)

  if (/^Explore next:/i.test(clean) || clean.length < 40) {
    return shortInsufficientSpecificInfo()
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
  images: ChatImage[] = [],
): Promise<TeacherResult> {
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          ...images.map((image) => ({
            inlineData: {
              mimeType: image.mimeType,
              data: image.data,
            },
          })),
        ],
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
  images: ChatImage[] = [],
): Promise<TeacherResult> {
  const response = (await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          ...images.map((image) => ({
            inlineData: {
              mimeType: image.mimeType,
              data: image.data,
            },
          })),
        ],
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
  if (!documentName) return false

  const ai = getAi()
  if (!ai) {
    throw new Error("Gemini API key is not configured")
  }

  const documents = (ai as unknown as {
    documents?: { delete: (params: { name: string }) => Promise<void> }
  }).documents
  if (!documents) {
    throw new Error("Gemini documents API is not available")
  }

  await documents.delete({ name: documentName })
  return true
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

function isPptxFile(fileName: string, mimeType: string) {
  return (
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    fileName.toLowerCase().endsWith(".pptx")
  )
}

function xmlTextValues(xml: string) {
  return Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
    .map((match) => decodeHtmlEntities(match[1] ?? "").trim())
    .filter(Boolean)
}

async function extractPptxText(fileName: string, buffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buffer)
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const noteFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const sections: string[] = []

  for (const [index, name] of slideFiles.entries()) {
    const xml = await zip.files[name]?.async("text")
    const text = xml ? xmlTextValues(xml).join("\n") : ""
    if (text) {
      sections.push(`# Slide ${index + 1}\n${text}`)
    }
  }

  for (const [index, name] of noteFiles.entries()) {
    const xml = await zip.files[name]?.async("text")
    const text = xml ? xmlTextValues(xml).join("\n") : ""
    if (text) {
      sections.push(`# Speaker Notes ${index + 1}\n${text}`)
    }
  }

  const body = sections.join("\n\n").trim()
  if (!body) return null
  return `Extracted text from ${fileName}\n\n${body}`
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
      await ctx.runMutation(internal.knowledge.patchSource, {
        sourceId: args.sourceId,
        status: "indexing",
        summary: "Document uploaded to Firebase Storage and Gemini File Search indexing is in progress.",
        error: undefined,
      })

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

      const fileBuffer = await response.arrayBuffer()
      const extractedText = isPptxFile(args.fileName, args.mimeType)
        ? await extractPptxText(args.fileName, fileBuffer)
        : null
      const completedOperation = extractedText
        ? await uploadTextToFileSearch(
            ai,
            fileSearchStoreName,
            `${args.fileName}.txt`,
            extractedText,
          )
        : await waitForFileSearchOperation(
            ai,
            await ai.fileSearchStores.uploadToFileSearchStore({
              fileSearchStoreName,
              file: new Blob([fileBuffer], {
                type: args.mimeType,
              }),
              config: {
                displayName: args.fileName,
                mimeType: args.mimeType,
              },
            }),
          )

      if (!args.fileSearchStoreName) {
        await ctx.runMutation(internal.auth.setFileSearchStoreName, {
          fileSearchStoreName,
        })
      }

      await ctx.runMutation(internal.knowledge.patchSource, {
        sourceId: args.sourceId,
        status: completedOperation.done ? "indexed" : "indexing",
        summary: completedOperation.done
          ? extractedText
            ? "Presentation uploaded to Firebase Storage, scanned for slide text, and indexed for AI retrieval."
            : "Document uploaded to Firebase Storage and indexed for AI retrieval."
          : "Document uploaded to Firebase Storage and Gemini indexing is still processing.",
        geminiOperationName: completedOperation.name,
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

function duplicateKey(name?: string, size?: number) {
  return `${(name ?? "unknown").toLowerCase()}::${size ?? 0}`
}

function buildStorageDiagnostics(
  bucket: string,
  objects: Awaited<ReturnType<typeof listFirebaseStorageObjects>>["objects"],
  sources: StorageSource[],
) {
  const trackedPaths = new Set(
    sources
      .map((source) => source.storagePath)
      .filter((path): path is string => Boolean(path)),
  )
  const sourceByPath = new Map(
    sources
      .filter((source) => source.storagePath)
      .map((source) => [source.storagePath as string, source]),
  )
  const objectRows = objects.map((object) => {
    const source = sourceByPath.get(object.name)
    return {
      path: object.name,
      size: object.size,
      updated: object.updated,
      timeCreated: object.timeCreated,
      contentType: object.contentType,
      originalFileName: object.metadata?.originalFileName,
      tracked: Boolean(source),
      sourceId: source?._id,
      sourceTitle: source?.title,
    }
  })
  const duplicateGroups = new Map<string, typeof objectRows>()

  for (const object of objectRows) {
    const key = duplicateKey(object.originalFileName ?? object.path.split("/").pop(), object.size)
    const group = duplicateGroups.get(key)
    if (group) {
      group.push(object)
    } else {
      duplicateGroups.set(key, [object])
    }
  }

  const duplicates = Array.from(duplicateGroups.values())
    .filter((group) => group.length > 1)
    .map((group) => ({
      originalFileName: group[0]?.originalFileName ?? "Unknown file",
      size: group[0]?.size ?? 0,
      objects: group,
      untrackedPaths: group
        .filter((object) => !object.tracked)
        .map((object) => object.path),
    }))

  return {
    bucket,
    totalObjects: objectRows.length,
    totalBytes: objectRows.reduce((total, object) => total + object.size, 0),
    trackedObjects: objectRows.filter((object) => object.tracked).length,
    untrackedObjects: objectRows.filter((object) => !object.tracked),
    duplicates,
    recentObjects: [...objectRows]
      .sort((a, b) => String(b.updated ?? "").localeCompare(String(a.updated ?? "")))
      .slice(0, 20),
    trackedPaths: Array.from(trackedPaths),
  }
}

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
    const sources: StorageSource[] = await ctx.runQuery(
      internal.knowledge.listStorageSourcesInternal,
      {},
    )
    let storage:
      | ReturnType<typeof buildStorageDiagnostics>
      | { configured: false; error: string }
    try {
      const storageResult = await listFirebaseStorageObjects(
        (settings as { storageBucket?: string } | null)?.storageBucket,
      )
      storage = buildStorageDiagnostics(storageResult.bucket, storageResult.objects, sources)
    } catch (error) {
      storage = {
        configured: false,
        error: error instanceof Error ? error.message : "Firebase Storage diagnostics failed",
      }
    }

    const ai = getAi()
    if (!ai || !settings?.fileSearchStoreName) {
      return {
        configured: false,
        documents: [],
        storage,
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
      storage,
    }
  },
})

export const deleteUntrackedStorageObjects = action({
  args: {
    sessionToken: v.string(),
    paths: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ deleted: number }> => {
    const session = await ctx.runQuery(internal.auth.getSessionInternal, {
      sessionToken: args.sessionToken,
    })
    if (!session || session.role !== "mentor") {
      throw new Error("Mentor access required")
    }

    const settings: ({ storageBucket?: string } & TeacherSettings) | null =
      await ctx.runQuery(internal.auth.getSettingsInternal, {})
    const sources: StorageSource[] = await ctx.runQuery(
      internal.knowledge.listStorageSourcesInternal,
      {},
    )
    const trackedPaths = new Set(
      sources
        .map((source) => source.storagePath)
        .filter((path): path is string => Boolean(path)),
    )
    const uniquePaths = uniqueStrings(args.paths)
    let deleted = 0

    for (const path of uniquePaths) {
      if (!path.startsWith("knowledge-sources/")) {
        throw new Error(`Refusing to delete object outside knowledge-sources/: ${path}`)
      }
      if (trackedPaths.has(path)) {
        throw new Error(`Refusing to delete tracked storage object: ${path}`)
      }
      if (await deleteFirebaseStorageObject(settings?.storageBucket, path)) {
        deleted += 1
      }
    }

    return { deleted }
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
      status: "queued",
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
    history: v.optional(v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
    }))),
    images: v.optional(v.array(v.object({
      mimeType: v.string(),
      data: v.string(),
    }))),
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
    const mentorTextbook: {
      source: KnowledgeHit | null
      entries: KnowledgeHit[]
    } = await ctx.runQuery(internal.knowledge.getMentorTextbookInternal, {})
    if (
      mentorTextbook.source &&
      !knowledge.sources.some((source) => source.title === mentorTextbook.source?.title)
    ) {
      knowledge.sources.push(mentorTextbook.source)
    }
    for (const entry of mentorTextbook.entries) {
      if (!knowledge.entries.some((existing) => existing.title === entry.title)) {
        knowledge.entries.push(entry)
      }
    }
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
      .filter(
        (source) =>
          source.sourceType !== "mentorNote" ||
          source.title === "Mentor Knowledge Textbook",
      )
      .map((source) => source.title)
    const metadataCitations = uniqueStrings([
      ...sourceCitations,
      ...knowledge.entries.map((entry) => entry.title),
    ])
    const answerMode = args.answerMode ?? "sourcesOnly"
    const recordAndReturn = async (result: TeacherResult) => {
      await ctx.runMutation(internal.analytics.recordTeacherQuestion, {
        question: args.question,
        answered: !isKnowledgebaseMiss(result.answer),
        answerMode,
        role: session.role,
        citationsCount: result.citations.length,
      })
      return result
    }

    if (!ai) {
      return await recordAndReturn({
        answer:
          "Gemini is not configured yet. Add GEMINI_API_KEY in Convex environment variables, then ask again.\n\nRelevant stored knowledge:\n\n" +
          compactContext(hits),
        citations: metadataCitations,
      })
    }

    const sourcePrompt = teacherPrompt(args.question, hits, "sourcesOnly", args.history ?? [])
    const fallbackPrompt = teacherPrompt(args.question, hits, answerMode, args.history ?? [])
    const configuredModel = settings?.geminiModel ?? "gemini-2.5-flash"
    const images = args.images ?? []

    const hasEntryContext = knowledge.entries.some(
      (entry) => (entry.body ?? "").trim().length > 0,
    )
    if (hasEntryContext || images.length > 0) {
      try {
        const answer = await askWithConvexContext(
          ai,
          configuredModel,
          sourcePrompt,
          metadataCitations,
          images,
        )
        if (!isKnowledgebaseMiss(answer.answer)) {
          return await recordAndReturn({
            answer: answer.answer,
            citations: uniqueStrings(answer.citations),
          })
        }
      } catch (error) {
        if (answerMode === "sourcesOnly") {
          return await recordAndReturn({
            answer: images.length > 0
              ? `${geminiErrorMessage(error)}\n\nI could not analyze the attached image with the current knowledgebase context.`
              : shortKnowledgebaseMiss(),
            citations: uniqueStrings(metadataCitations),
          })
        }
      }
    }

    if (settings?.fileSearchStoreName) {
      try {
        const answer = await askWithFileSearch(
          ai,
          configuredModel,
          settings.fileSearchStoreName,
          sourcePrompt,
        )
        if (answer && !isKnowledgebaseMiss(answer.answer)) {
          return await recordAndReturn({
            answer: answer.answer,
            citations: uniqueStrings(
              answer.citations.length > 0 ? answer.citations : metadataCitations,
            ),
          })
        }
      } catch (error) {
        if (answerMode === "sourcesOnly") {
          return await recordAndReturn({
            answer: shortKnowledgebaseMiss(),
            citations: uniqueStrings(metadataCitations),
          })
        }
        const message = geminiErrorMessage(error)
        try {
          const fallback = await askWithConvexContext(
            ai,
            configuredModel,
            fallbackPrompt,
            metadataCitations,
            images,
          )
          return await recordAndReturn({
            answer:
              fallback.answer +
              `\n\nNote: Gemini File Search was unavailable, so I filled gaps without uploaded-file retrieval. File Search error: ${message}`,
            citations: fallback.citations,
          })
        } catch {
          return await recordAndReturn({
            answer:
              `${message}\n\nI could not complete the fallback Gemini request either. Relevant stored knowledge:\n\n` +
              compactContext(hits),
            citations: uniqueStrings(metadataCitations),
          })
        }
      }
    }

    if (answerMode === "sourcesOnly") {
      return await recordAndReturn({
        answer: shortKnowledgebaseMiss(),
        citations: uniqueStrings(metadataCitations),
      })
    }

    if (answerMode === "sourcesPlusWeb") {
      try {
        const answer = await askWithGoogleSearch(ai, configuredModel, fallbackPrompt, images)
        return await recordAndReturn({
          answer: answer.answer,
          citations: uniqueStrings([...metadataCitations, ...answer.citations]),
        })
      } catch (error) {
        return await recordAndReturn({
          answer:
            `${geminiErrorMessage(error)}\n\nI could not complete the Google Search-grounded request. Relevant stored knowledge:\n\n` +
            compactContext(hits),
          citations: uniqueStrings(metadataCitations),
        })
      }
    }

    try {
      return await recordAndReturn(
        await askWithConvexContext(
          ai,
          configuredModel,
          fallbackPrompt,
          metadataCitations,
          images,
        ),
      )
    } catch (error) {
      return await recordAndReturn({
        answer:
          `${geminiErrorMessage(error)}\n\nRelevant stored knowledge:\n\n` +
          compactContext(hits),
        citations: uniqueStrings(metadataCitations),
      })
    }
  },
})

export const deleteSource = action({
  args: {
    sessionToken: v.string(),
    sourceId: v.id("knowledgeSources"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; fileSearchDeleted: boolean; storageDeleted: boolean }> => {
    const session = await ctx.runQuery(internal.auth.getSessionInternal, {
      sessionToken: args.sessionToken,
    })
    if (!session || session.role !== "mentor") {
      throw new Error("Mentor access required")
    }

    const sourceResult: {
      source: {
        geminiDocumentName?: string
        storageBucket?: string
        storagePath?: string
      } | null
    } = await ctx.runQuery(internal.knowledge.getSourceInternal, {
      sourceId: args.sourceId,
    })
    const geminiDocumentName = sourceResult.source?.geminiDocumentName
    const storageBucket = sourceResult.source?.storageBucket
    const storagePath = sourceResult.source?.storagePath
    let fileSearchDeleted = false
    let storageDeleted = false

    if (geminiDocumentName) {
      try {
        fileSearchDeleted = await deleteFileSearchDocument(geminiDocumentName)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Gemini File Search delete failed"
        throw new Error(`Could not delete Gemini File Search document: ${message}`)
      }
    }

    if (storageBucket && storagePath) {
      try {
        storageDeleted = await deleteFirebaseStorageObject(storageBucket, storagePath)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Firebase Storage delete failed"
        await ctx.runMutation(internal.knowledge.patchSource, {
          sourceId: args.sourceId,
          error: `Delete blocked: ${message}`,
        })
        throw new Error(`Could not delete Firebase Storage object: ${message}`)
      }
    }

    await ctx.runMutation(internal.knowledge.deleteSourceInternal, {
      sourceId: args.sourceId,
    })

    return { ok: true, fileSearchDeleted, storageDeleted }
  },
})

export const mentorIntake = action({
  args: {
    sessionToken: v.string(),
    message: v.string(),
    history: v.optional(v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
    }))),
    images: v.optional(v.array(v.object({
      mimeType: v.string(),
      data: v.string(),
    }))),
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
    const textbook: {
      source: { _id: Id<"knowledgeSources">; summary?: string } | null
      entries: Array<{ body: string }>
    } = await ctx.runQuery(internal.knowledge.getMentorTextbookInternal, {})
    const existingTextbook = textbook.entries[0]?.body ?? ""
    const ai = getAi()
    const recentHistory = (args.history ?? [])
      .slice(-8)
      .map((message) => `${message.role === "user" ? "Mentor" : "Intake AI"}: ${message.content}`)
      .join("\n\n")
    const prompt =
      "You are helping maintain a living FRC 254 mentor knowledge textbook. Reorganize the existing textbook with the new mentor note, preserving useful prior guidance while making the result easier to read. If the new note conflicts with existing guidance, include a short section titled \"Conflicts Needing Mentor Decision\" with clear options: override old info, keep old info as source of truth, or include both with context. Return the complete updated textbook in markdown, then a brief mentor-facing reply after a divider titled \"Mentor Reply\".\n\nExisting textbook:\n" +
      (existingTextbook || "No mentor textbook has been written yet.") +
      "\n\nRecent conversation:\n" +
      (recentHistory || "No earlier turns in this intake chat.") +
      "\n\nMentor note:\n" +
      args.message

    const images = args.images ?? []
    const generated: string = ai
      ? ((await ai.models.generateContent({
          model: settings?.geminiModel ?? "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                ...images.map((image) => ({
                  inlineData: {
                    mimeType: image.mimeType,
                    data: image.data,
                  },
                })),
              ],
            },
          ],
        })).text ?? args.message)
      : `${existingTextbook}\n\n## New Mentor Note\n${args.message}`.trim()

    const [generatedTextbook, mentorReply] = generated.includes("Mentor Reply")
      ? generated.split(/(?:-{3,}\s*)?(?:#{1,3}\s*)?Mentor Reply\s*/i)
      : [generated, "Added this information to the mentor textbook."]
    let updatedTextbook = generatedTextbook.trim()
    const originalNote = args.message.trim()
    if (originalNote && !updatedTextbook.includes(originalNote)) {
      updatedTextbook = `${updatedTextbook}\n\n## Recent Mentor Notes\n- ${originalNote}`
    }
    const summary = updatedTextbook
      .replace(/[#*_`>-]/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 900)
    const topics = parseTopics(`${args.message}\n${updatedTextbook}`)

    const sourceId: Id<"knowledgeSources"> = await ctx.runMutation(
      internal.knowledge.upsertMentorTextbook,
      {
        summary,
        body: updatedTextbook.trim(),
        topics,
      },
    )
    const answer = ai
      ? (mentorReply?.trim() || "Updated the mentor textbook with this information.")
      : "Gemini is not configured yet, so I appended this note to the mentor textbook."

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
      status: "queued",
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
        await ctx.runMutation(internal.knowledge.patchSource, {
          sourceId,
          status: "indexing",
          summary: "URL content crawled and Gemini File Search indexing is in progress.",
          topics,
        })
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

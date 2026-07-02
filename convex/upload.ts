import { internal } from "./_generated/api"
import { httpAction } from "./_generated/server"
import { uploadToFirebaseStorage } from "./lib/firebaseStorage"

const supportedMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/markdown",
])

const supportedExtensions = new Set([
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "txt",
  "md",
])

const maxUploadBytes = 30 * 1024 * 1024
const allowedUploadOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
  "https://cheesyguide-e2aee.web.app",
  "https://cheesyguide-e2aee.firebaseapp.com",
  ...((process.env.UPLOAD_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)),
])

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin")
  const allowedOrigin =
    origin && allowedUploadOrigins.has(origin)
      ? origin
      : "https://cheesyguide-e2aee.web.app"

  return {
    "access-control-allow-origin": allowedOrigin,
    "vary": "origin",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": "application/json",
  }
}

function forbiddenCorsResponse(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin || allowedUploadOrigins.has(origin)) {
    return null
  }

  return new Response(JSON.stringify({ error: "Upload origin is not allowed" }), {
    status: 403,
    headers: {
      "vary": "origin",
      "content-type": "application/json",
    },
  })
}

const optionsHeaders = {
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
}

function jsonResponse(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(request),
  })
}

function fileExtension(name: string) {
  const extension = name.split(".").pop()?.toLowerCase()
  return extension && extension !== name ? extension : ""
}

function mimeTypeForExtension(extension: string) {
  if (extension === "pdf") return "application/pdf"
  if (extension === "doc") return "application/msword"
  if (extension === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  }
  if (extension === "ppt") return "application/vnd.ms-powerpoint"
  if (extension === "pptx") {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  }
  if (extension === "xls") return "application/vnd.ms-excel"
  if (extension === "xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }
  if (extension === "md") return "text/markdown"
  if (extension === "txt") return "text/plain"
  return null
}

function effectiveMimeType(file: File, extension: string) {
  const expectedMimeType = mimeTypeForExtension(extension)
  if (!expectedMimeType) return null

  if (supportedMimeTypes.has(file.type)) {
    if (extension === "md" && file.type === "text/plain") {
      return "text/markdown"
    }
    return file.type === expectedMimeType ? file.type : null
  }

  if (file.type && file.type !== "application/octet-stream") {
    return null
  }

  return expectedMimeType
}

function hasBytes(bytes: Uint8Array, expected: number[]) {
  return expected.every((byte, index) => bytes[index] === byte)
}

function looksLikeText(bytes: Uint8Array) {
  const sample = bytes.slice(0, 4096)
  return !sample.some((byte) => byte === 0)
}

function isPlausibleFileContent(file: File, buffer: ArrayBuffer) {
  const extension = fileExtension(file.name)
  const bytes = new Uint8Array(buffer)

  if (extension === "pdf") {
    return hasBytes(bytes, [0x25, 0x50, 0x44, 0x46])
  }

  if (extension === "doc" || extension === "ppt" || extension === "xls") {
    return hasBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0])
  }

  if (extension === "docx" || extension === "pptx" || extension === "xlsx") {
    return hasBytes(bytes, [0x50, 0x4b, 0x03, 0x04])
  }

  if (extension === "txt" || extension === "md") {
    return looksLikeText(bytes)
  }

  return false
}

export const uploadOptions = httpAction(async (_, request) => {
  const blocked = forbiddenCorsResponse(request)
  if (blocked) return blocked

  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request),
      ...optionsHeaders,
    },
  })
})

export const uploadDocument = httpAction(async (ctx, request) => {
  const blocked = forbiddenCorsResponse(request)
  if (blocked) return blocked

  const formData = await request.formData()
  const sessionToken = String(formData.get("sessionToken") ?? "")
  const file = formData.get("file")

  if (!(file instanceof File)) {
    return jsonResponse(request, { error: "Missing file" }, 400)
  }

  const extension = fileExtension(file.name)
  const mimeType = effectiveMimeType(file, extension)

  if (!supportedExtensions.has(extension)) {
    return jsonResponse(
      request,
      {
        error:
          "Unsupported file extension. Upload PDF, Word, PowerPoint, Excel, text, or Markdown documents.",
      },
      400,
    )
  }

  if (!mimeType) {
    return jsonResponse(
      request,
      {
        error:
          "Unsupported file type. MVP uploads support PDF, Word, PowerPoint, Excel, text, and Markdown documents.",
      },
      400,
    )
  }

  if (file.size > maxUploadBytes) {
    return jsonResponse(
      request,
      { error: "Upload is too large. Documents must be 30 MB or smaller." },
      400,
    )
  }

  const session = await ctx.runQuery(internal.auth.getSessionInternal, { sessionToken })
  if (!session || session.role !== "mentor") {
    return jsonResponse(request, { error: "Mentor access required" }, 403)
  }

  const settings = await ctx.runQuery(internal.auth.getSettingsInternal, {})
  const buffer = await file.arrayBuffer()
  if (!isPlausibleFileContent(file, buffer)) {
    return jsonResponse(
      request,
      {
        error:
          "File contents do not match a supported document type. Check that the file is not corrupted or renamed from another format.",
      },
      400,
    )
  }

  const sourceId = await ctx.runMutation(internal.knowledge.createSource, {
    title: file.name,
    sourceType: "document",
    status: "uploaded",
    topics: [],
    fileName: file.name,
    mimeType,
    size: file.size,
  })

  try {
    const storage = await uploadToFirebaseStorage(file, buffer, settings?.storageBucket)

    await ctx.runMutation(internal.knowledge.patchSource, {
      sourceId,
      status: storage ? "queued" : "integration_missing",
      summary:
        storage
          ? "Document uploaded to Firebase Storage and queued for AI retrieval."
          : "Document metadata was stored, but Firebase Storage credentials are not configured yet.",
      topics: [],
      storageBucket: storage?.bucket,
      storagePath: storage?.path,
      storageDownloadUrl: storage?.downloadUrl,
    })

    if (storage?.downloadUrl) {
      await ctx.scheduler.runAfter(0, internal.ai.indexStorageDocument, {
        sourceId,
        fileName: file.name,
        mimeType,
        storageDownloadUrl: storage.downloadUrl,
        fileSearchStoreName: settings?.fileSearchStoreName,
      })
    }

    return jsonResponse(request, { sourceId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed"
    await ctx.runMutation(internal.knowledge.patchSource, {
      sourceId,
      status: "failed",
      error: message,
    })
    return jsonResponse(request, { error: message }, 500)
  }
})

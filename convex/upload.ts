import { GoogleGenAI } from "@google/genai"

import { internal } from "./_generated/api"
import { httpAction } from "./_generated/server"

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

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  })
}

export const uploadOptions = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  })
})

function base64UrlEncode(input: string | ArrayBuffer) {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "")
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function decodeBase64(input: string) {
  const binary = atob(input)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new TextDecoder().decode(bytes)
}

function getServiceAccountCredentials() {
  const rawCredentials =
    (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64
      ? decodeBase64(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64)
      : null) ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON

  if (!rawCredentials) {
    return null
  }

  try {
    const credentials = JSON.parse(rawCredentials) as {
      client_email?: string
      private_key?: string
    }

    if (!credentials.client_email || !credentials.private_key) {
      throw new Error("Missing client_email or private_key")
    }

    return {
      clientEmail: credentials.client_email,
      privateKey: credentials.private_key,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Invalid JSON"
    throw new Error(
      `Google service account credentials are not valid JSON (${detail}). Remove malformed GOOGLE_SERVICE_ACCOUNT_JSON and set GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 from the downloaded service account file.`,
    )
  }
}

async function getDriveAccessToken() {
  const credentials = getServiceAccountCredentials()
  if (!credentials) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: credentials.clientEmail,
      scope: "https://www.googleapis.com/auth/drive.file",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }),
  )
  const signingInput = `${header}.${claim}`
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(credentials.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  )
  const assertion = `${signingInput}.${base64UrlEncode(signature)}`
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  })

  if (!response.ok) {
    throw new Error(`Google OAuth failed: ${await response.text()}`)
  }

  const json = (await response.json()) as { access_token?: string }
  if (!json.access_token) {
    throw new Error("Google OAuth did not return an access token")
  }
  return json.access_token
}

async function uploadToDrive(file: File, buffer: ArrayBuffer, folderId?: string) {
  if (!getServiceAccountCredentials() || !folderId) {
    return null
  }

  const accessToken = await getDriveAccessToken()
  if (!accessToken) {
    return null
  }

  const boundary = `cheesyguide-${crypto.randomUUID()}`
  const metadata = JSON.stringify({ name: file.name, parents: [folderId] })
  const body = new Blob([
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n`,
    metadata,
    `\r\n--${boundary}\r\ncontent-type: ${file.type || "application/octet-stream"}\r\n\r\n`,
    buffer,
    `\r\n--${boundary}--`,
  ])
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  )

  if (!response.ok) {
    throw new Error(`Google Drive upload failed: ${await response.text()}`)
  }

  const result = (await response.json()) as {
    id?: string
    webViewLink?: string
  }

  return {
    id: result.id,
    webViewLink: result.webViewLink,
  }
}

async function uploadToGemini(file: File, buffer: ArrayBuffer, storeName?: string) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return null
  }

  const ai = new GoogleGenAI({ apiKey })
  let fileSearchStoreName = storeName
  if (!fileSearchStoreName) {
    const created = await ai.fileSearchStores.create({
      config: { displayName: "CheesyGuide FRC 254 Knowledgebase" },
    })
    fileSearchStoreName = created.name
  }

  if (!fileSearchStoreName) {
    throw new Error("Gemini did not return a File Search store name")
  }

  const blob = new Blob([buffer], { type: file.type || "application/octet-stream" })
  const operation = await ai.fileSearchStores.uploadToFileSearchStore({
    fileSearchStoreName,
    file: blob,
    config: {
      displayName: file.name,
      mimeType: file.type || "application/octet-stream",
    },
  })

  return {
    fileSearchStoreName,
    operationName: operation.name,
  }
}

export const uploadDocument = httpAction(async (ctx, request) => {
  const formData = await request.formData()
  const sessionToken = String(formData.get("sessionToken") ?? "")
  const file = formData.get("file")

  if (!(file instanceof File)) {
    return jsonResponse({ error: "Missing file" }, 400)
  }

  if (!supportedMimeTypes.has(file.type)) {
    return jsonResponse(
      {
        error:
          "Unsupported file type. MVP uploads support PDF, Word, PowerPoint, Excel, text, and Markdown documents.",
      },
      400,
    )
  }

  const session = await ctx.runQuery(internal.auth.getSessionInternal, { sessionToken })
  if (!session || session.role !== "mentor") {
    return jsonResponse({ error: "Mentor access required" }, 403)
  }

  const settings = await ctx.runQuery(internal.auth.getSettingsInternal, {})
  const sourceId = await ctx.runMutation(internal.knowledge.createSource, {
    title: file.name,
    sourceType: "document",
    status: "uploaded",
    topics: [],
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
  })

  try {
    const buffer = await file.arrayBuffer()
    const drive = await uploadToDrive(file, buffer, settings?.driveFolderId)
    const gemini = await uploadToGemini(file, buffer, settings?.fileSearchStoreName)

    if (gemini?.fileSearchStoreName && !settings?.fileSearchStoreName) {
      await ctx.runMutation(internal.auth.setFileSearchStoreName, {
        fileSearchStoreName: gemini.fileSearchStoreName,
      })
    }

    await ctx.runMutation(internal.knowledge.patchSource, {
      sourceId,
      status: drive || gemini ? "indexed" : "integration_missing",
      summary:
        drive || gemini
          ? "Document uploaded and queued for AI retrieval."
          : "Document metadata was stored, but Drive and Gemini credentials are not configured yet.",
      topics: [],
      driveFileId: drive?.id,
      driveWebViewLink: drive?.webViewLink,
      geminiOperationName: gemini?.operationName,
    })

    return jsonResponse({ sourceId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed"
    await ctx.runMutation(internal.knowledge.patchSource, {
      sourceId,
      status: "failed",
      error: message,
    })
    return jsonResponse({ error: message }, 500)
  }
})

import { internal } from "./_generated/api"
import { httpAction } from "./_generated/server"

const DEFAULT_STORAGE_BUCKET = "cheesyguide-e2aee.firebasestorage.app"

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

function getGoogleCredentials() {
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
      `Google service account credentials are not valid JSON (${detail}). Set GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 from the downloaded service account file.`,
    )
  }
}

async function getGoogleAccessToken(scope: string) {
  const credentials = getGoogleCredentials()
  if (!credentials) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: credentials.clientEmail,
      scope,
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

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "document"
}

async function uploadToFirebaseStorage(
  file: File,
  buffer: ArrayBuffer,
  bucketName?: string,
) {
  if (!getGoogleCredentials()) {
    return null
  }

  const bucket = bucketName?.trim() || process.env.FIREBASE_STORAGE_BUCKET || DEFAULT_STORAGE_BUCKET
  const accessToken = await getGoogleAccessToken("https://www.googleapis.com/auth/devstorage.read_write")
  if (!accessToken) {
    return null
  }

  const objectPath = `knowledge-sources/${Date.now()}-${crypto.randomUUID()}-${safeFileName(file.name)}`
  const downloadToken = crypto.randomUUID()
  const boundary = `cheesyguide-${crypto.randomUUID()}`
  const contentType = file.type || "application/octet-stream"
  const metadata = JSON.stringify({
    name: objectPath,
    contentType,
    metadata: {
      firebaseStorageDownloadTokens: downloadToken,
      originalFileName: file.name,
    },
  })
  const body = new Blob([
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n`,
    metadata,
    `\r\n--${boundary}\r\ncontent-type: ${contentType}\r\n\r\n`,
    buffer,
    `\r\n--${boundary}--`,
  ])
  const response = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=multipart&fields=bucket,name,size`,
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
    throw new Error(`Firebase Storage upload failed: ${await response.text()}`)
  }

  const result = (await response.json()) as {
    bucket?: string
    name?: string
  }
  const storagePath = result.name ?? objectPath
  const storageBucket = result.bucket ?? bucket
  const encodedPath = encodeURIComponent(storagePath)

  return {
    bucket: storageBucket,
    path: storagePath,
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodedPath}?alt=media&token=${downloadToken}`,
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
    const storage = await uploadToFirebaseStorage(file, buffer, settings?.storageBucket)

    await ctx.runMutation(internal.knowledge.patchSource, {
      sourceId,
      status: storage ? "uploaded" : "integration_missing",
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
      await ctx.runAction(internal.ai.indexStorageDocument, {
        sourceId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        storageDownloadUrl: storage.downloadUrl,
        fileSearchStoreName: settings?.fileSearchStoreName,
      })
    }

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

type SourceLike = {
  _id: string
  title: string
  sourceType: "document" | "url" | "mentorNote"
  mimeType?: string
  fileName?: string
  url?: string
  storageDownloadUrl?: string
  createdAt?: number
}

function fileExtension(source: SourceLike) {
  const name = source.fileName ?? source.title
  const extension = name.split(".").pop()
  return extension && extension !== name ? extension.toUpperCase() : undefined
}

function documentTypeLabel(source: SourceLike) {
  if (source.mimeType === "application/pdf") return "PDF"
  if (source.mimeType?.includes("wordprocessingml") || source.mimeType === "application/msword") {
    return "Word Document"
  }
  if (source.mimeType?.includes("presentationml") || source.mimeType === "application/vnd.ms-powerpoint") {
    return "PowerPoint"
  }
  if (source.mimeType?.includes("spreadsheetml") || source.mimeType === "application/vnd.ms-excel") {
    return "Spreadsheet"
  }
  if (source.mimeType?.startsWith("text/")) return "Text Document"
  return fileExtension(source) ?? "Document"
}

function sourceTypeLabel(source: SourceLike) {
  if (source.sourceType === "url") return "Website"
  if (source.sourceType === "mentorNote") return "Mentor Textbook"
  return documentTypeLabel(source)
}

function sourceGroupLabel(source: SourceLike) {
  if (source.sourceType === "url") return "Websites"
  if (source.sourceType === "mentorNote") return "Mentor Knowledge"
  const label = documentTypeLabel(source)
  return label === "PDF" ? "PDFs" : `${label}s`
}

function sourceHref(source: SourceLike) {
  if (source.sourceType === "mentorNote") return `/sources/${source._id}`
  return source.url ?? source.storageDownloadUrl ?? `/sources/${source._id}`
}

function sourceOpensExternally(source: SourceLike) {
  return source.sourceType !== "mentorNote" && Boolean(source.url ?? source.storageDownloadUrl)
}

function formatSourceDate(timestamp?: number) {
  if (!timestamp) return "Unknown date"
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp))
}

export {
  formatSourceDate,
  sourceGroupLabel,
  sourceHref,
  sourceOpensExternally,
  sourceTypeLabel,
}

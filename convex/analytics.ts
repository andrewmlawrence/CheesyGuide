import { internalMutation, query } from "./_generated/server"
import { v } from "convex/values"
import { requireSession } from "./lib/authz"

const answerModeValidator = v.union(
  v.literal("sourcesOnly"),
  v.literal("sourcesPlusGeneral"),
  v.literal("sourcesPlusWeb"),
)

const periodValidator = v.union(
  v.literal("1m"),
  v.literal("3m"),
  v.literal("6m"),
  v.literal("all"),
)

const stopWords = new Set([
  "about",
  "after",
  "again",
  "answer",
  "because",
  "before",
  "between",
  "could",
  "design",
  "does",
  "frc",
  "from",
  "have",
  "help",
  "into",
  "know",
  "like",
  "make",
  "more",
  "need",
  "robot",
  "should",
  "team",
  "tell",
  "that",
  "their",
  "there",
  "these",
  "thing",
  "this",
  "using",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
])

function normalizeQuestion(question: string) {
  return question.trim().replace(/\s+/g, " ").slice(0, 500)
}

function conceptsForQuestion(question: string) {
  const normalized = question
    .toLowerCase()
    .replace(/[^a-z0-9+\-#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  const phrases = Array.from(normalized.matchAll(/\b[a-z0-9+#-]+\s+[a-z0-9+#-]+\b/g))
    .map((match) => match[0])
  const words = normalized
    .split(" ")
    .filter((word) => word.length >= 4 && !stopWords.has(word))
  const candidates = [...phrases, ...words]
  const unique: string[] = []

  for (const candidate of candidates) {
    const value = candidate.trim()
    if (!value || unique.includes(value)) continue
    unique.push(value)
    if (unique.length >= 8) break
  }

  return unique.length > 0 ? unique : ["general question"]
}

function periodStart(period: "1m" | "3m" | "6m" | "all") {
  if (period === "all") return null
  const days = period === "1m" ? 30 : period === "3m" ? 90 : 180
  return Date.now() - days * 24 * 60 * 60 * 1000
}

export const recordTeacherQuestion = internalMutation({
  args: {
    question: v.string(),
    answered: v.boolean(),
    answerMode: answerModeValidator,
    role: v.union(v.literal("student"), v.literal("mentor")),
    citationsCount: v.number(),
  },
  handler: async (ctx, args) => {
    const normalizedQuestion = normalizeQuestion(args.question)
    if (!normalizedQuestion) return null

    return await ctx.db.insert("teacherQuestions", {
      question: args.question.slice(0, 1000),
      normalizedQuestion,
      concepts: conceptsForQuestion(normalizedQuestion),
      answered: args.answered,
      answerMode: args.answerMode,
      role: args.role,
      citationsCount: args.citationsCount,
      createdAt: Date.now(),
    })
  },
})

export const getTeacherAnalytics = query({
  args: {
    sessionToken: v.string(),
    period: periodValidator,
  },
  handler: async (ctx, args) => {
    await requireSession(ctx.db, args.sessionToken, "mentor")

    const since = periodStart(args.period)
    const questions = since
      ? await ctx.db
          .query("teacherQuestions")
          .withIndex("by_createdAt", (q) => q.gte("createdAt", since))
          .order("desc")
          .take(1000)
      : await ctx.db.query("teacherQuestions").withIndex("by_createdAt").order("desc").take(1000)
    const unanswered = since
      ? await ctx.db
          .query("teacherQuestions")
          .withIndex("by_answered_and_createdAt", (q) =>
            q.eq("answered", false).gte("createdAt", since),
          )
          .order("desc")
          .take(50)
      : await ctx.db
          .query("teacherQuestions")
          .withIndex("by_answered_and_createdAt", (q) => q.eq("answered", false))
          .order("desc")
          .take(50)
    const conceptCounts = new Map<string, number>()

    for (const question of questions) {
      for (const concept of question.concepts) {
        conceptCounts.set(concept, (conceptCounts.get(concept) ?? 0) + 1)
      }
    }

    return {
      totalQuestions: questions.length,
      unansweredCount: questions.filter((question) => !question.answered).length,
      concepts: Array.from(conceptCounts.entries())
        .map(([concept, count]) => ({ concept, count }))
        .sort((a, b) => b.count - a.count || a.concept.localeCompare(b.concept))
        .slice(0, 20),
      unanswered: unanswered.map((question) => ({
        _id: question._id,
        question: question.normalizedQuestion,
        concepts: question.concepts,
        answerMode: question.answerMode,
        createdAt: question.createdAt,
      })),
    }
  },
})

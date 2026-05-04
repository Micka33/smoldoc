import OpenAI from "openai";
import type { Pool } from "pg";
import type { FetchPageResult } from "./fetchPages.js";
import { answerCacheKey } from "../util/hash.js";

export type SynthesisResult = {
  answerMarkdown: string;
  sources: { url: string; note?: string }[];
  fromAnswerCache: boolean;
};

export async function synthesizeDocumentationAnswer(options: {
  pool: Pool;
  openai: OpenAI;
  model: string;
  reasoningEffort: "low" | "medium" | "high";
  goal: string;
  context: string | undefined;
  docVersion: string;
  pages: FetchPageResult[];
}): Promise<SynthesisResult> {
  const urls = options.pages.map((p) => p.url);
  const key = answerCacheKey({
    goal: options.goal,
    docVersion: options.docVersion,
    model: options.model,
    urls,
  });

  const cached = await options.pool.query<{ answer_markdown: string; sources_json: unknown }>(
    `SELECT answer_markdown, sources_json FROM answer_cache WHERE cache_key = $1`,
    [key],
  );
  if (cached.rows[0]) {
    return {
      answerMarkdown: cached.rows[0].answer_markdown,
      sources: (cached.rows[0].sources_json as { url: string; note?: string }[]) ?? [],
      fromAnswerCache: true,
    };
  }

  const bundle = options.pages
    .map(
      (p, i) =>
        `### Source ${i + 1}: ${p.url}\n(revalidated304=${p.revalidated304}, http=${p.status})\n\n${p.markdown}\n`,
    )
    .join("\n---\n\n");

  const userPrompt = [
    options.context ? `Additional context from the caller:\n${options.context}\n` : "",
    `Documentation version label: ${options.docVersion}`,
    "",
    "Goal (what the caller needs):",
    options.goal,
    "",
    "Extracted documentation text:",
    bundle,
    "",
    "Respond in GitHub-flavored Markdown with:",
    "1) A short **Action** section: what to do, in imperative form.",
    "2) If applicable, a **Command** section with a copy-paste shell command and a minimal example.",
    "3) **Notes**: prerequisites, defaults, breaking changes if inferable.",
    "4) **Sources**: bullet list of URLs you relied on most.",
    "Be precise; if the provided text is insufficient, say what is missing instead of inventing APIs.",
  ].join("\n");

  const completion = (await options.openai.chat.completions.create({
    model: options.model,
    messages: [
      {
        role: "system",
        content:
          "You are smoldoc, a documentation research assistant. You produce concise, actionable answers for another AI agent. Prefer exact flags and commands from the provided text.",
      },
      { role: "user", content: userPrompt },
    ],
    reasoning_effort: options.reasoningEffort,
  } as Parameters<typeof options.openai.chat.completions.create>[0])) as import("openai/resources/chat/completions").ChatCompletion;

  const answerMarkdown =
    completion.choices[0]?.message?.content?.trim() ??
    "(empty model response)";

  const sources = urls.map((u) => ({ url: u }));

  await options.pool.query(
    `INSERT INTO answer_cache (cache_key, doc_version, model, answer_markdown, sources_json)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (cache_key) DO NOTHING`,
    [key, options.docVersion, options.model, answerMarkdown, JSON.stringify(sources)],
  );

  return { answerMarkdown, sources, fromAnswerCache: false };
}

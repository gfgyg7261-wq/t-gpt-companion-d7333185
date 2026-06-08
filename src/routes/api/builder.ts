import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { generateText } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";

const SYSTEM = `You are T-GPT Builder, an elite AI engineer by the TigerHost team. You build COMPLETE, beautiful, production-ready React + TypeScript web applications — not just single HTML files. Think like Lovable: real multi-file projects with components, styles, state and logic.

OUTPUT FORMAT (CRITICAL):
Respond with ONLY a single JSON object — no markdown, no commentary, no code fences. Shape:
{
  "summary": "1-2 sentence description of what you built/changed",
  "entry": "/App.tsx",
  "files": [
    { "path": "/App.tsx", "language": "tsx", "content": "..." },
    { "path": "/components/Hero.tsx", "language": "tsx", "content": "..." },
    { "path": "/styles.css", "language": "css", "content": "..." }
  ]
}

ENVIRONMENT (Sandpack react-ts):
- The project runs in a Sandpack "react-ts" sandbox that bundles in the browser.
- The entry is /index.tsx (already provided by the runtime) which imports and renders the default export of /App.tsx. You MUST always include /App.tsx with a default-exported React component.
- All file paths MUST start with "/". Use folders like /components, /pages, /lib, /hooks.
- Import CSS with: import "./styles.css"; (relative paths from each file).
- You MAY use these npm packages (Sandpack auto-installs from package.json): react, react-dom, lucide-react, framer-motion, clsx. If you use any other package, add it to /package.json dependencies.
- Plain CSS only (no Tailwind build step). Write rich, modern CSS in /styles.css and additional .css files. You can also use inline styles.

RULES:
1. Build real, multi-file apps: split into components, keep files focused. For bigger requests create many files (pages, components, data, hooks).
2. Always include /App.tsx (default export). Always include at least one CSS file imported by App.
3. Make it visually stunning: bold gradients, smooth framer-motion animations, responsive, accessible. Vibrant orange/red palette fits the TigerHost brand when appropriate.
4. If CURRENT_FILES are provided, treat them as the existing project and APPLY the requested changes — return the FULL set of files for the updated project (every file you want to keep), not a diff.
5. NEVER mention ChatGPT, OpenAI, Gemini, Claude, Anthropic, or any AI brand. You are T-GPT Builder.
6. Output MUST be valid JSON with properly escaped strings. Every file's content must be non-empty.`;

const ALLOWED_MODELS = new Set([
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "openai/gpt-5-mini",
  "openai/gpt-5",
]);

const EXT_LANG: Record<string, string> = {
  tsx: "tsx", ts: "ts", jsx: "jsx", js: "js", css: "css", html: "html",
  json: "json", md: "md", svg: "svg", txt: "txt", env: "txt",
};
const ALLOWED_EXT = new Set(Object.keys(EXT_LANG));

type BuilderFile = { path: string; content: string; language: string };

function langForPath(path: string, fallback?: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? fallback ?? "txt";
}

function tryParse(raw: string): { summary: string; entry: string; files: BuilderFile[] } | null {
  let s = raw.trim();
  s = s.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1) return null;
  try {
    const obj = JSON.parse(s.slice(first, last + 1));
    if (!Array.isArray(obj.files)) return null;
    const files: BuilderFile[] = [];
    for (const f of obj.files) {
      if (!f || typeof f.path !== "string" || typeof f.content !== "string") continue;
      let path = f.path.trim();
      if (!path.startsWith("/")) path = "/" + path;
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED_EXT.has(ext)) continue;
      if (!f.content) continue;
      files.push({ path, content: f.content, language: langForPath(path, f.language) });
    }
    if (files.length === 0) return null;
    const hasApp = files.some((f) => f.path.toLowerCase() === "/app.tsx" || f.path.toLowerCase() === "/app.jsx");
    if (!hasApp) return null;
    return {
      summary: typeof obj.summary === "string" ? obj.summary : "Updated project.",
      entry: typeof obj.entry === "string" ? obj.entry : "/App.tsx",
      files,
    };
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/builder")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const auth = request.headers.get("authorization");
        const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
        if (!token) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

        const SUPABASE_URL = process.env.SUPABASE_URL!;
        const SUPABASE_ANON = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), { status: 500 });

        const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const admin = createClient(SUPABASE_URL, SERVICE, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
        if (claimsErr || !claimsData?.claims?.sub) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }
        const userId = claimsData.claims.sub as string;

        const body = (await request.json()) as {
          prompt: string;
          threadId: string;
          current?: { path: string; content: string }[];
          model?: string;
          images?: string[];
        };
        if (!body?.prompt || !body?.threadId) {
          return new Response(JSON.stringify({ error: "Missing prompt or threadId" }), { status: 400 });
        }

        const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
        if (!isAdmin) {
          const { data: bal } = await admin.rpc("spend_credit", { _user_id: userId });
          if (bal === -1 || bal === null) {
            return new Response(JSON.stringify({ error: "Out of credits. Come back tomorrow or upgrade on Discord." }), { status: 402 });
          }
        }

        // Verify thread ownership (prevents IDOR)
        const { data: ownThread } = await admin
          .from("builder_threads")
          .select("id")
          .eq("id", body.threadId)
          .eq("user_id", userId)
          .maybeSingle();
        if (!ownThread) {
          return new Response(JSON.stringify({ error: "Thread not found" }), { status: 404 });
        }

        await admin.from("builder_messages").insert({
          thread_id: body.threadId, user_id: userId, role: "user", content: body.prompt,
        });

        const modelId = body.model && ALLOWED_MODELS.has(body.model) ? body.model : "google/gemini-2.5-pro";
        const current = Array.isArray(body.current) ? body.current : [];
        const userText = current.length
          ? `CURRENT_FILES:\n${current.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n")}\n\nCHANGES REQUESTED:\n${body.prompt}`
          : body.prompt;

        const gateway = createLovableAiGatewayProvider(apiKey);
        const model = gateway(modelId);

        let result;
        try {
          result = await generateText({ model, system: SYSTEM, prompt: userText });
        } catch (e) {
          console.error("Builder AI error:", e instanceof Error ? e.message : String(e));
          return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }), { status: 500 });
        }

        const parsed = tryParse(result.text);
        if (!parsed) {
          return new Response(JSON.stringify({ error: "AI returned invalid format. Try again." }), { status: 502 });
        }

        const nowIso = new Date().toISOString();

        // Upsert returned files
        const rows = parsed.files.map((f) => ({
          thread_id: body.threadId,
          user_id: userId,
          path: f.path,
          content: f.content,
          language: f.language,
          updated_at: nowIso,
        }));
        await admin.from("builder_files").upsert(rows, { onConflict: "thread_id,path" });

        // Delete files no longer present
        const keepPaths = parsed.files.map((f) => f.path);
        const { data: existing } = await admin
          .from("builder_files")
          .select("path")
          .eq("thread_id", body.threadId);
        const toDelete = (existing ?? []).map((r) => r.path).filter((p) => !keepPaths.includes(p));
        if (toDelete.length) {
          await admin.from("builder_files").delete().eq("thread_id", body.threadId).in("path", toDelete);
        }

        await admin.from("builder_messages").insert({
          thread_id: body.threadId, user_id: userId, role: "assistant", content: parsed.summary,
        });
        await admin.from("builder_threads")
          .update({ entry_path: parsed.entry, updated_at: nowIso })
          .eq("id", body.threadId).eq("user_id", userId);

        // Title from first user message
        const { data: msgs } = await admin
          .from("builder_messages")
          .select("id")
          .eq("thread_id", body.threadId)
          .eq("role", "user");
        if ((msgs?.length ?? 0) <= 1) {
          await admin.from("builder_threads")
            .update({ title: body.prompt.slice(0, 60) })
            .eq("id", body.threadId)
            .eq("user_id", userId)
            .eq("title", "New site");
        }

        const { data: cred } = await admin.from("credits").select("balance").eq("user_id", userId).maybeSingle();

        return Response.json({
          summary: parsed.summary,
          entry: parsed.entry,
          files: parsed.files,
          credits: cred?.balance ?? null,
        });
      },
    },
  },
});

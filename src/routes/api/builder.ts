import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { streamText } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";

const SYSTEM = `You are T-GPT Builder, an AI website builder created by the T-GPT team. You generate complete, beautiful, production-ready single-file websites.

CRITICAL RULES:
1. Output ONLY a single complete HTML document. No markdown fences, no explanations, no commentary before or after. Start with <!DOCTYPE html> and end with </html>.
2. Inline ALL CSS in a <style> tag and ALL JS in a <script> tag inside the same file. No external files.
3. You MAY use these CDNs via <link>/<script>: Tailwind Play CDN (https://cdn.tailwindcss.com), Google Fonts, Lucide icons, Alpine.js, Three.js. Prefer Tailwind for styling.
4. Make it visually stunning: bold gradients, modern typography, smooth animations, responsive design, accessible. Use vibrant colors and creative layouts.
5. If the user provides existing HTML in their message (after a marker like "CURRENT_HTML:"), treat it as the current site and apply their requested changes — do NOT start from scratch unless they ask.
6. NEVER mention ChatGPT, OpenAI, Gemini, Claude, or any other AI brand. You are T-GPT.
7. The output must be a working, self-contained HTML file that runs immediately when opened in a browser.`;

export const Route = createFileRoute("/api/builder")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const body = (await request.json()) as {
          prompt: string;
          currentHtml?: string;
          model?: string;
        };
        if (!body?.prompt) return new Response("Missing prompt", { status: 400 });

        const ALLOWED = new Set([
          "google/gemini-3-flash-preview",
          "google/gemini-2.5-flash",
          "google/gemini-2.5-pro",
          "openai/gpt-5-mini",
          "openai/gpt-5",
        ]);
        const modelId =
          body.model && ALLOWED.has(body.model) ? body.model : "google/gemini-2.5-pro";

        const userText = body.currentHtml
          ? `CURRENT_HTML:\n${body.currentHtml}\n\nCHANGES REQUESTED:\n${body.prompt}`
          : body.prompt;

        const gateway = createLovableAiGatewayProvider(apiKey);
        const model = gateway(modelId);

        const result = streamText({
          model,
          system: SYSTEM,
          messages: [{ role: "user", content: userText }],
        });

        return result.toTextStreamResponse();
      },
    },
  },
});

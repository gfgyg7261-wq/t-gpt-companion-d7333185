import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";

export const Route = createFileRoute("/api/guest-chat")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const body = (await request.json()) as { messages: UIMessage[]; model?: string };
        const { messages } = body;
        if (!Array.isArray(messages)) return new Response("Bad request", { status: 400 });

        // Hard cap server-side: count user messages, refuse if >5
        const userCount = messages.filter((m) => m.role === "user").length;
        if (userCount > 5) {
          return new Response("Sign in to continue chatting.", { status: 402 });
        }

        const ALLOWED = new Set([
          "google/gemini-3-flash-preview",
          "google/gemini-2.5-flash",
          "google/gemini-2.5-pro",
          "openai/gpt-5-mini",
          "openai/gpt-5",
        ]);
        const modelId = body.model && ALLOWED.has(body.model) ? body.model : "google/gemini-3-flash-preview";

        const gateway = createLovableAiGatewayProvider(apiKey);
        const model = gateway(modelId);

        const result = streamText({
          model,
          system:
            "You are T-GPT, a powerful, witty, and deeply knowledgeable AI assistant — on par with the best general-purpose assistants. You can help with: coding (write, debug, explain in any language), math and science, writing (essays, emails, stories, marketing copy), brainstorming, summarization, translation, step-by-step reasoning, study help, careers, productivity, life advice, creative ideas, recipes, travel, and general knowledge. Always format with rich markdown: headings, **bold**, bullet/numbered lists, tables, and ```fenced code blocks``` with language tags. Be thorough but concise. If you don't know something, say so honestly. Keep an energetic, friendly voice.",
          messages: await convertToModelMessages(messages),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          onError: (error) => {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg.includes("429")) return "Rate limit reached. Please wait a moment and try again.";
            if (msg.includes("402")) return "AI credits exhausted. Please add credits in Lovable Cloud settings.";
            return msg;
          },
        });
      },
    },
  },
});

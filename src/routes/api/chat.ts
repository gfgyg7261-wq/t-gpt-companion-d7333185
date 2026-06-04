import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";

async function generateAndStoreImage(prompt: string, apiKey: string, admin: ReturnType<typeof createClient<any>>, userId: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-image-2",
      prompt,
      quality: "low",
      size: "1024x1024",
      n: 1,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Image generation failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image returned");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const path = `${userId}/${crypto.randomUUID()}.png`;
  const { error: upErr } = await admin.storage.from("ai-images").upload(path, bytes, {
    contentType: "image/png",
    upsert: false,
  });
  if (upErr) throw new Error(upErr.message);
  const { data: signed, error: signErr } = await admin.storage
    .from("ai-images")
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (signErr || !signed?.signedUrl) throw new Error(signErr?.message || "Could not sign URL");
  return signed.signedUrl;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const auth = request.headers.get("authorization");
        const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
        if (!token) return new Response("Unauthorized", { status: 401 });

        const SUPABASE_URL = process.env.SUPABASE_URL!;
        const SUPABASE_ANON = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const admin = createClient(SUPABASE_URL, SERVICE, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
        if (claimsErr || !claimsData?.claims?.sub) return new Response("Unauthorized", { status: 401 });
        const userId = claimsData.claims.sub as string;

        const body = (await request.json()) as {
          messages: UIMessage[];
          threadId: string;
          model?: string;
        };
        const { messages, threadId } = body;
        const ALLOWED = new Set([
          "google/gemini-3-flash-preview",
          "google/gemini-3.5-flash",
          "google/gemini-2.5-flash",
          "google/gemini-2.5-pro",
          "google/gemini-3.1-pro-preview",
          "openai/gpt-5-mini",
          "openai/gpt-5",
          "openai/gpt-5.2",
        ]);
        const modelId = body.model && ALLOWED.has(body.model) ? body.model : "google/gemini-3-flash-preview";
        if (!Array.isArray(messages) || !threadId) {
          return new Response("Bad request", { status: 400 });
        }

        // Persist the latest user message
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        if (lastUser) {
          await supabase.from("messages").insert({
            thread_id: threadId,
            user_id: userId,
            role: "user",
            parts: lastUser.parts as unknown as object,
          });

          const text = lastUser.parts
            .map((p) => (p.type === "text" ? (p as { text: string }).text : ""))
            .join(" ")
            .trim();
          if (text) {
            await supabase
              .from("threads")
              .update({ title: text.slice(0, 60), updated_at: new Date().toISOString() })
              .eq("id", threadId)
              .eq("title", "New chat");
            await supabase
              .from("threads")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", threadId);
          }
        }

        const gateway = createLovableAiGatewayProvider(apiKey);
        const model = gateway(modelId);

        const result = streamText({
          model,
          stopWhen: stepCountIs(6),
          tools: {
            generate_image: tool({
              description:
                "Generate an image from a text description. Use this whenever the user asks to create, draw, generate, design, or make an image, picture, logo, illustration, or artwork. Returns a URL you must render in markdown as ![alt](url).",
              inputSchema: z.object({
                prompt: z.string().min(1).max(1500).describe("A detailed, vivid description of the image to generate"),
              }),
              execute: async ({ prompt }) => {
                try {
                  const url = await generateAndStoreImage(prompt, apiKey, admin, userId);
                  return { url, status: "ok" as const };
                } catch (e) {
                  console.error("generate_image error", e);
                  return { status: "error" as const, message: "Image generation failed. Please try again." };
                }
              },
            }),
          },
          system:
            "You are T-GPT, a powerful, witty, and deeply knowledgeable AI assistant created by the T-GPT team. IMPORTANT BRANDING RULES: Always refer to yourself as T-GPT. NEVER mention ChatGPT, OpenAI, Google, Gemini, Anthropic, Claude, DeepSeek, or any other AI brand/company. If asked which model or company powers you, say you are T-GPT, built by the T-GPT team. IMAGE GENERATION: You can create images. When the user asks you to create/draw/generate/design/make any image, picture, logo, or illustration, call the generate_image tool with a vivid detailed prompt, then in your reply render the returned URL as a markdown image: ![description](url). You can also analyze images the user uploads. You can help with: coding, math and science, writing, brainstorming, summarization, translation, reasoning, study help, and general knowledge. Always format with rich markdown: headings, **bold**, lists, tables, and ```fenced code blocks``` with language tags. Be thorough but concise. Keep an energetic, friendly voice.",
          messages: await convertToModelMessages(messages),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          onFinish: async ({ responseMessage }) => {
            try {
              await supabase.from("messages").insert({
                thread_id: threadId,
                user_id: userId,
                role: "assistant",
                parts: responseMessage.parts as unknown as object,
              });
            } catch (e) {
              console.error("Failed to save assistant message", e);
            }
          },
          onError: (error) => {
            const msg = error instanceof Error ? error.message : String(error);
            console.error("Chat AI error:", msg);
            if (msg.includes("429")) return "Rate limit reached. Please wait a moment and try again.";
            if (msg.includes("402")) return "AI credits exhausted. Please add credits in Lovable Cloud settings.";
            return "An unexpected error occurred. Please try again.";
          },
        });
      },
    },
  },
});

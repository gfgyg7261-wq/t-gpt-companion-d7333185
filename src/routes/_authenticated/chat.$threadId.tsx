import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { ImageGenLoader } from "@/components/ai-elements/image-gen-loader";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, RefreshCw, Check, Paperclip, X } from "lucide-react";
import logo from "@/assets/tgpt-logo.png";

const search = z.object({ q: z.string().optional() });

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  validateSearch: search,
  component: ChatPage,
});

const MODELS = [
  { id: "google/gemini-3-flash-preview", label: "TigerGPT v3 Flash · Fast" },
  { id: "google/gemini-3.5-flash", label: "TigerGPT v3.5 Flash" },
  { id: "google/gemini-2.5-flash", label: "TigerGPT v2.5 Flash" },
  { id: "google/gemini-2.5-pro", label: "TigerGPT v2.5 Pro · Smart" },
  { id: "google/gemini-3.1-pro-preview", label: "TigerGPT v3.1 Pro · Genius" },
  { id: "openai/gpt-5-mini", label: "Tiger-5 Mini" },
  { id: "openai/gpt-5", label: "Tiger-5 · Powerful" },
  { id: "openai/gpt-5.2", label: "Tiger-5.2 · Reasoning" },
];

function AttachmentBar() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 px-1 pb-2">
      {attachments.files.map((f) => (
        <div key={f.id} className="relative group">
          {f.mediaType?.startsWith("image/") ? (
            <img
              src={f.url}
              alt={f.filename ?? "attachment"}
              className="h-16 w-16 rounded-lg object-cover border border-border"
            />
          ) : (
            <div className="h-16 w-16 rounded-lg border border-border bg-muted flex items-center justify-center text-[10px] p-1 text-center">
              {f.filename ?? "file"}
            </div>
          )}
          <button
            type="button"
            onClick={() => attachments.remove(f.id)}
            className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function AttachButton() {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton
      tooltip="Upload a photo"
      onClick={() => attachments.openFileDialog()}
    >
      <Paperclip className="size-4" />
    </PromptInputButton>
  );
}

function ChatPage() {
  const { threadId } = Route.useParams();
  const { q } = Route.useSearch();
  const qc = useQueryClient();
  const autoSentRef = useRef<string | null>(null);

  const [model, setModel] = useState<string>(() => {
    if (typeof window === "undefined") return MODELS[0].id;
    return localStorage.getItem("tgpt:model") ?? MODELS[0].id;
  });
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("tgpt:model", model);
  }, [model]);

  const { data: initialMessages, isLoading } = useQuery({
    queryKey: ["messages", threadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id,role,parts,created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        parts: Array.isArray(m.parts) ? m.parts : [{ type: "text", text: "" }],
      }));
    },
  });

  const initial = useMemo<UIMessage[]>(
    () =>
      (initialMessages ?? []).map((m) => ({
        id: m.id,
        role: m.role,
        parts: m.parts,
      })) as UIMessage[],
    [initialMessages],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: async ({ messages, body }) => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          const headers: Record<string, string> = {};
          if (token) headers.Authorization = `Bearer ${token}`;
          return {
            headers,
            body: { messages, threadId, model, ...(body ?? {}) },
          };
        },
      }),
    [threadId, model],
  );

  const { messages, sendMessage, status, setMessages, regenerate } = useChat({
    id: threadId,
    messages: initial,
    transport,
    onError: (err) => toast.error(err.message || "Something went wrong"),
    onFinish: () => qc.invalidateQueries({ queryKey: ["threads"] }),
  });

  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!q || autoSentRef.current === threadId) return;
    if (isLoading) return;
    if (initial.length > 0) {
      autoSentRef.current = threadId;
      return;
    }
    autoSentRef.current = threadId;
    sendMessage({ text: q });
  }, [q, threadId, isLoading, initial.length, sendMessage]);

  const handleSubmit = (msg: PromptInputMessage) => {
    const text = (msg.text ?? "").trim();
    const files = msg.files ?? [];
    if ((!text && files.length === 0) || status === "submitted" || status === "streaming") return;
    sendMessage({ text, files });
    setInput("");
  };

  const copyMessage = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const handleRegenerate = async () => {
    if (status === "submitted" || status === "streaming") return;
    const lastIdx = [...messages].reverse().findIndex((m) => m.role === "assistant");
    if (lastIdx === -1) return;
    const idx = messages.length - 1 - lastIdx;
    setMessages(messages.slice(0, idx));
    try {
      const { data: rows } = await supabase
        .from("messages")
        .select("id")
        .eq("thread_id", threadId)
        .eq("role", "assistant")
        .order("created_at", { ascending: false })
        .limit(1);
      const id = rows?.[0]?.id;
      if (id) await supabase.from("messages").delete().eq("id", id);
    } catch {
      /* non-fatal */
    }
    regenerate();
  };

  const showShimmer = status === "submitted";
  const isStreaming = status === "streaming" || status === "submitted";
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border/60 backdrop-blur bg-background/40">
        <div className="pl-10 md:pl-0 text-xs text-muted-foreground truncate">T-GPT</div>
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger className="h-8 w-[220px] text-xs bg-card/60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODELS.map((m) => (
              <SelectItem key={m.id} value={m.id} className="text-xs">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Conversation className="flex-1">
        <ConversationContent className="max-w-3xl mx-auto w-full px-4 py-6">
          {messages.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
              <img
                src={logo}
                alt="T-GPT"
                className="h-16 w-16 mb-4 opacity-90"
                width={64}
                height={64}
              />
              <p className="text-muted-foreground">Ask me anything — or upload a photo to analyze.</p>
            </div>
          )}
          {messages.map((m) => {
            const text = m.parts
              .map((p) => (p.type === "text" ? (p as { text: string }).text : ""))
              .join("");
            const imageParts = m.parts.filter(
              (p) =>
                p.type === "file" &&
                ((p as { mediaType?: string }).mediaType?.startsWith("image/") ?? false),
            ) as Array<{ url: string; filename?: string }>;
            // detect an in-progress image generation tool call
            const generatingImage = m.parts.some((p) => {
              const t = (p as { type?: string }).type ?? "";
              const state = (p as { state?: string }).state;
              return (
                t === "tool-generate_image" &&
                state !== "output-available" &&
                state !== "output-error"
              );
            });
            const isAssistant = m.role === "assistant";
            const isLast = m.id === lastAssistantId;
            return (
              <Message key={m.id} from={m.role}>
                {isAssistant ? (
                  <div className="space-y-2">
                    {generatingImage && <ImageGenLoader />}
                    {text && <MessageResponse>{text}</MessageResponse>}
                    {!isStreaming && text && (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => copyMessage(m.id, text)}
                        >
                          {copiedId === m.id ? (
                            <Check className="h-3 w-3 mr-1" />
                          ) : (
                            <Copy className="h-3 w-3 mr-1" />
                          )}
                          {copiedId === m.id ? "Copied" : "Copy"}
                        </Button>
                        {isLast && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={handleRegenerate}
                          >
                            <RefreshCw className="h-3 w-3 mr-1" />
                            Regenerate
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <MessageContent className="!bg-chat-user !text-chat-user-foreground shadow-glow">
                    {imageParts.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {imageParts.map((img, i) => (
                          <img
                            key={i}
                            src={img.url}
                            alt={img.filename ?? "upload"}
                            className="max-h-48 rounded-lg border border-white/20"
                          />
                        ))}
                      </div>
                    )}
                    {text}
                  </MessageContent>
                )}
              </Message>
            );
          })}
          {showShimmer && (
            <div className="px-4 py-2">
              <Shimmer>T-GPT is thinking...</Shimmer>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border bg-background/60 backdrop-blur">
        <div className="max-w-3xl mx-auto w-full px-4 py-4">
          <PromptInput onSubmit={handleSubmit} accept="image/*" multiple>
            <AttachmentBar />
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message T-GPT — or attach a photo..."
            />
            <PromptInputFooter>
              <PromptInputTools>
                <AttachButton />
              </PromptInputTools>
              <PromptInputSubmit
                status={status}
                disabled={status === "submitted" || status === "streaming"}
              />
            </PromptInputFooter>
          </PromptInput>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            T-GPT can make mistakes. Verify important info.
          </p>
        </div>
      </div>
    </div>
  );
}

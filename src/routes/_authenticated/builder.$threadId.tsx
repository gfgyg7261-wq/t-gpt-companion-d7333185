import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  SandpackProvider, SandpackLayout, SandpackCodeEditor, SandpackPreview, SandpackFileExplorer,
} from "@codesandbox/sandpack-react";
import JSZip from "jszip";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { UpgradeDialog } from "@/components/upgrade-dialog";
import {
  Sparkles, Eye, Code2, Globe, Crown, Download, Send, Loader2, Wand2, ArrowLeft, Coins, Paperclip, X,
} from "lucide-react";
import { toast } from "sonner";

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export const Route = createFileRoute("/_authenticated/builder/$threadId")({
  component: BuilderEditor,
});

type DbFile = { path: string; content: string; language: string };

const STARTER_FILES: DbFile[] = [
  {
    path: "/App.tsx",
    language: "tsx",
    content: `import "./styles.css";

export default function App() {
  return (
    <div className="hero">
      <h1>✨ Your app appears here</h1>
      <p>Tell T-GPT what to build — full React projects, not just HTML.</p>
    </div>
  );
}
`,
  },
  {
    path: "/styles.css",
    language: "css",
    content: `body { margin: 0; font-family: system-ui, sans-serif; }
.hero {
  min-height: 100vh;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  text-align: center; padding: 2rem;
  background: linear-gradient(135deg, #1a0d05, #2d1206);
  color: #fff;
}
.hero h1 {
  font-size: 3rem; margin: 0 0 .5rem;
  background: linear-gradient(90deg, #ff8c3c, #ff3c3c);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.hero p { opacity: .7; }
`,
  },
];

const SUGGESTIONS = [
  "A multi-page SaaS dashboard with sidebar, charts and cards",
  "A bold orange AI photo editor landing page with animations",
  "A todo app with add, complete, filter and local state",
  "A portfolio site with hero, projects grid and contact form",
];

function BuilderEditor() {
  const { threadId } = Route.useParams();
  const qc = useQueryClient();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { data: thread, isLoading } = useQuery({
    queryKey: ["builder-thread", threadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("builder_threads")
        .select("id,title,entry_path")
        .eq("id", threadId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const { data: dbFiles = [] } = useQuery({
    queryKey: ["builder-files", threadId],
    queryFn: async (): Promise<DbFile[]> => {
      const { data, error } = await supabase
        .from("builder_files")
        .select("path,content,language")
        .eq("thread_id", threadId)
        .order("path", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["builder-messages", threadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("builder_messages")
        .select("id,role,content,created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const { data: credits, refetch: refetchCredits } = useQuery({
    queryKey: ["credits"],
    queryFn: async () => {
      const { data } = await supabase.from("credits").select("balance").maybeSingle();
      return data?.balance ?? 0;
    },
  });

  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"preview" | "code">("preview");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  const onPickImages = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const urls = await Promise.all([...files].slice(0, 4).map(fileToDataUrl));
      setImages((prev) => [...prev, ...urls].slice(0, 4));
    } catch {
      toast.error("Couldn't read image");
    }
  };

  const activeFiles: DbFile[] = dbFiles.length ? dbFiles : STARTER_FILES;

  const sandpackFiles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const f of activeFiles) map[f.path] = f.content;
    return map;
  }, [activeFiles]);

  // remount Sandpack when file set changes
  const sandpackKey = useMemo(
    () => activeFiles.map((f) => f.path).join("|") + ":" + activeFiles.length + ":" + (thread?.id ?? ""),
    [activeFiles, thread?.id],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? prompt).trim();
    if ((!text && images.length === 0) || loading) return;
    const sentImages = images;
    setPrompt("");
    setImages([]);
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const res = await fetch("/api/builder", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          prompt: text || "Build a website based on the attached image(s).", threadId,
          current: dbFiles.length ? dbFiles.map((f) => ({ path: f.path, content: f.content })) : undefined,
          images: sentImages.length ? sentImages : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Build failed");
      setView("preview");
      await qc.invalidateQueries({ queryKey: ["builder-files", threadId] });
      qc.invalidateQueries({ queryKey: ["builder-messages", threadId] });
      qc.invalidateQueries({ queryKey: ["builder-thread", threadId] });
      qc.invalidateQueries({ queryKey: ["builder-threads"] });
      refetchCredits();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Build failed");
    } finally {
      setLoading(false);
    }
  };

  const downloadZip = async () => {
    const zip = new JSZip();
    for (const f of activeFiles) {
      zip.file(f.path.replace(/^\//, ""), f.content);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(thread?.title ?? "tgpt-site").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border bg-card/30 backdrop-blur">
        <div className="flex items-center gap-2 pl-10">
          <Link to="/builder"><Button variant="ghost" size="icon-sm"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <Wand2 className="h-4 w-4 text-primary" />
          <span className="font-display font-bold truncate max-w-[200px]">{thread?.title ?? "Builder"}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden md:flex items-center gap-1 text-xs text-muted-foreground">
            <Coins className="h-3.5 w-3.5 text-primary" /> {credits ?? 0} credits left today
          </span>
          <div className="bg-muted/50 rounded-lg p-0.5 flex">
            <button onClick={() => setView("preview")} className={`px-3 py-1 text-xs rounded-md flex items-center gap-1.5 ${view === "preview" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
              <Eye className="h-3.5 w-3.5" /> Preview
            </button>
            <button onClick={() => setView("code")} className={`px-3 py-1 text-xs rounded-md flex items-center gap-1.5 ${view === "code" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
              <Code2 className="h-3.5 w-3.5" /> Code
            </button>
          </div>
          <Button size="sm" variant="outline" onClick={downloadZip}><Download className="h-3.5 w-3.5 mr-1" /> ZIP</Button>
          <Button size="sm" variant="outline" onClick={() => setUpgradeOpen(true)}><Crown className="h-3.5 w-3.5 mr-1 text-primary" /> Upgrade</Button>
          <Button size="sm" onClick={() => setPublishOpen(true)} className="bg-gradient-brand text-primary-foreground border-0 shadow-glow"><Globe className="h-3.5 w-3.5 mr-1" /> Publish</Button>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[360px_1fr] min-h-0">
        {/* Chat */}
        <div className="flex flex-col border-r border-border min-h-0 bg-sidebar/40">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Build with T-GPT</div>
                <p className="text-xs text-muted-foreground">Describe your app. T-GPT writes a full React + TypeScript project. Each build uses 1 credit.</p>
                <div className="space-y-2 pt-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="w-full text-left text-xs p-2.5 rounded-lg border border-border bg-card/60 hover:border-primary/50 hover:bg-card transition">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`text-sm rounded-lg px-3 py-2 ${m.role === "user" ? "bg-gradient-brand text-primary-foreground ml-6" : "bg-card border border-border mr-6"}`}>
                  {m.content}
                </div>
              ))
            )}
            {loading && (
              <div className="mr-6 space-y-2">
                <div className="text-sm rounded-lg px-3 py-2 bg-card border border-border flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> T-GPT is building…
                </div>
                <div className="tgpt-gemini-shimmer h-2 w-full rounded-full" />
              </div>
            )}
          </div>
          <div className="border-t border-border p-2 bg-background/60">
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2 pb-2">
                {images.map((src, i) => (
                  <div key={i} className="relative">
                    <img src={src} alt="reference" className="h-14 w-14 rounded-lg object-cover border border-border" />
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <input
                ref={imgInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => { onPickImages(e.target.files); e.currentTarget.value = ""; }}
              />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                disabled={loading}
                onClick={() => imgInputRef.current?.click()}
                title="Upload reference image"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Textarea
                value={prompt} onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={messages.length ? "Ask for changes…" : "Describe your app…"}
                rows={2} className="resize-none text-sm min-h-[60px]" disabled={loading}
              />
              <Button onClick={() => send()} disabled={loading || (!prompt.trim() && images.length === 0)} className="bg-gradient-brand text-primary-foreground border-0 shadow-glow shrink-0" size="icon">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Sandpack workspace */}
        <div className="flex flex-col min-h-0 relative bg-muted/20">
          {mounted ? (
            <SandpackProvider
              key={sandpackKey}
              template="react-ts"
              theme="dark"
              files={sandpackFiles}
              options={{ activeFile: activeFiles.some((f) => f.path === "/App.tsx") ? "/App.tsx" : activeFiles[0]?.path }}
              customSetup={{ dependencies: { "lucide-react": "latest", "framer-motion": "latest", clsx: "latest" } }}
              style={{ height: "100%" }}
            >
              <SandpackLayout style={{ height: "100%", border: "none", borderRadius: 0 }}>
                {view === "code" ? (
                  <>
                    <SandpackFileExplorer style={{ height: "100%", minWidth: 180 }} />
                    <SandpackCodeEditor showTabs showLineNumbers style={{ height: "100%", flex: 1 }} />
                  </>
                ) : (
                  <SandpackPreview showNavigator showOpenInCodeSandbox={false} style={{ height: "100%", flex: 1 }} />
                )}
              </SandpackLayout>
            </SandpackProvider>
          ) : (
            <div className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          )}
        </div>
      </div>

      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish your project</DialogTitle>
            <DialogDescription>
              Download your full project as a ZIP and host it anywhere, or deploy on TigerHost.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <Button onClick={downloadZip} className="w-full bg-gradient-brand text-primary-foreground border-0 shadow-glow"><Download className="h-4 w-4 mr-2" /> Download project (.zip)</Button>
            <a href="https://www.tigerhost.space/" target="_blank" rel="noopener noreferrer" className="block">
              <Button variant="outline" className="w-full"><Globe className="h-4 w-4 mr-2" /> Host on TigerHost</Button>
            </a>
            <Button onClick={() => { setPublishOpen(false); setUpgradeOpen(true); }} variant="ghost" className="w-full text-primary"><Crown className="h-4 w-4 mr-2" /> Upgrade for one-click hosting</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function ImageGenLoader({
  label = "Creating your image…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "tgpt-gemini-shimmer relative flex aspect-square w-full max-w-xs items-center justify-center overflow-hidden rounded-xl border border-border/60",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <Sparkles className="h-7 w-7 animate-pulse text-primary drop-shadow-[0_0_12px_rgba(255,140,60,0.6)]" />
        <span className="text-xs font-medium text-foreground/90">{label}</span>
      </div>
    </div>
  );
}

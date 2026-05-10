import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Sparkles, Crown, Rocket } from "lucide-react";
import { toast } from "sonner";

const TIERS = [
  {
    name: "Free",
    price: "$0",
    icon: Sparkles,
    features: ["Unlimited chats", "Standard models", "Basic website builder", "Community support"],
    cta: "Current plan",
    disabled: true,
  },
  {
    name: "Pro",
    price: "$19",
    icon: Crown,
    highlight: true,
    features: ["Everything in Free", "Premium GPT-5 & Gemini Pro", "Unlimited site builds", "Custom domains", "Priority support"],
    cta: "Upgrade to Pro",
  },
  {
    name: "Team",
    price: "$49",
    icon: Rocket,
    features: ["Everything in Pro", "Workspace collaboration", "API access", "SSO & audit logs", "Dedicated support"],
    cta: "Upgrade to Team",
  },
];

export function UpgradeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            Upgrade <span className="text-gradient">T-GPT</span>
          </DialogTitle>
          <DialogDescription>Unlock premium models, the full website builder, and more.</DialogDescription>
        </DialogHeader>
        <div className="grid md:grid-cols-3 gap-4 mt-2">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-xl border p-5 flex flex-col ${
                tier.highlight ? "border-primary bg-gradient-to-b from-primary/10 to-transparent shadow-glow" : "border-border bg-card/50"
              }`}
            >
              {tier.highlight && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-wider bg-gradient-brand text-primary-foreground px-2 py-0.5 rounded-full font-bold">
                  Popular
                </span>
              )}
              <div className="flex items-center gap-2">
                <tier.icon className="h-5 w-5 text-primary" />
                <h3 className="font-bold text-lg">{tier.name}</h3>
              </div>
              <p className="mt-2 text-3xl font-bold">
                {tier.price}
                <span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>
              <ul className="mt-4 space-y-2 text-sm flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                disabled={tier.disabled}
                onClick={() => toast.info("Billing coming soon — payments not enabled yet.")}
                className={`mt-5 w-full ${tier.highlight ? "bg-gradient-brand text-primary-foreground border-0 shadow-glow" : ""}`}
                variant={tier.highlight ? "default" : "outline"}
              >
                {tier.cta}
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

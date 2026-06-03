import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound, LogOut } from "lucide-react";
import logo from "@/assets/tgpt-logo.png";

export const Route = createFileRoute("/redeem")({
  component: RedeemPage,
  head: () => ({ meta: [{ title: "Activate license — T-GPT" }] }),
});

function RedeemPage() {
  const navigate = useNavigate();
  const [license, setLicense] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) navigate({ to: "/login" });
    });
  }, [navigate]);

  const redeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const key = license.trim().toUpperCase();
      if (!key) {
        setError("Enter a license key.");
        return;
      }
      const { error: err } = await supabase.rpc("claim_license", { _key: key });
      if (err) throw new Error(err.message || "Could not activate license.");
      toast.success("License activated!");
      window.location.assign("/chat");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not activate license.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center justify-center gap-3 mb-8">
          <img src={logo} alt="T-GPT" className="h-12 w-12" width={48} height={48} />
          <span className="font-display text-3xl font-bold text-gradient">T-GPT</span>
        </Link>

        <div className="bg-card/70 backdrop-blur-xl border border-border rounded-2xl p-8 shadow-glow">
          <h1 className="font-display text-2xl font-bold mb-1">Activate your access</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Your account needs an active license key to use T-GPT.
          </p>

          <form onSubmit={redeem} className="space-y-3">
            <div>
              <Label htmlFor="license" className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-primary" /> License key
              </Label>
              <Input
                id="license"
                required
                value={license}
                onChange={(e) => setLicense(e.target.value)}
                placeholder="TGPT-XXXX-XXXX-XXXX"
                className="mt-1 font-mono uppercase tracking-wider"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Don't have a key? Get one on our{" "}
                <a href="https://discord.gg/7Dr7PgpqJ" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Discord</a>.
              </p>
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-gradient-brand text-primary-foreground border-0 shadow-glow font-semibold"
            >
              {loading ? "Activating..." : "Activate license"}
            </Button>
          </form>

          {error && (
            <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            onClick={signOut}
            className="mt-4 w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

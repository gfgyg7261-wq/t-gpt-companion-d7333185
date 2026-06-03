import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import logo from "@/assets/tgpt-logo.png";

export const Route = createFileRoute("/login")({
  validateSearch: (search) => ({
    redirect: typeof search.redirect === "string" && search.redirect.startsWith("/") ? search.redirect : "/chat",
  }),
  component: LoginPage,
  head: () => ({ meta: [{ title: "Sign in — T-GPT" }] }),
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const goToRedirect = () => window.location.assign(redirect);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [adminMode, setAdminMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [license, setLicense] = useState("");
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const getAuthMessage = (message: string) => {
    const lower = message.toLowerCase();
    if (lower.includes("weak_password") || lower.includes("weak") || lower.includes("pwned")) {
      return "That password is too common or leaked. Use a stronger unique password with letters, numbers, and symbols.";
    }
    if (lower.includes("invalid login credentials")) {
      return "Email or password is wrong.";
    }
    if (lower.includes("already registered") || lower.includes("already exists")) {
      return "This email already has an account. Sign in instead.";
    }
    return message;
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) goToRedirect();
    });
  }, [redirect]);

  const claimLicense = async (key: string) => {
    const { error } = await supabase.rpc("claim_license", { _key: key });
    if (error) throw new Error(error.message || "Could not activate license key.");
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setAuthError("");
    try {
      if (mode === "signup") {
        const key = license.trim().toUpperCase();
        if (!key) {
          setAuthError("A license key is required to create an account.");
          setLoading(false);
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
        if (data.session) {
          try {
            await claimLicense(key);
          } catch (licErr) {
            await supabase.auth.signOut();
            throw licErr;
          }
          toast.success("Welcome to T-GPT! License activated.");
          goToRedirect();
        } else {
          toast.success("Account created! Confirm your email, then sign in and redeem your key.");
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (adminMode) {
          const { data: u } = await supabase.auth.getUser();
          const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", u.user!.id).eq("role", "admin").maybeSingle();
          if (!role) {
            setAuthError("This account is not an admin.");
            await supabase.auth.signOut();
            return;
          }
          toast.success("Welcome, admin");
          navigate({ to: "/admin" });
        } else {
          toast.success("Welcome back!");
          goToRedirect();
        }
      }
    } catch (err: unknown) {
      const msg = getAuthMessage(err instanceof Error ? err.message : "Something went wrong");
      setAuthError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center justify-center gap-3 mb-8">
          <img src={logo} alt="T-GPT" className="h-12 w-12" width={48} height={48} />
          <span className="font-display text-3xl font-bold text-gradient">T-GPT</span>
        </Link>

        <div className="bg-card/70 backdrop-blur-xl border border-border rounded-2xl p-8 shadow-glow">
          <h1 className="font-display text-2xl font-bold mb-1">
            {mode === "signin" ? "Welcome back" : "Create account"}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === "signin" ? "Sign in to chat and build with T-GPT" : "Enter your license key to activate your account"}
          </p>

          <form onSubmit={handleEmail} className="space-y-3">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" />
              {mode === "signup" && (
                <p className="mt-1 text-xs text-muted-foreground">Use a strong unique password, not a common or leaked one.</p>
              )}
            </div>
            {mode === "signup" && (
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
            )}
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-gradient-brand text-primary-foreground border-0 shadow-glow font-semibold"
            >
              {loading ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          {authError && (
            <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {authError}
            </p>
          )}

          <p className="mt-4 text-center text-sm text-muted-foreground">
            {mode === "signin" ? "No account?" : "Already have one?"}{" "}
            <button
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="text-primary hover:underline font-medium"
            >
              {mode === "signin" ? "Sign up" : "Sign in"}
            </button>
          </p>

          {mode === "signin" && (
            <div className="mt-3 pt-3 border-t border-border text-center">
              <button
                type="button"
                onClick={() => setAdminMode((v) => !v)}
                className={`text-xs font-medium ${adminMode ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
              >
                {adminMode ? "✓ Admin mode — sign in to open Admin Panel" : "Admin login →"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

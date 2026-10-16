import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/app/logo";
import { isAuthenticated, LOCAL_DEFAULT_PASSWORD } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/** Dynamic part: skip the form if already signed in, and remember where to go next. */
async function LoginGate({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  if (await isAuthenticated()) redirect("/");
  const { next } = await searchParams;
  return <LoginForm next={typeof next === "string" ? next : undefined} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  const showLocalHint = process.env.NODE_ENV !== "production" && !process.env.APP_PASSWORD;
  return (
    <div className="grid min-h-dvh place-items-center bg-muted px-4">
      <div className="w-full max-w-[360px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo size={36} />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Sign in to Tally</h1>
            <p className="mt-1 text-sm text-muted-foreground">Your spending stays private to you.</p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-background p-5 shadow-[0_1px_2px_rgba(15,15,15,0.04)]">
          <Suspense fallback={<LoginForm />}>
            <LoginGate searchParams={searchParams} />
          </Suspense>
        </div>
        {showLocalHint ? (
          <p className="mt-4 text-center text-[12.5px] text-muted-foreground">
            Running locally. The default password is{" "}
            <code className="rounded bg-background px-1 py-0.5 font-mono text-foreground">{LOCAL_DEFAULT_PASSWORD}</code>. Change it in
            Settings.
          </p>
        ) : null}
      </div>
    </div>
  );
}

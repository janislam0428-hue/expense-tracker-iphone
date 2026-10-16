// Optimistic check before any page renders: no valid session cookie means a
// redirect to /login. The full check (password version) runs in requireAuth().
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/token";

export async function proxy(request: NextRequest) {
  const claims = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (claims) return NextResponse.next();
  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page, the phone webhook (bearer token, Phase 3),
  // Next.js internals and static files.
  matcher: ["/((?!login|api/ingest|_next/static|_next/image|favicon.ico|icon.svg|apple-icon|manifest.webmanifest|robots.txt).*)"],
};

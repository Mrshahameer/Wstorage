// Session refresh + light auth gating. Fully guarded: middleware must NEVER throw,
// or the whole site returns 500 MIDDLEWARE_INVOCATION_FAILED. On any problem
// (missing env, Supabase hiccup) it simply lets the request through and lets the
// page-level guards handle auth.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const PUBLIC_PATHS = ["/login", "/api/auth"];
type CookieToSet = { name: string; value: string; options: CookieOptions };

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function middleware(req: NextRequest) {
  try {
    const url =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_KEY;

    // No Supabase config visible here? Don't gate — just continue.
    if (!url || !anon) return NextResponse.next();

    let res = NextResponse.next({ request: req });
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet: CookieToSet[]) => {
          toSet.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          toSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const path = req.nextUrl.pathname;
    const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

    if (!user && !isPublic) {
      const u = req.nextUrl.clone();
      u.pathname = "/login";
      u.searchParams.set("next", path);
      return NextResponse.redirect(u);
    }
    if (user && path === "/login") {
      const u = req.nextUrl.clone();
      u.pathname = "/dashboard";
      return NextResponse.redirect(u);
    }
    return res;
  } catch {
    // Never 500 the site from middleware.
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

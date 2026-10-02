import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// In Next.js 16 conventia `middleware.ts` e deprecata si redenumita `proxy.ts`
// (ruleaza implicit pe runtime-ul Node). Functia Clerk se numeste in continuare
// clerkMiddleware() -- doar fisierul s-a redenumit, nu si API-ul.

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // tot, mai putin fisierele statice si internele Next
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|webmanifest)).*)",
    // rutele de API, mereu
    "/(api)(.*)",
  ],
};

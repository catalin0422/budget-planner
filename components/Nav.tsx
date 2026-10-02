"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useUser } from "@clerk/nextjs";
import type { SVGProps } from "react";

function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3.5 10.5 12 4l8.5 6.5" />
      <path d="M5.5 9.5V19a1 1 0 0 0 1 1H10v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3.5a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}

function TargetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function HistoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 12a8 8 0 1 0 2.5-5.8" />
      <path d="M4 5v4h4" />
      <path d="M12 8v4.5l3 2" />
    </svg>
  );
}

const links = [
  { href: "/", label: "Acasă", icon: HomeIcon },
  { href: "/istoric", label: "Istoric", icon: HistoryIcon },
  { href: "/goals", label: "Obiective", icon: TargetIcon },
];

export default function Nav() {
  const pathname = usePathname();
  // In Clerk v7 nu mai exista <SignedIn>; echivalentul pentru un client component
  // e hook-ul useUser(). (Componenta <Show when="signed-in"> exista, dar e un
  // server component async si nu poate fi folosita aici.)
  const { isSignedIn } = useUser();

  return (
    <>
      <header className="sticky top-0 z-40 bg-bg/90 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-5 h-14 flex items-center justify-between">
          <span className="font-semibold text-[15px] text-ink">Bugetul meu</span>
          {isSignedIn && <UserButton />}
        </div>
      </header>

      {/* Cand nu esti logat (ex: pagina de sign-in) nu are rost sa aratam navigatia. */}
      {isSignedIn && (
        <nav className="fixed bottom-0 inset-x-0 z-40 bg-surface shadow-soft pb-[env(safe-area-inset-bottom)]">
          <div className="max-w-3xl mx-auto px-2 h-16 flex items-stretch">
            {links.map((link) => {
              const active = pathname === link.href;
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-label={link.label}
                  className="flex-1 flex items-center justify-center"
                >
                  <span
                    className={
                      "flex items-center justify-center w-11 h-11 rounded-2xl transition-colors " +
                      (active ? "bg-accent text-accent-ink" : "text-ink-muted")
                    }
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}

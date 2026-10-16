"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowDownToLine,
  Inbox,
  LayoutGrid,
  LineChart,
  LogOut,
  Menu,
  Rows3,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { signOut } from "@/app/(app)/actions";

const NAV = [
  { href: "/", label: "Dashboard", Icon: LayoutGrid },
  { href: "/transactions", label: "Transactions", Icon: Rows3 },
  { href: "/import", label: "Import", Icon: ArrowDownToLine },
  { href: "/review", label: "To confirm", Icon: Inbox, badge: true },
  { href: "/insights", label: "Insights", Icon: LineChart },
  { href: "/settings", label: "Settings", Icon: Settings2 },
] as const;

type Props = { pendingCount: number; demoEnabled: boolean };

function NavList({ pendingCount, onNavigate }: { pendingCount: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-px">
      {NAV.map(({ href, label, Icon, ...rest }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        const showBadge = "badge" in rest && pendingCount > 0;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex h-[30px] items-center gap-2.5 rounded-md px-2 text-[14px] text-sidebar-foreground transition-colors",
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-[17px] shrink-0 opacity-80" aria-hidden />
            <span className="flex-1 truncate">{label}</span>
            {showBadge ? (
              <span
                className="tabular min-w-5 rounded-full bg-[var(--tag-red-bg)] px-1.5 text-center text-[11.5px] leading-[18px] font-medium text-[var(--tag-red-fg)]"
                aria-label={`${pendingCount} to confirm`}
              >
                {pendingCount > 99 ? "99+" : pendingCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarBody({ pendingCount, demoEnabled, onNavigate }: Props & { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-5 px-2.5 py-3">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5 rounded-md px-2 py-1 hover:bg-sidebar-accent">
        <Logo className="text-sidebar-accent-foreground" />
        <div className="min-w-0 leading-tight">
          <div className="text-[14px] font-semibold text-sidebar-accent-foreground">Tally</div>
          <div className="text-[11.5px] text-sidebar-foreground">Personal spending</div>
        </div>
      </Link>

      <NavList pendingCount={pendingCount} onNavigate={onNavigate} />

      <div className="mt-auto flex flex-col gap-2">
        {demoEnabled ? (
          <Link
            href="/settings#demo"
            onClick={onNavigate}
            className="rounded-md border border-sidebar-border px-2.5 py-2 text-[12px] leading-snug text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <span className="font-medium text-sidebar-accent-foreground">Demo data is on.</span> Turn it off in Settings when you start importing.
          </Link>
        ) : null}
        <div className="flex items-center justify-between px-1">
          <ThemeToggle />
          <form action={signOut}>
            <button
              type="submit"
              className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="size-3.5" aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function Sidebar(props: Props) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 border-r border-sidebar-border bg-sidebar md:block">
      <SidebarBody {...props} />
    </aside>
  );
}

export function MobileBar(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-hover"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-[264px] gap-0 bg-sidebar p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SidebarBody {...props} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <Link href="/" className="flex items-center gap-2">
        <Logo size={20} />
        <span className="text-[14px] font-semibold">Tally</span>
      </Link>
      {props.pendingCount > 0 ? (
        <Link
          href="/review"
          className="tabular ml-auto rounded-full bg-[var(--tag-red-bg)] px-2.5 py-1 text-[12px] font-medium text-[var(--tag-red-fg)]"
        >
          {props.pendingCount} to confirm
        </Link>
      ) : null}
    </div>
  );
}

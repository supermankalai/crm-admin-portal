"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  Check,
  ChevronsUpDown,
  ClipboardList,
  CreditCard,
  Bell,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  ScanLine,
  Settings,
  Tags,
  UserCog,
  Users,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import type { NavIcon } from "@/components/layout/nav-config";
import { cn, initials } from "@/lib/utils";

const ICONS: Record<NavIcon, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  members: Users,
  checkin: ScanLine,
  payments: CreditCard,
  plans: Tags,
  classes: CalendarDays,
  staff: UserCog,
  schedule: CalendarClock,
  reports: ChartColumn,
  notifications: Bell,
  settings: Settings,
  audit: ClipboardList,
  billing: Sparkles,
};

export type ShellProps = {
  gym: { slug: string; name: string; brandColor: string };
  roleLabel: string;
  user: { name: string; email: string; isSuperAdmin: boolean };
  nav: { label: string; href: string; icon: NavIcon }[];
  gyms: { slug: string; name: string; roleLabel: string; brandColor: string }[];
  banner?: ReactNode;
  logoutAction: () => Promise<void>;
  children: ReactNode;
};

function GymMark({ color, className }: { color: string; className?: string }) {
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg text-white", className)} style={{ backgroundColor: color }} aria-hidden>
      <Building2 className="size-4" />
    </span>
  );
}

function GymSwitcher({ gym, gyms }: Pick<ShellProps, "gym" | "gyms">) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex w-full items-center gap-2 rounded-lg p-2 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label={`Current gym: ${gym.name}. Switch gym`}
        >
          <GymMark color={gym.brandColor} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{gym.name}</span>
            <span className="block truncate text-xs text-muted-foreground">/g/{gym.slug}</span>
          </span>
          <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Switch gym</DropdownMenuLabel>
        {gyms.map((g) => (
          <DropdownMenuItem key={g.slug} asChild>
            <Link href={`/g/${g.slug}/dashboard`} className="flex items-center gap-2">
              <GymMark color={g.brandColor} className="size-6 rounded-md [&_svg]:size-3" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{g.name}</span>
                <span className="block text-xs text-muted-foreground">{g.roleLabel}</span>
              </span>
              {g.slug === gym.slug && <Check className="size-4" aria-label="Current gym" />}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/signup">
            <Plus /> Create another gym
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarNav({ nav, onNavigate }: { nav: ShellProps["nav"]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Gym" className="grid gap-1">
      {nav.map((item) => {
        const Icon = ICONS[item.icon];
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
            )}
          >
            <Icon className="size-4" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function GymShell({ gym, roleLabel, user, nav, gyms, banner, logoutAction, children }: ShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col gap-4 p-3">
      <GymSwitcher gym={gym} gyms={gyms} />
      <div className="flex-1 overflow-y-auto">
        <SidebarNav nav={nav} onNavigate={onNavigate} />
      </div>
      <p className="px-3 text-xs text-muted-foreground">
        Signed in as <Badge variant="secondary">{roleLabel}</Badge>
      </p>
    </div>
  );

  return (
    <div className="flex min-h-svh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-background focus:p-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 border-r bg-sidebar lg:block">{sidebar()}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r bg-sidebar">
            <div className="flex justify-end p-2">
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
                <X />
              </Button>
            </div>
            {sidebar(() => setMobileOpen(false))}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <span className="truncate font-semibold lg:hidden">{gym.name}</span>
          <div className="flex-1" />
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
                <Avatar className="size-7">
                  <AvatarFallback className="bg-primary/15 text-primary">{initials(user.name)}</AvatarFallback>
                </Avatar>
                <span className="hidden text-sm sm:inline">{user.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>
                <div className="font-medium">{user.name}</div>
                <div className="truncate text-xs font-normal text-muted-foreground">{user.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/select-gym">
                  <Building2 /> All my gyms
                </Link>
              </DropdownMenuItem>
              {user.isSuperAdmin && (
                <DropdownMenuItem asChild>
                  <Link href="/admin">
                    <ShieldCheck /> Platform admin
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void logoutAction()}>
                <LogOut /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        {banner}
        <main id="main" className="flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

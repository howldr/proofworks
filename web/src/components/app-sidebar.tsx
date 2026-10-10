"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Handshake,
  LayoutDashboard,
  ListChecks,
  Scale,
  Settings,
  Stamp,
  TriangleAlert,
  UserCheck,
  Users,
  Vault,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { NavUser } from "@/components/nav-user";
import { hasModule, type Me, useAuth } from "@/lib/use-auth";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";

// A nav entry is either a leaf (has a url) or a parent (has children rendered
// in an expandable sub-menu). `module` gates it behind an optional module;
// `roles` lists which RESTRICTED roles (staff, acceptor) may see it —
// unrestricted roles see everything, and the API denies server-side regardless.
type NavLeaf = {
  title: string;
  url: string;
  icon: LucideIcon;
  module?: string;
  roles?: string[];
};
type NavParent = {
  title: string;
  icon: LucideIcon;
  module?: string;
  children: NavLeaf[];
};
type NavItem = NavLeaf | NavParent;
type NavGroup = { label: string; items: NavItem[] };

const RESTRICTED_ROLES = new Set(["staff", "acceptor"]);

const isParent = (i: NavItem): i is NavParent => "children" in i;

// Nav grouped by the GRC lifecycle — Governance, Risk, Compliance — so the
// sidebar reads the way the product is positioned. Policy is one control
// among several: a single expandable "Policies" entry under Governance, not a
// headline group.
const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, roles: ["staff", "acceptor"] },
      { title: "My tasks", url: "/tasks", icon: ListChecks, roles: ["acceptor"] },
    ],
  },
  {
    label: "Governance",
    items: [
      { title: "Obligations", url: "/obligations", icon: Scale, module: "obligations" },
      {
        title: "Policies",
        icon: FileText,
        module: "policy_hub",
        children: [
          { title: "Register", url: "/policies", icon: FileText, module: "policy_hub", roles: ["staff", "acceptor"] },
          { title: "Approvals", url: "/approvals", icon: Stamp, module: "policy_hub" },
          { title: "Acknowledgements", url: "/acknowledgements", icon: ClipboardCheck, module: "policy_hub" },
          { title: "Reviews", url: "/reviews", icon: CalendarClock, module: "policy_hub" },
        ],
      },
    ],
  },
  {
    label: "Risk",
    items: [
      { title: "Risk Register", url: "/risks", icon: TriangleAlert, module: "risk_register", roles: ["acceptor"] },
      { title: "Vendor Assessments", url: "/vendors", icon: Handshake, module: "vendor_assessments" },
    ],
  },
  {
    label: "Compliance",
    items: [
      { title: "Access Reviews", url: "/access-reviews", icon: UserCheck, module: "access_reviews", roles: ["acceptor"] },
      { title: "Evidence Locker", url: "/evidence", icon: Vault, module: "evidence_locker" },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Staff", url: "/staff", icon: Users },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];

/** A leaf is visible when its module is entitled (or unknown while `me`
 *  resolves) and, for the restricted roles, when it's explicitly allowed. */
function leafVisible(leaf: NavLeaf, me: Me | null, role: string | undefined): boolean {
  const moduleOk = !leaf.module || me == null || hasModule(me, leaf.module);
  const restricted = role != null && RESTRICTED_ROLES.has(role);
  const roleOk = !restricted || (leaf.roles?.includes(role!) ?? false);
  return moduleOk && roleOk;
}

function moduleVisible(mod: string | undefined, me: Me | null): boolean {
  return !mod || me == null || hasModule(me, mod);
}

export function AppSidebar() {
  const pathname = usePathname();
  const { me } = useAuth();
  const role = me?.role;

  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.flatMap((item): (NavLeaf | (NavParent & { visibleChildren: NavLeaf[] }))[] => {
      if (isParent(item)) {
        if (!moduleVisible(item.module, me)) return [];
        const visibleChildren = item.children.filter((c) => leafVisible(c, me, role));
        return visibleChildren.length ? [{ ...item, visibleChildren }] : [];
      }
      return leafVisible(item, me, role) ? [item] : [];
    }),
  })).filter((group) => group.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href="/dashboard" />}
              className="data-[state=collapsed]:!p-0"
            >
              {/* With a workspace logo, the header belongs to the org — their
                  mark and name up top, ProofWorks demoted to a discrete
                  "by howldr" byline. Without one, howldr-branded as ever. */}
              <div className="flex aspect-square size-8 items-center justify-center overflow-hidden rounded-lg bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={me?.tenant?.logo || "/howldr-mark.png"}
                  alt={me?.tenant?.logo ? me.tenant.name : "howldr"}
                  className="size-7 object-contain"
                />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {me?.tenant?.logo ? me.tenant.name : "ProofWorks"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {me?.tenant?.logo ? "ProofWorks · by howldr" : "howldr"}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) =>
                isParent(item) ? (
                  <NavParentItem
                    key={item.title}
                    item={item}
                    pathname={pathname}
                  />
                ) : (
                  <NavLeafItem key={item.url} item={item} pathname={pathname} />
                ),
              )}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function isActivePath(pathname: string, url: string): boolean {
  return pathname === url || pathname.startsWith(url + "/");
}

function NavLeafItem({ item, pathname }: { item: NavLeaf; pathname: string }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActivePath(pathname, item.url)}
        tooltip={item.title}
        render={<Link href={item.url} />}
      >
        <item.icon />
        <span>{item.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function NavParentItem({
  item,
  pathname,
}: {
  item: NavParent & { visibleChildren: NavLeaf[] };
  pathname: string;
}) {
  const childActive = item.visibleChildren.some((c) => isActivePath(pathname, c.url));
  // Open when a child is active; the user can toggle it thereafter.
  const [open, setOpen] = useState(childActive);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={item.title}
        isActive={childActive && !open}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <item.icon />
        <span>{item.title}</span>
        <ChevronRight
          className={`ml-auto transition-transform ${open ? "rotate-90" : ""}`}
        />
      </SidebarMenuButton>
      {open && (
        <SidebarMenuSub>
          {item.visibleChildren.map((child) => (
            <SidebarMenuSubItem key={child.url}>
              <SidebarMenuSubButton
                isActive={isActivePath(pathname, child.url)}
                render={<Link href={child.url} />}
              >
                <span>{child.title}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

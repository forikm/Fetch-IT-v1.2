"use client";
import { Menu, Package, Users, Route, Mail, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useAppStore } from '@/lib/store';
import { FetchItLogo } from './logo';
import { useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export function ItMark() {
  return <span className="inline-flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 font-bold tracking-tight text-primary">IT<ArrowUpRight className="h-3 w-3" aria-hidden="true" /></span>;
}
export function BrandNavigation() {
  const router = useRouter();
  const setView = useAppStore(s => s.setView);
  const trigger = useRef<HTMLButtonElement>(null);
  const pendingSection = useRef<string | undefined>(undefined);
  function home(section?: string) {
    if (location.pathname !== '/') { setView('landing'); router.push('/' + (section ? `#${section}` : '')); return; }
    pendingSection.current = section;
    history.replaceState(null, '', location.pathname + location.search + (section ? `#${section}` : ''));
    setView('landing');
    requestAnimationFrame(() => {
      if (section) document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  return <div className="flex min-w-0 items-center gap-2 sm:gap-3">
    <DropdownMenu><DropdownMenuTrigger asChild><Button ref={trigger} variant="ghost" size="icon" aria-label="Page navigation" className="h-9 w-9 shrink-0 rounded-xl"><Menu className="h-5 w-5" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={12} className="w-56 rounded-2xl p-2 shadow-xl" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus({ preventScroll: true }); const section = pendingSection.current; pendingSection.current = undefined; if (section) requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' })); }}>
        <DropdownMenuItem className="gap-3 rounded-xl px-3 py-3 cursor-pointer" onSelect={() => home('services')}><Package />Services</DropdownMenuItem>
        <DropdownMenuItem className="gap-3 rounded-xl px-3 py-3 cursor-pointer" onSelect={() => home('about-us')}><Users />About Us</DropdownMenuItem>
        <DropdownMenuItem className="gap-3 rounded-xl px-3 py-3 cursor-pointer" onSelect={() => home('how-it-works')}><Route /><span className="flex items-center gap-1">How <ItMark /> Works</span></DropdownMenuItem>
        <DropdownMenuItem className="gap-3 rounded-xl px-3 py-3 cursor-pointer" onSelect={() => home('contact-us')}><Mail />Contact Us</DropdownMenuItem>
        <DropdownMenuItem asChild className="gap-3 rounded-xl px-3 py-3 cursor-pointer"><Link href="/help"><Mail />Help &amp; Support</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <button type="button" aria-label="Fetch-It home" className="shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => home()}><FetchItLogo size={32} className="[&_span]:text-lg sm:[&_span]:text-xl" /></button>
  </div>;
}

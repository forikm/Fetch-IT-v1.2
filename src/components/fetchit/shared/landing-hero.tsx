"use client";

import { useEffect, useRef, useState } from "react";
import { FetchItLogo } from "./logo";
import type { AppMode } from "@/lib/store";
import { cn } from "@/lib/utils";
import Link from "next/link";
import styles from "./landing-hero.module.css";

type Props = { onStart: (mode: AppMode) => void; onLogin: () => void; signedIn: boolean; riderAppUrl: string };

/** Landing illustration only; actual bookings and tracking use the existing authenticated views. */
export function LandingHero({ onStart, onLogin, signedIn, riderAppUrl }: Props) {
  const [mode, setMode] = useState<AppMode>("delivery");
  const [menuOpen, setMenuOpen] = useState(false);
  const mapRef = useRef<SVGSVGElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (motion.matches) mapRef.current?.pauseAnimations();
      else mapRef.current?.unpauseAnimations();
    };
    update();
    motion.addEventListener("change", update);
    return () => motion.removeEventListener("change", update);
  }, []);
  return <div className={styles["root"]}>
    <div className={styles["orange-field"]} aria-hidden="true" />

<header className={styles["header"]}>
  <a href="#" className={styles["landing-logo"]} aria-label="Fetch-It home"><FetchItLogo size={42} /></a>
  <nav className={cn(menuOpen && styles.open)} id="landing-navigation" aria-label="Main navigation" onClick={() => setMenuOpen(false)}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }}>
    <a className={styles["nav-link"]} href="#services">Our services</a>
    <a className={styles["nav-link"]} href="#how-it-works">How it works</a>
    <a className={cn(styles["nav-link"], styles["secondary-nav-link"])} href="#about-us">About us</a>
    <a className={cn(styles["nav-link"], styles["secondary-nav-link"])} href="#contact-us">Contact us</a>
    <Link className={cn(styles["nav-link"], styles["secondary-nav-link"])} href="/help">Help &amp; support</Link>
    <a className={styles["nav-link"]} href={riderAppUrl}>Become a rider ↗</a>
    <button type="button" className={cn(styles["nav-link"], styles["login-link"])} onClick={onLogin}>{signedIn ? "Dashboard" : "Log in"}</button>
  </nav>
  <button type="button" ref={menuButtonRef} className={styles["menu-button"]} aria-expanded={menuOpen} aria-controls="landing-navigation" aria-label="Toggle navigation" onClick={() => setMenuOpen((open) => !open)}><span /><span /></button>
</header>
  <svg className={styles["icon-library"]} aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><defs>
    <symbol id="fi-landing-arrow" viewBox="0 0 24 24"><path d="M4 12h15m-6-6 6 6-6 6"/></symbol>
    <symbol id="fi-landing-box" viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V8M12 13v10M7 5.8l9 5V16"/></symbol>
    <symbol id="fi-landing-pin" viewBox="0 0 24 24"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></symbol>
    <symbol id="fi-landing-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></symbol>
    <symbol id="fi-landing-car" viewBox="0 0 24 24"><path d="m4 10 2-6h12l2 6M3 10h18v8H3zM5 18v3m14-3v3M6 14h2m8 0h2"/></symbol>
  </defs></svg>
    <section className={styles["hero"]} aria-labelledby="hero-title">
      <div className={styles["hero-copy"]}>
        <div className={styles["eyebrow"]}><span></span> SMALL ERRANDS. BIG POSSIBILITIES.</div>
        <h1 id="hero-title">Your day.<br />A little <span>easier.</span></h1>
        <p className={styles["intro"]}>Across town or around the corner.<br />We move your parcels, and your plans, forward.</p>
        <div className={styles["service-picker"]} role="group" aria-label="Select service"><button type="button" className={cn(styles.service, mode === "delivery" && styles.selected)} onClick={() => setMode("delivery")} aria-pressed={mode === "delivery"}><svg><use href="#fi-landing-box"/></svg>Send a package</button><button type="button" className={cn(styles.service, mode === "ride" && styles.selected)} onClick={() => setMode("ride")} aria-pressed={mode === "ride"}><svg><use href="#fi-landing-car"/></svg>Catch a ride</button></div>
        <div className={styles["hero-actions"]}><button type="button" className={styles["primary-button"]} onClick={() => onStart(mode)}><span>{mode === "ride" ? "Let’s get you there" : "Let’s get it there"}</span><svg><use href="#fi-landing-arrow"/></svg></button><a className={styles["how-button"]} href="#how-it-works"><span className={styles["play-icon"]}>▶</span>See how it works</a></div>
        <div className={styles["trust-line"]}><div className={styles["trust-check"]}><svg><use href="#fi-landing-check"/></svg></div><span>Local riders. Live updates. Less worry.</span></div>
      </div>
      <div className={styles["hero-art"]} aria-label="Illustrated delivery route preview">
        <span className={cn(styles["ornament"], styles["orb"], styles["orb-one"])} aria-hidden="true"></span><span className={cn(styles["ornament"], styles["triangle"])} aria-hidden="true"></span><span className={cn(styles["ornament"], styles["small-spark"])} aria-hidden="true">✦</span>
        <div className={styles["availability"]}><span></span> A good day to get moving</div>
        <div className={cn(styles["parcel-card"], styles["floating"])}><div className={styles["parcel-halo"]}></div><svg className={styles["parcel-illustration"]} viewBox="0 0 140 130" aria-hidden="true"><path d="m70 15 51 28-51 29-51-29Z" fill="#ffbd72"/><path d="m19 43 51 29v49l-51-29Z" fill="#f69537"/><path d="m70 72 51-29v49l-51 29Z" fill="#df6c22"/><path d="m46 28 51 29v25l-15 8V65L32 36Z" fill="#ffdcac"/><path d="m33 78 19 11v5L33 83Z" fill="#fff3de"/><path d="m77 104 13-8" stroke="#ffb76e" strokeWidth="3" strokeLinecap="round"/></svg><span className={styles["parcel-check"]}><svg><use href="#fi-landing-check"/></svg></span><span className={styles["parcel-label"]}>Handled with care.</span></div>
        <div className={cn(styles["map-card"], styles["floating"])}>
          <div className={styles["map-header"]}><div><span className={styles["tiny-label"]}>A LITTLE CLOSER</span><h2 id="map-title">{mode === "ride" ? "Your next ride." : "Your next delivery."}</h2></div><span className={styles["live-pill"]}><i></i> Preview</span></div>
          <div className={styles["map-surface"]}>
            <svg ref={mapRef} viewBox="0 0 430 300" className={styles["route-map"]} role="img" aria-label="Illustrated delivery route from pickup to your destination">
              <defs><pattern id="fi-landing-blocks" width="95" height="78" patternUnits="userSpaceOnUse" patternTransform="rotate(-12)"><rect width="95" height="78" fill="#f4f1e9"/><rect x="8" y="8" width="78" height="60" rx="8" fill="#e8e7dd"/></pattern><path id="fi-landing-travel-path" d="M76 230 133 218 Q148 215 145 199L130 132Q127 116 145 112L271 85Q291 81 295 103L311 168"/></defs>
              <rect width="430" height="300" fill="url(#fi-landing-blocks)"/><path d="m352-20 12 93 24 57-3 90 48 99" fill="none" stroke="#d4e9e6" strokeWidth="36"/><path d="m-15 183 452-97M99-15l69 331M272-20l71 330" fill="none" stroke="#fffdf8" strokeWidth="17"/><rect x="174" y="153" width="63" height="63" rx="17" fill="#d8e0cb" transform="rotate(-12 205 185)"/><circle cx="189" cy="178" r="10" fill="#c5d2b9"/><circle cx="215" cy="187" r="12" fill="#c5d2b9"/><text x="29" y="47" className={styles["map-label"]}>LAHUG</text><text x="224" y="254" className={styles["map-label"]}>CEBU CITY</text>
              <use href="#fi-landing-travel-path" fill="none" stroke="#fff" strokeWidth="13" strokeLinecap="round"/><use href="#fi-landing-travel-path" className={styles["draw-route"]} fill="none" stroke="#f48b37" strokeWidth="6" strokeLinecap="round"/>
              <circle cx="76" cy="230" r="15" fill="#203b38" stroke="white" strokeWidth="5"/><circle cx="76" cy="230" r="4" fill="white"/><circle className={styles["destination-pulse"]} cx="311" cy="168" r="23" fill="#f48b37" opacity=".18"/><circle cx="311" cy="168" r="12" fill="#f48b37" stroke="white" strokeWidth="5"/>
              <g className={styles["moving-rider"]}><circle r="19" fill="#fff" stroke="#ffd4ac" strokeWidth="2"/><g transform="translate(-12,-12)" fill="none" stroke="#203b38" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="17" r="3.5"/><circle cx="20" cy="17" r="3.5"/><path d="m5 17 5-8h5l5 8M8 17h7l-5-8m4-4h4l2 12M9 7H5"/></g><animateMotion dur="12s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;.85;1" calcMode="linear"><mpath href="#fi-landing-travel-path"/></animateMotion></g>
              <g transform="translate(273 193)"><rect width="80" height="29" rx="9" fill="white"/><text x="40" y="19" textAnchor="middle" className={styles["you-label"]}>Your stop</text></g>
            </svg>
          </div>
          <div className={styles["map-footer"]}><div className={styles["rider-avatar"]}><svg><use href="#fi-landing-pin"/></svg><span></span></div><div className={styles["rider-info"]}><strong>Follow every move</strong><span>From pickup to arrival</span></div><div className={styles["eta"]}><strong><small>With you</small></strong><span>every step</span></div></div>
        </div>
        <div className={cn(styles["delivered-card"], styles["floating"])}><span className={styles["success-icon"]}><svg><use href="#fi-landing-check"/></svg></span><div><strong>Good things, delivered.</strong><span>One less thing on your list.</span></div><span className={styles["confetti-dot"]}></span></div>
        <span className={cn(styles["ornament"], styles["orb"], styles["orb-two"])} aria-hidden="true"></span>
      </div>
    </section>
<div className={styles["canvas-footer"]}><span>Made for the way you move.</span><span className={styles["footer-line"]} /><span>Your everyday, delivered.</span><a href="#services" className={styles["explore-link"]}>Explore Fetch-It ↓</a></div>
  </div>;
}

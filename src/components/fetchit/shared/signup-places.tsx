"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookmarkCheck, BriefcaseBusiness, Check, Home, LocateFixed, MapPin, Pencil, School } from "lucide-react";
import { useCustomerData } from "@/hooks/use-customer-data";
import { useAppStore } from "@/lib/store";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { mergeSavedPlaces, setOnboardingPending, type SavedPlace } from "@/lib/signup-onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FetchItLogo } from "./logo";
import { FetchItLoader } from "./loading";
import { LocationMap } from "./location-map";
import { PlaceAutocompleteInput, type PlaceValue } from "./place-autocomplete-input";
import { SignupJourney } from "./signup-journey";
import styles from "./signup-places.module.css";

type PlaceDraft = { place: PlaceValue | null; text: string; details: string; id?: string };
type SetupDraft = { step: number; home: PlaceDraft; destination: PlaceDraft; destinationName: string };
const blankPlace: PlaceDraft = { place: null, text: "", details: "" };
const steps = ["Home", "Usual destination", "Review"];
function fromSaved(place?: SavedPlace): PlaceDraft {
  return place ? { place, text: place.label, details: place.details ?? "", id: place.id } : { ...blankPlace };
}

export function SignupPlaces() {
  const userId = useAppStore(state => state.user?.id ?? "anonymous");
  const setView = useAppStore(state => state.setView);
  const [places, setPlaces] = useCustomerData<SavedPlace[]>(userId, "places", [], true);
  const destination = places.find(place => place.name.toLowerCase() !== "home");
  const initial: SetupDraft = { step: 0, home: fromSaved(places.find(place => place.name.toLowerCase() === "home")), destination: fromSaved(destination), destinationName: destination?.name ?? "Work" };
  const [storedDraft, setStoredDraft] = useCustomerData<SetupDraft | null>(userId, "signup-places-v1", null, true);
  const draft = storedDraft ?? initial;
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const step = draft.step;
  const isHome = step === 0;
  const current = isHome ? draft.home : draft.destination;

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [step]);

  function update(next: Partial<SetupDraft>) {
    setStoredDraft(previous => ({ ...(previous ?? initial), ...next }));
    setError("");
  }

  function updatePlace(next: Partial<PlaceDraft>) {
    const key = isHome ? "home" : "destination";
    setStoredDraft(previous => {
      const value = previous ?? initial;
      return { ...value, [key]: { ...value[key], ...next } };
    });
    setError("");
  }

  function go(nextStep: number) { update({ step: nextStep }); }
  function finish(save: boolean) {
    if (save) {
      const next: SavedPlace[] = [];
      if (draft.home.place) next.push({ ...draft.home.place, id: draft.home.id ?? crypto.randomUUID(), name: "Home", details: draft.home.details.trim() });
      if (draft.destination.place) next.push({ ...draft.destination.place, id: draft.destination.id ?? crypto.randomUUID(), name: draft.destinationName.trim(), details: draft.destination.details.trim() });
      setPlaces(previous => mergeSavedPlaces(previous, next));
    }
    setStoredDraft(null);
    setOnboardingPending(userId, false);
    setView("mode-select");
  }

  return <div className="min-h-svh flex flex-col bg-background">
    <header className="border-b border-foreground/5">
      <div className="mx-auto flex h-18 max-w-6xl items-center justify-between gap-4 px-5 sm:px-6">
        <FetchItLogo size={28} />
        <Button variant="ghost" size="sm" onClick={() => finish(false)}>Set up later <ArrowRight aria-hidden="true" /></Button>
      </div>
    </header>
    <main className={styles.layout}>
      <aside className={styles.illustration}>
        <div className={styles.intro}>
          <p className="text-[10px] font-semibold tracking-[.2em] text-[#627069]">A FEW FAMILIAR PLACES</p>
          <h2 className="mt-5 text-[44px] font-semibold leading-[1.08] tracking-[-.05em]">Your everyday.<br />A little closer.</h2>
          <p className="mt-4 max-w-xs text-sm leading-6 text-[#627069]">Less time typing addresses.<br />More time getting on with your day.</p>
        </div>
        <SignupJourney step={step} />
        <div className={styles.caption}>
          <BookmarkCheck className="size-5 shrink-0" aria-hidden="true" />
          <p>Your places, ready when you are.<br /><span className="text-[#627069]">Choose them again for rides and deliveries.</span></p>
        </div>
      </aside>
      <section className={styles.panel} aria-label="Set up your saved places">
        <ol className={styles.steps} aria-label="Setup progress">
          {steps.map((label, index) => <li key={label} className={styles.stepItem} data-active={index <= step} aria-current={index === step ? "step" : undefined}>
            <div className={styles.stepBar} />
            <span>{index < step ? <Check className="mr-1 inline size-3" aria-hidden="true" /> : `${index + 1}. `}{label}</span>
          </li>)}
        </ol>
        <div key={step} className={styles.step}>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[.18em] text-primary">{step === 2 ? "READY WHEN YOU ARE" : `MAKE IT YOURS · STEP ${step + 1} OF 2`}</p>
          <h1 ref={heading} tabIndex={-1} className="text-3xl font-semibold leading-tight tracking-[-.04em] outline-none sm:text-4xl">{isHome ? "Where do you live?" : step === 1 ? "Where do you usually go?" : "Your places. All set."}</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{isHome ? "Save your home address for faster deliveries and ride bookings." : step === 1 ? "Work, school, or your favorite stop. Save a frequent destination for future rides and deliveries." : "Check your addresses below. You can change them anytime in Settings → Saved places."}</p>

          {step < 2 ? <form className="mt-6 space-y-5" onSubmit={event => {
            event.preventDefault();
            if (!current.place) { setError("Choose an address from the suggestions or confirm a pin on the map."); return; }
            if (!isHome && (!draft.destinationName.trim() || draft.destinationName.trim().toLowerCase() === "home")) { setError("Give this destination a name other than Home."); return; }
            go(step + 1);
          }}>
            {!isHome && <div className="space-y-2" role="group" aria-label="Destination nickname">
              <p className="text-sm font-medium">Save as</p>
              <div className="flex gap-2">
                {[{ name: "Work", Icon: BriefcaseBusiness }, { name: "School", Icon: School }, { name: "Other", Icon: MapPin }].map(({ name, Icon }) => <Button key={name} type="button" variant={(name === "Other" ? !["Work", "School"].includes(draft.destinationName) : draft.destinationName === name) ? "secondary" : "outline"} size="sm" aria-pressed={name === "Other" ? !["Work", "School"].includes(draft.destinationName) : draft.destinationName === name} onClick={() => update({ destinationName: name === "Other" ? "" : name })}><Icon aria-hidden="true" />{name}</Button>)}
              </div>
              {!["Work", "School"].includes(draft.destinationName) && <Input id="destination-name" aria-label="Destination nickname" required placeholder="e.g. Grandma’s house" maxLength={40} value={draft.destinationName} onChange={event => update({ destinationName: event.target.value })} />}
            </div>}
            <PlacePicker key={step} value={current} isHome={isHome} onChange={updatePlace} />
            <details className="rounded-xl border px-4 py-3">
              <summary className="cursor-pointer text-xs font-medium">{current.details ? "Edit address details" : "Add address details"} <span className="font-normal text-muted-foreground">(optional)</span></summary>
              <div className="mt-3 space-y-2"><Label htmlFor="place-details" className="text-xs">Unit, building, or landmark</Label><Input id="place-details" autoComplete="address-line2" maxLength={240} placeholder="e.g. Unit 4B, beside the bakery" value={current.details} onChange={event => updatePlace({ details: event.target.value })} /></div>
            </details>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="space-y-2 pt-1">
              <Button type="submit" size="lg" className="w-full">{isHome ? "Continue" : "Review my places"}<ArrowRight aria-hidden="true" /></Button>
              <div className="flex items-center justify-between gap-2">
                {step === 1 ? <Button type="button" variant="ghost" size="sm" onClick={() => go(0)}><ArrowLeft aria-hidden="true" />Back</Button> : <span />}
                <Button type="button" variant="ghost" size="sm" onClick={() => { update({ [isHome ? "home" : "destination"]: { ...blankPlace }, step: step + 1 }); }}>Skip for now</Button>
              </div>
            </div>
          </form> : <div className="mt-6 space-y-4">
            <ReviewPlace name="Home" value={draft.home} onEdit={() => go(0)} />
            <ReviewPlace name={draft.destinationName.trim() || "Usual destination"} value={draft.destination} onEdit={() => go(1)} />
            <div className="pt-3"><Button size="lg" className="w-full" onClick={() => finish(true)}>{draft.home.place || draft.destination.place ? "Save places & continue" : "Let’s get moving"}<ArrowRight aria-hidden="true" /></Button></div>
            <Button variant="ghost" size="sm" onClick={() => go(1)}><ArrowLeft aria-hidden="true" />Back</Button>
          </div>}
          <p className="mt-5 text-center text-[11px] leading-5 text-muted-foreground">Optional setup. Saved for your account on this device.<br />You can change these anytime in Saved places.</p>
        </div>
      </section>
    </main>
  </div>;
}

function ReviewPlace({ name, value, onEdit }: { name: string; value: PlaceDraft; onEdit: () => void }) {
  const Icon = name === "Home" ? Home : name === "School" ? School : BriefcaseBusiness;
  return <div className={styles.addressCard}>
    <span className={styles.icon}><Icon className="size-5" aria-hidden="true" /></span>
    <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{name}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{value.place?.label ?? "Not added yet. You can add this later."}</p>{value.place && value.details && <p className="mt-1 text-xs text-muted-foreground">{value.details}</p>}</div>
    <Button size="icon" variant="ghost" aria-label={`${value.place ? "Edit" : "Add"} ${name}`} onClick={onEdit}><Pencil aria-hidden="true" /></Button>
  </div>;
}

function PlacePicker({ value, isHome, onChange }: { value: PlaceDraft; isHome: boolean; onChange: (next: Partial<PlaceDraft>) => void }) {
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const alive = useRef(true);
  const locationRequest = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function locateCurrentAddress() {
    if (locationRequest.current) return;
    if (!navigator.geolocation) { setLocationError("Location is unavailable. Search for your address instead."); return; }
    locationRequest.current = true;
    setLocating(true); setLocationError("");
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 12000, maximumAge: 60000, enableHighAccuracy: true }));
      if (!alive.current) return;
      await loadGoogleMaps();
      if (!alive.current) return;
      const location = { lat: position.coords.latitude, lng: position.coords.longitude };
      const label = await new Promise<string>((resolve, reject) => new window.google.maps.Geocoder().geocode({ location }, (results, status) => {
        if (status === "OK" && results?.[0]) resolve(results[0].formatted_address);
        else reject(new Error("Address unavailable"));
      }));
      if (alive.current) onChange({ place: { ...location, label }, text: label });
    } catch {
      if (alive.current) setLocationError("We couldn’t find your location. Allow location access or search for your address instead.");
    } finally {
      locationRequest.current = false;
      if (alive.current) setLocating(false);
    }
  }

  return <div className="space-y-3">
    <div className="space-y-2"><Label htmlFor="setup-address">{isHome ? "Home address" : "Destination address"}</Label>
      <PlaceAutocompleteInput id="setup-address" describedBy="setup-address-help" placeholder="Search street, building, or area" value={value.text} onTextChange={text => onChange({ text, place: null })} onChange={place => { setLocationError(""); onChange({ place, text: place.label }); }} />
      <p id="setup-address-help" className="text-[11px] leading-5 text-muted-foreground">Choose a search suggestion, or move the map and confirm your pin.</p>
    </div>
    <Button type="button" variant="outline" className="w-full" disabled={locating} onClick={() => void locateCurrentAddress()}>{locating ? <FetchItLoader className="size-4" /> : <LocateFixed aria-hidden="true" />}{locating ? "Finding your location…" : "Use my current location"}</Button>
    {locationError && <p role="alert" className="text-xs text-destructive">{locationError}</p>}
    <LocationMap lat={value.place?.lat ?? null} lng={value.place?.lng ?? null} pinColor="#bd4c1d" mapClassName="h-36 sm:h-40" onConfirm={place => onChange({ place, text: place.label })} />
    {value.place && <div role="status" className="flex items-start gap-2 rounded-xl bg-secondary/60 px-3 py-2 text-xs leading-5"><Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{value.place.label}</span></div>}
  </div>;
}

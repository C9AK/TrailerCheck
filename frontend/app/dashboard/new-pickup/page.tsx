"use client";

import { Fuel, Loader2, MapPin, Truck, User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner, Skeleton, SuccessBanner, Toggle } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type {
  MotorCarrier,
  Telemetry,
  Ticket,
  Trailer,
  TrailerCondition,
} from "@/lib/types";

/** PTI is strictly a checkbox array — never a file upload (04-Frontend-UI-UX-Spec §2). */
const PTI_ITEMS = [
  "Brakes & air lines checked",
  "Lights & reflectors working",
  "Tires, wheels & rims inspected",
  "Coupling devices & landing gear secure",
];

const CONDITIONS: TrailerCondition[] = ["Good", "Fair", "Damaged"];

function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

export default function NewPickupPage() {
  return (
    <RequireRole roles={["employee", "manager"]}>
      <NewPickupForm />
    </RequireRole>
  );
}

function NewPickupForm() {
  const [mcs, setMcs] = useState<MotorCarrier[]>([]);
  const [mcId, setMcId] = useState("");
  const [truckNumber, setTruckNumber] = useState("");

  // Telematics (auto-filled)
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const telemetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // LOT trailer
  const [isLot, setIsLot] = useState(false);
  const [trailerNumber, setTrailerNumber] = useState("");
  const [lastPtiDate, setLastPtiDate] = useState("");
  const [trailerError, setTrailerError] = useState<string | null>(null);
  const [trailerLoading, setTrailerLoading] = useState(false);

  // Checklist
  const [ptiChecks, setPtiChecks] = useState<boolean[]>(PTI_ITEMS.map(() => false));
  const [registrationVerified, setRegistrationVerified] = useState(false);
  const [inspectionVerified, setInspectionVerified] = useState(false);
  const [stickerVerified, setStickerVerified] = useState(false);
  const [tiresInspected, setTiresInspected] = useState(false);
  const [caFlDestination, setCaFlDestination] = useState(false);
  const [bolPresent, setBolPresent] = useState(false);
  const [weight, setWeight] = useState("");
  const [condition, setCondition] = useState<TrailerCondition>("Good");
  const [conditionNotes, setConditionNotes] = useState("");
  const [needsScale, setNeedsScale] = useState(false);
  const [scaleReceived, setScaleReceived] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const ptiVerified = ptiChecks.every(Boolean);

  useEffect(() => {
    api<MotorCarrier[]>("/api/mcs")
      .then(setMcs)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load MCs."));
  }, []);

  // Debounced telemetry auto-fill: fires once an MC is selected and a truck number typed.
  const scheduleTelemetry = useCallback((mc: string, truck: string) => {
    if (telemetryTimer.current) clearTimeout(telemetryTimer.current);
    if (!mc || truck.trim().length < 2) return;
    telemetryTimer.current = setTimeout(async () => {
      setTelemetryLoading(true);
      setTelemetry(null);
      setTelemetryError(null);
      try {
        const data = await api<Telemetry>(
          `/api/telemetry/truck/${mc}/${encodeURIComponent(truck.trim())}`
        );
        setTelemetry(data);
      } catch (e) {
        setTelemetry(null);
        setTelemetryError(
          e instanceof ApiError ? e.message : "Telemetry unavailable."
        );
      } finally {
        setTelemetryLoading(false);
      }
    }, 600);
  }, []);

  async function lookupTrailer() {
    const num = trailerNumber.trim();
    if (!num) return;
    setTrailerLoading(true);
    setTrailerError(null);
    try {
      const trailer = await api<Trailer>(`/api/trailers/${encodeURIComponent(num)}`);
      setLastPtiDate(toDateInputValue(trailer.last_pti_date));
    } catch (e) {
      setTrailerError(e instanceof ApiError ? e.message : "Trailer lookup failed.");
      setLastPtiDate("");
    } finally {
      setTrailerLoading(false);
    }
  }

  const ptiAgeDays = lastPtiDate
    ? Math.floor((Date.now() - new Date(`${lastPtiDate}T00:00:00Z`).getTime()) / 86_400_000)
    : null;
  const lotPtiFresh = ptiAgeDays !== null && ptiAgeDays < 7;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const ticket = await api<Ticket>("/api/tickets", {
        method: "POST",
        body: JSON.stringify({
          mc_id: mcId,
          truck_number: truckNumber.trim(),
          is_lot_trailer: isLot,
          trailer_number: isLot ? trailerNumber.trim() : null,
          last_pti_date_override:
            isLot && lastPtiDate ? `${lastPtiDate}T00:00:00Z` : null,
          driver_name: telemetry?.driver_name ?? null,
          truck_location: telemetry?.location ?? null,
          truck_latitude: telemetry?.latitude ?? null,
          truck_longitude: telemetry?.longitude ?? null,
          truck_model: telemetry?.model ?? null,
          fuel_percentage: telemetry?.fuel_percentage ?? null,
          registration_verified: registrationVerified,
          inspection_paper_verified: inspectionVerified,
          sticker_verified: stickerVerified,
          is_ca_fl_destination: caFlDestination,
          tires_inspected: tiresInspected,
          bol_present: bolPresent,
          weight: weight ? Number(weight) : null,
          trailer_condition: condition,
          condition_notes: conditionNotes || null,
          needs_scale: needsScale,
          scale_ticket_received: needsScale ? scaleReceived : false,
          pti_verified: ptiVerified,
        }),
      });
      setSuccess(
        ticket.state === "PENDING_QC"
          ? "Ticket created — complete, sent to QC review."
          : "Ticket created — saved to Carryover (awaiting driver/scale ticket)."
      );
      // Reset for the next pickup
      setTruckNumber("");
      setTelemetry(null);
      setIsLot(false);
      setTrailerNumber("");
      setLastPtiDate("");
      setPtiChecks(PTI_ITEMS.map(() => false));
      setRegistrationVerified(false);
      setInspectionVerified(false);
      setStickerVerified(false);
      setTiresInspected(false);
      setCaFlDestination(false);
      setBolPresent(false);
      setWeight("");
      setCondition("Good");
      setConditionNotes("");
      setNeedsScale(false);
      setScaleReceived(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create ticket.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-800 focus:outline-none focus:ring-1 focus:ring-blue-800 dark:border-slate-700 dark:bg-slate-800";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 font-mono text-xl font-semibold">New Pickup</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Truck & telemetry */}
        <section className="rounded-lg border border-blue-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Truck
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="mc" className="mb-1 block text-sm font-medium">
                Motor Carrier <span className="text-red-600">*</span>
              </label>
              <select
                id="mc"
                required
                value={mcId}
                onChange={(e) => {
                  setMcId(e.target.value);
                  scheduleTelemetry(e.target.value, truckNumber);
                }}
                className={inputCls}
              >
                <option value="">Select MC…</option>
                {mcs.map((mc) => (
                  <option key={mc.id} value={mc.id}>
                    {mc.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="truck" className="mb-1 block text-sm font-medium">
                Truck Number <span className="text-red-600">*</span>
              </label>
              <input
                id="truck"
                required
                value={truckNumber}
                onChange={(e) => {
                  setTruckNumber(e.target.value);
                  scheduleTelemetry(mcId, e.target.value);
                }}
                placeholder="e.g. TRK-4021"
                className={`${inputCls} font-mono`}
              />
            </div>
          </div>

          {/* Auto-fill display with inline skeleton loaders */}
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <TelemetryField
              icon={User}
              label="Driver Name"
              value={telemetry?.driver_name}
              loading={telemetryLoading}
            />
            <TelemetryField
              icon={MapPin}
              label="Location"
              value={telemetry?.location}
              loading={telemetryLoading}
            />
            <TelemetryField
              icon={Truck}
              label="Model"
              value={telemetry?.model}
              loading={telemetryLoading}
            />
            <TelemetryField
              icon={Fuel}
              label="Fuel"
              value={
                telemetry != null
                  ? telemetry.fuel_percentage != null
                    ? `${telemetry.fuel_percentage.toFixed(0)}%`
                    : "—"
                  : undefined
              }
              loading={telemetryLoading}
            />
          </div>
          {telemetryError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
              {telemetryError}
            </p>
          )}
        </section>

        {/* LOT trailer */}
        <section className="rounded-lg border border-blue-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                LOT Trailer
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                LOT trailers with a PTI newer than 7 days may skip re-verification.
              </p>
            </div>
            <Toggle id="lot-toggle" checked={isLot} onChange={setIsLot} label="LOT Trailer" />
          </div>

          {isLot && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="trailer-number" className="mb-1 block text-sm font-medium">
                  Trailer Number <span className="text-red-600">*</span>
                </label>
                <input
                  id="trailer-number"
                  required={isLot}
                  value={trailerNumber}
                  onChange={(e) => setTrailerNumber(e.target.value)}
                  onBlur={lookupTrailer}
                  placeholder="e.g. LOT-1001"
                  className={`${inputCls} font-mono`}
                />
                {trailerError && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{trailerError}</p>
                )}
              </div>
              <div>
                <label htmlFor="last-pti" className="mb-1 block text-sm font-medium">
                  Last PTI Date
                </label>
                {trailerLoading ? (
                  <Skeleton className="h-9 w-full" />
                ) : (
                  <input
                    id="last-pti"
                    type="date"
                    value={lastPtiDate}
                    onChange={(e) => setLastPtiDate(e.target.value)}
                    className={inputCls}
                  />
                )}
                {ptiAgeDays !== null && !trailerLoading && (
                  <p
                    className={`mt-1 text-xs font-medium ${
                      lotPtiFresh
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {lotPtiFresh
                      ? `PTI is ${ptiAgeDays} day(s) old — verification optional.`
                      : `PTI is ${ptiAgeDays} day(s) old — full PTI checklist required.`}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* PTI checklist — checkbox array, NO file upload */}
        <section className="rounded-lg border border-blue-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            PTI Verification
          </h2>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Check every item to mark the PTI as verified. Not required to save —
            the ticket can wait in Carryover — but it must be verified before the
            ticket can go to QC review.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {PTI_ITEMS.map((item, i) => (
              <label key={item} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ptiChecks[i]}
                  onChange={(e) =>
                    setPtiChecks((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))
                  }
                  className="h-4 w-4 accent-brand-600"
                />
                {item}
              </label>
            ))}
          </div>
          <p
            className={`mt-2 text-xs font-semibold ${
              ptiVerified
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            PTI status: {ptiVerified ? "VERIFIED" : "NOT VERIFIED"}
          </p>
        </section>

        {/* Documents & condition */}
        <section className="rounded-lg border border-blue-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Documents & Condition
          </h2>

          {/* Prominent CA/FL destination checkbox */}
          <label className="mb-3 flex cursor-pointer items-center gap-2.5 rounded border-2 border-amber-400 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200">
            <input
              type="checkbox"
              checked={caFlDestination}
              onChange={(e) => setCaFlDestination(e.target.checked)}
              className="h-5 w-5 accent-amber-600"
            />
            CA / FL destination
          </label>

          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={registrationVerified}
                onChange={(e) => setRegistrationVerified(e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              Registration verified
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={inspectionVerified}
                onChange={(e) => setInspectionVerified(e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              Inspection paper verified
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={stickerVerified}
                onChange={(e) => setStickerVerified(e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              Sticker verified
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={bolPresent}
                onChange={(e) => setBolPresent(e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              BOL present
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={tiresInspected}
                onChange={(e) => setTiresInspected(e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              Tires inspected
            </label>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="weight" className="mb-1 block text-sm font-medium">
                Weight (lbs)
              </label>
              <input
                id="weight"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className={`${inputCls} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="condition" className="mb-1 block text-sm font-medium">
                Trailer Condition
              </label>
              <select
                id="condition"
                value={condition}
                onChange={(e) => setCondition(e.target.value as TrailerCondition)}
                className={inputCls}
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-1">
              <label htmlFor="notes" className="mb-1 block text-sm font-medium">
                Condition Notes
              </label>
              <input
                id="notes"
                value={conditionNotes}
                onChange={(e) => setConditionNotes(e.target.value)}
                placeholder={condition === "Damaged" ? "Describe the damage…" : "Optional"}
                className={inputCls}
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-6">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={needsScale}
                onChange={(e) => setNeedsScale(e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              Needs scale
            </label>
            {needsScale && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={scaleReceived}
                  onChange={(e) => setScaleReceived(e.target.checked)}
                  className="h-4 w-4 accent-brand-600"
                />
                Scale ticket received
              </label>
            )}
          </div>
          {needsScale && !scaleReceived && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              Ticket will be saved to Carryover until the scale ticket arrives.
            </p>
          )}
        </section>

        <ErrorBanner message={error} />
        <SuccessBanner message={success} />

        <button
          type="submit"
          disabled={submitting || !mcId || !truckNumber.trim()}
          className="flex cursor-pointer items-center gap-2 rounded bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Create Ticket
        </button>
      </form>
    </div>
  );
}

function TelemetryField({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: typeof User;
  label: string;
  value?: string;
  loading: boolean;
}) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </div>
      {loading ? (
        <Skeleton className="h-5 w-full" />
      ) : (
        <p className="truncate font-mono text-sm font-medium" title={value ?? ""}>
          {value ?? "—"}
        </p>
      )}
    </div>
  );
}

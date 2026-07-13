"use client";

import { CheckSquare, Fuel, Loader2, MapPin, Truck, User } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner, Skeleton, SuccessBanner, Toggle } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { emptyChecklist, isPtiComplete, PTI_SECTIONS, type PtiChecklist } from "@/lib/pti";
import type {
  MotorCarrier,
  Telemetry,
  Ticket,
  Trailer,
  TrailerCondition,
} from "@/lib/types";

const CONDITIONS: TrailerCondition[] = ["Good", "Fair", "Damaged"];

function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

export default function NewPickupPage() {
  return (
    <RequireRole roles={["employee", "manager"]}>
      <Suspense fallback={null}>
        <NewPickupForm />
      </Suspense>
    </RequireRole>
  );
}

function NewPickupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");

  const [mcs, setMcs] = useState<MotorCarrier[]>([]);
  const [mcId, setMcId] = useState("");
  const [truckNumber, setTruckNumber] = useState("");
  const [loadingTicket, setLoadingTicket] = useState(Boolean(editId));

  // Truck details — auto-filled from Samsara but always manually editable
  // (graceful degradation when the truck isn't in the fleet API).
  const [driverName, setDriverName] = useState("");
  const [truckLocation, setTruckLocation] = useState("");
  const [truckModel, setTruckModel] = useState("");
  const [fuelPct, setFuelPct] = useState("");
  const [coords, setCoords] = useState<{ lat: number | null; lon: number | null }>({
    lat: null,
    lon: null,
  });
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [telemetryInfo, setTelemetryInfo] = useState<string | null>(null);
  const telemetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // LOT trailer (creation only — trailer identity is fixed once created)
  const [isLot, setIsLot] = useState(false);
  const [trailerNumber, setTrailerNumber] = useState("");
  const [lastPtiDate, setLastPtiDate] = useState("");
  const [trailerError, setTrailerError] = useState<string | null>(null);
  const [trailerLoading, setTrailerLoading] = useState(false);

  // Checklist
  const [pti, setPti] = useState<PtiChecklist>(emptyChecklist());
  const [registrationVerified, setRegistrationVerified] = useState(false);
  const [inspectionVerified, setInspectionVerified] = useState(false);
  const [stickerVerified, setStickerVerified] = useState(false);
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

  const ptiComplete = isPtiComplete(pti);
  const allChecked = Object.values(pti).every(Boolean);

  useEffect(() => {
    api<MotorCarrier[]>("/api/mcs")
      .then(setMcs)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load MCs."));
  }, []);

  // Edit mode: prefill the full form from the existing ticket
  useEffect(() => {
    if (!editId) return;
    api<Ticket>(`/api/tickets/${editId}`)
      .then((t) => {
        setMcId(t.mc_id);
        setTruckNumber(t.truck_number);
        setDriverName(t.driver_name ?? "");
        setTruckLocation(t.truck_location ?? "");
        setTruckModel(t.truck_model ?? "");
        setFuelPct(t.fuel_percentage != null ? String(t.fuel_percentage) : "");
        setCoords({ lat: t.truck_latitude, lon: t.truck_longitude });
        setIsLot(t.is_lot_trailer);
        setPti({ ...emptyChecklist(), ...(t.pti_checklist ?? {}) });
        setRegistrationVerified(t.registration_verified);
        setInspectionVerified(t.inspection_paper_verified);
        setStickerVerified(t.sticker_verified);
        setCaFlDestination(t.is_ca_fl_destination);
        setBolPresent(t.bol_present);
        setWeight(t.weight ?? "");
        setCondition(t.trailer_condition ?? "Good");
        setConditionNotes(t.condition_notes ?? "");
        setNeedsScale(t.needs_scale);
        setScaleReceived(t.scale_ticket_received);
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Failed to load the ticket.")
      )
      .finally(() => setLoadingTicket(false));
  }, [editId]);

  // Debounced telemetry auto-fill. LOT bypasses the fleet lookup (R7); a
  // truck missing from Samsara never blocks the form (R8) — fields stay
  // manually editable either way.
  const scheduleTelemetry = useCallback(
    (mc: string, truck: string, lot: boolean) => {
      if (telemetryTimer.current) clearTimeout(telemetryTimer.current);
      setTelemetryInfo(null);
      if (lot || !mc || truck.trim().length < 2) return;
      telemetryTimer.current = setTimeout(async () => {
        setTelemetryLoading(true);
        try {
          const d = await api<Telemetry>(
            `/api/telemetry/truck/${mc}/${encodeURIComponent(truck.trim())}`
          );
          setDriverName(d.driver_name);
          setTruckLocation(d.location);
          setTruckModel(d.model);
          setFuelPct(d.fuel_percentage != null ? String(d.fuel_percentage) : "");
          setCoords({ lat: d.latitude, lon: d.longitude });
        } catch (e) {
          setTelemetryInfo(
            e instanceof ApiError && e.status === 404
              ? "Truck not found in Samsara — enter the details manually below."
              : "Telemetry unavailable — enter the details manually below."
          );
        } finally {
          setTelemetryLoading(false);
        }
      }, 600);
    },
    []
  );

  async function lookupTrailer() {
    const num = trailerNumber.trim();
    if (!num) return;
    setTrailerLoading(true);
    setTrailerError(null);
    try {
      const trailer = await api<Trailer>(`/api/trailers/${encodeURIComponent(num)}`);
      setLastPtiDate(toDateInputValue(trailer.last_pti_date));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setTrailerError(
          "New trailer — it will be registered when you create the ticket. Set its last PTI date below."
        );
      } else {
        setTrailerError(e instanceof ApiError ? e.message : "Trailer lookup failed.");
      }
      setLastPtiDate("");
    } finally {
      setTrailerLoading(false);
    }
  }

  const ptiAgeDays = lastPtiDate
    ? Math.floor((Date.now() - new Date(`${lastPtiDate}T00:00:00Z`).getTime()) / 86_400_000)
    : null;
  const lotPtiFresh = ptiAgeDays !== null && ptiAgeDays < 7;

  function setPtiKey(key: string, value: boolean) {
    setPti((prev) => ({ ...prev, [key]: value }));
  }

  function setAllPti(value: boolean) {
    setPti(Object.fromEntries(Object.keys(emptyChecklist()).map((k) => [k, value])));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    const common = {
      truck_number: truckNumber.trim(),
      driver_name: driverName.trim() || null,
      truck_location: truckLocation.trim() || null,
      truck_latitude: coords.lat,
      truck_longitude: coords.lon,
      truck_model: truckModel.trim() || null,
      fuel_percentage: fuelPct.trim() ? Number(fuelPct) || null : null,
      registration_verified: registrationVerified,
      inspection_paper_verified: inspectionVerified,
      sticker_verified: stickerVerified,
      is_ca_fl_destination: caFlDestination,
      bol_present: bolPresent,
      weight: weight.trim() || null,
      trailer_condition: condition,
      condition_notes: conditionNotes || null,
      needs_scale: needsScale,
      scale_ticket_received: needsScale ? scaleReceived : false,
      pti_checklist: pti,
    };
    try {
      if (editId) {
        await api<Ticket>(`/api/tickets/${editId}`, {
          method: "PATCH",
          body: JSON.stringify(common),
        });
        router.push("/dashboard/carryover");
        return;
      }
      const ticket = await api<Ticket>("/api/tickets", {
        method: "POST",
        body: JSON.stringify({
          ...common,
          mc_id: mcId,
          is_lot_trailer: isLot,
          trailer_number: isLot ? trailerNumber.trim() : null,
          last_pti_date_override: isLot && lastPtiDate ? `${lastPtiDate}T00:00:00Z` : null,
        }),
      });
      setSuccess(
        ticket.state === "PENDING_QC"
          ? "Ticket created — complete, sent to QC review."
          : "Ticket created — saved to Carryover (awaiting driver/scale ticket)."
      );
      // Reset for the next pickup
      setTruckNumber("");
      setDriverName("");
      setTruckLocation("");
      setTruckModel("");
      setFuelPct("");
      setCoords({ lat: null, lon: null });
      setIsLot(false);
      setTrailerNumber("");
      setLastPtiDate("");
      setPti(emptyChecklist());
      setRegistrationVerified(false);
      setInspectionVerified(false);
      setStickerVerified(false);
      setCaFlDestination(false);
      setBolPresent(false);
      setWeight("");
      setCondition("Good");
      setConditionNotes("");
      setNeedsScale(false);
      setScaleReceived(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-800 focus:outline-none focus:ring-1 focus:ring-blue-800 dark:border-slate-700 dark:bg-slate-800";

  if (loadingTicket) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 font-mono text-xl font-semibold">
        {editId ? `Edit Pickup — Truck ${truckNumber}` : "New Pickup"}
      </h1>

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
                disabled={Boolean(editId)}
                value={mcId}
                onChange={(e) => {
                  setMcId(e.target.value);
                  scheduleTelemetry(e.target.value, truckNumber, isLot);
                }}
                className={`${inputCls} disabled:opacity-60`}
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
                  scheduleTelemetry(mcId, e.target.value, isLot);
                }}
                placeholder="e.g. 1319 A"
                className={`${inputCls} font-mono`}
              />
            </div>
          </div>

          {/* Truck details — auto-filled, always editable */}
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <TelemetryInput
              icon={User}
              label="Driver Name"
              value={driverName}
              onChange={setDriverName}
              loading={telemetryLoading}
            />
            <TelemetryInput
              icon={MapPin}
              label="Location"
              value={truckLocation}
              onChange={setTruckLocation}
              loading={telemetryLoading}
            />
            <TelemetryInput
              icon={Truck}
              label="Model"
              value={truckModel}
              onChange={setTruckModel}
              loading={telemetryLoading}
            />
            <TelemetryInput
              icon={Fuel}
              label="Fuel %"
              value={fuelPct}
              onChange={setFuelPct}
              loading={telemetryLoading}
            />
          </div>
          {telemetryInfo && (
            <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400" role="status">
              {telemetryInfo}
            </p>
          )}
        </section>

        {/* LOT trailer — creation only */}
        {!editId && (
          <section className="rounded-lg border border-blue-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  LOT Trailer
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  LOT trailers skip the fleet lookup. PTI newer than 7 days may skip re-verification.
                </p>
              </div>
              <Toggle
                id="lot-toggle"
                checked={isLot}
                onChange={(v) => {
                  setIsLot(v);
                  scheduleTelemetry(mcId, truckNumber, v);
                }}
                label="LOT Trailer"
              />
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
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{trailerError}</p>
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
        )}

        {/* PTI checklist — structured, checkboxes RIGHT of labels, no uploads */}
        <section className="rounded-lg border border-blue-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-1 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              PTI Verification
            </h2>
            {/* Master Select All */}
            <label className="flex cursor-pointer items-center gap-2 rounded border border-slate-300 px-3 py-1.5 text-sm font-semibold dark:border-slate-600">
              <CheckSquare className="h-4 w-4 text-brand-600" aria-hidden="true" />
              Select All
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(e) => setAllPti(e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
            </label>
          </div>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Not required to save — the ticket can wait in Carryover — but the full
            checklist gates QC review.
          </p>

          <div className="space-y-4">
            {PTI_SECTIONS.map((section) => (
              <div key={section.title}>
                <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-brand-600 dark:text-brand-300">
                  {section.title}
                </h3>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {section.rows.map((row) => (
                    <li
                      key={row.key ?? row.pair}
                      className="flex items-center justify-between gap-3 py-1.5 text-sm"
                    >
                      <span>
                        {row.label}
                        {row.optional && (
                          <span className="ml-1.5 text-xs text-slate-400">
                            (optional — both if working)
                          </span>
                        )}
                      </span>
                      {row.key ? (
                        <input
                          type="checkbox"
                          aria-label={row.label}
                          checked={Boolean(pti[row.key])}
                          onChange={(e) => setPtiKey(row.key!, e.target.checked)}
                          className="h-4 w-4 shrink-0 accent-brand-600"
                        />
                      ) : (
                        <span className="flex shrink-0 items-center gap-3">
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                            (Left)
                            <input
                              type="checkbox"
                              aria-label={`${row.label} (Left)`}
                              checked={Boolean(pti[`${row.pair}_left`])}
                              onChange={(e) => setPtiKey(`${row.pair}_left`, e.target.checked)}
                              className="h-4 w-4 accent-brand-600"
                            />
                          </label>
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                            (Right)
                            <input
                              type="checkbox"
                              aria-label={`${row.label} (Right)`}
                              checked={Boolean(pti[`${row.pair}_right`])}
                              onChange={(e) => setPtiKey(`${row.pair}_right`, e.target.checked)}
                              className="h-4 w-4 accent-brand-600"
                            />
                          </label>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p
            className={`mt-3 text-xs font-semibold ${
              ptiComplete
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            PTI status: {ptiComplete ? "VERIFIED" : "NOT VERIFIED"}
          </p>
        </section>

        {/* Documents & condition */}
        <section className="rounded-lg border border-blue-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Documents & Condition
          </h2>

          <label className="mb-3 flex cursor-pointer items-center gap-2.5 rounded border-2 border-amber-400 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200">
            <input
              type="checkbox"
              checked={caFlDestination}
              onChange={(e) => setCaFlDestination(e.target.checked)}
              className="h-5 w-5 accent-amber-600"
            />
            CA / FL destination
          </label>

          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            Inspection paper <span className="font-semibold">or</span> sticker — one of the
            two is enough.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
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
                checked={bolPresent}
                onChange={(e) => setBolPresent(e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              BOL present
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
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="weight" className="mb-1 block text-sm font-medium">
                Weight
              </label>
              <input
                id="weight"
                type="text"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="e.g. 34,500 lbs — or CRVR"
                className={`${inputCls} font-mono`}
              />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Type <span className="font-mono font-semibold">CRVR</span> to route to the
                scale queue automatically.
              </p>
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
            <div>
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

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting || (!editId && (!mcId || !truckNumber.trim()))}
            className="flex cursor-pointer items-center gap-2 rounded bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {editId ? "Save Changes" : "Create Ticket"}
          </button>
          {editId && (
            <button
              type="button"
              onClick={() => router.push("/dashboard/carryover")}
              className="cursor-pointer rounded border border-slate-300 px-5 py-2.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function TelemetryInput({
  icon: Icon,
  label,
  value,
  onChange,
  loading,
}: {
  icon: typeof User;
  label: string;
  value: string;
  onChange: (v: string) => void;
  loading: boolean;
}) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800/60">
      <label className="mb-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </label>
      {loading ? (
        <Skeleton className="h-6 w-full" />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-sm font-medium focus:border-slate-300 focus:bg-white focus:outline-none dark:focus:border-slate-600 dark:focus:bg-slate-900"
        />
      )}
    </div>
  );
}

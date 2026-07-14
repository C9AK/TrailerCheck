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
    <RequireRole roles={["employee", "qc", "manager"]}>
      <Suspense fallback={null}>
        <NewPickupForm />
      </Suspense>
    </RequireRole>
  );
}

function ScaleTicketBox({ truckFuelPct }: { truckFuelPct: number | null }) {
  const [weights, setWeights] = useState({ steer: 0, drive: 0, trailer: 0 });
  // Fuel follows the truck's live Samsara reading until the dispatcher types
  // their own value; a re-sync button restores the live feed.
  const [fuelPct, setFuelPct] = useState<number>(
    truckFuelPct != null ? Math.round(truckFuelPct) : 50
  );
  const [fuelManuallySet, setFuelManuallySet] = useState(false);
  const [kpraLocked, setKpraLocked] = useState(false);
  const [fwHoles, setFwHoles] = useState(0);
  const [tdHoles, setTdHoles] = useState(0);

  const fuelSynced = !fuelManuallySet && truckFuelPct != null;

  useEffect(() => {
    if (!fuelManuallySet && truckFuelPct != null) {
      setFuelPct(Math.round(truckFuelPct));
    }
  }, [truckFuelPct, fuelManuallySet]);

  const steerShift = fwHoles * 500;
  const trailerShift = tdHoles * 250;
  const driveShift = (fwHoles * -500) + (tdHoles * -250);

  const finalSteer = weights.steer + steerShift;
  const finalDrive = weights.drive + driveShift;
  const finalTrailer = weights.trailer + trailerShift;

  const limits = { steer: 12000, drive: 34000, trailer: 34000 };
  const MAX_FUEL_WEIGHT = 1400; 

  const getStatusColor = (weight: number, limit: number) => {
    if (weight === 0) return "text-white/20 border-white/10";
    if (weight > limit) return "text-[#FF0000] border-[#FF0000] animate-pulse";
    if (weight > limit - 1000) return "text-yellow-500 border-yellow-500";
    return "text-green-500 border-white/10";
  };

  const getActionPlan = () => {
      const { steer, drive, trailer } = weights;
      if (steer === 0 && drive === 0 && trailer === 0) return "Awaiting scale ticket data...";
      const total = steer + drive + trailer;
      if (total > 80000) return "🚨 GROSS OVERWEIGHT (>80k). Return to shipper to rework cargo.";
      
      const currentFuelWeight = (fuelPct / 100) * MAX_FUEL_WEIGHT;
      const missingFuelWeight = MAX_FUEL_WEIGHT - currentFuelWeight;
      let projectedDriveFullFuel = drive + missingFuelWeight;

      let plan = [];
      let curSteer = steer;
      let curDrive = drive;
      let curTrailer = trailer;

      if (curTrailer > limits.trailer) {
          if (kpraLocked) {
              return "🚨 KPRA LOCKED (California Hole #2 Limit): Cannot slide tandems backward to fix trailer weight. Cargo must be reworked.";
          }
          const over = curTrailer - limits.trailer;
          const holes = Math.ceil(over / 250);
          plan.push(`Slide Tandems BACKWARD ${holes} hole(s) (Shifts ~${holes*250}lbs to Drive)`);
          curTrailer -= (holes * 250);
          curDrive += (holes * 250);
          projectedDriveFullFuel += (holes * 250);
      }

      if (curSteer > limits.steer) {
          const over = curSteer - limits.steer;
          const holes = Math.ceil(over / 500);
          plan.push(`Slide 5th Wheel BACKWARD ${holes} hole(s) (Shifts ~${holes*500}lbs to Drive)`);
          curSteer -= (holes * 500);
          curDrive += (holes * 500);
          projectedDriveFullFuel += (holes * 500);
      }

      if (projectedDriveFullFuel > limits.drive) {
          let driveOver = projectedDriveFullFuel - limits.drive;
          let tandemHolesSlidForward = 0;

          if (curTrailer < limits.trailer && driveOver > 0) {
              const room = limits.trailer - curTrailer;
              const maxHoles = Math.floor(room / 250);
              const neededHoles = Math.ceil(driveOver / 250);

              if (maxHoles > 0) {
                  const holesToSlide = Math.min(neededHoles, maxHoles);
                  tandemHolesSlidForward = holesToSlide;
                  plan.push(`Slide Tandems FORWARD ${holesToSlide} hole(s) (Shifts ~${holesToSlide*250}lbs to Trailer)`);
                  curDrive -= (holesToSlide * 250);
                  curTrailer += (holesToSlide * 250);
                  projectedDriveFullFuel -= (holesToSlide * 250);
                  driveOver = projectedDriveFullFuel - limits.drive;
              }
          }

          if (curSteer < limits.steer && driveOver > 0) {
              const room = limits.steer - curSteer;
              const maxHoles = Math.floor(room / 500);
              const neededHoles = Math.ceil(driveOver / 500);

              if (maxHoles > 0) {
                  const holesToSlide = Math.min(neededHoles, maxHoles);
                  plan.push(`Slide 5th Wheel FORWARD ${holesToSlide} hole(s) (Shifts ~${holesToSlide*500}lbs to Steer)`);
                  curDrive -= (holesToSlide * 500);
                  curSteer += (holesToSlide * 500);
                  projectedDriveFullFuel -= (holesToSlide * 500);
              }
          }

          if (projectedDriveFullFuel > limits.drive) {
              if (curDrive > limits.drive) {
                  return plan.length > 0
                      ? plan.join("\n➔ ") + "\n\n🚨 FATAL: Even with slides, Drive is overweight at current fuel. Rework cargo."
                      : "🚨 FATAL: Drive is overweight and no safe slides are available. Rework cargo.";
              } else {
                  const maxAvailableFuelLbs = limits.drive - curDrive; 
                  const maxAllowedFuelLbsTotal = currentFuelWeight + maxAvailableFuelLbs;
                  const maxSafeFuelPct = Math.floor((maxAllowedFuelLbsTotal / MAX_FUEL_WEIGHT) * 100);

                  let reason = kpraLocked && tandemHolesSlidForward === 0
                      ? "Due to KPRA Lock,"
                      : "Adjacent axles are too tight to accept weight;";

                  return plan.join("\n➔ ") + `\n\n⛽️ ${reason} Restrict fuel to MAX ${maxSafeFuelPct}% to stay under 34k on Drive.`;
              }
          }
      }

      if (curDrive > limits.drive || curTrailer > limits.trailer || curSteer > limits.steer) {
          return plan.length > 0 ? plan.join("\n➔ ") + "\n\n🚨 WARNING: Still overweight after max safe slides. Rework required." : "🚨 Axles are overweight but adjacent axles cannot accept shifts. Rework cargo.";
      }

      let response = "✅ SOLUTION:\n";
      if (plan.length === 0) {
          response += "All axles legal as scaled.\n";
      } else {
          response += plan.join("\n➔ ") + "\n";
      }
      return response + "\n⛽️ Fuel Status: Safe to fill tanks to 100%.";
  };

  return (
    <div
      onKeyDown={(e) => {
        // The balancer lives inside the ticket <form> — Enter in its inputs
        // must not submit the whole pickup.
        if (e.key === "Enter") e.preventDefault();
      }}
      className="bg-[#0a0a0a]/90 backdrop-blur-sm p-6 border border-white/10 hover:border-blue-500 transition-all group relative overflow-hidden flex flex-col justify-between min-h-[480px] shadow-2xl rounded-lg mt-4"
    >
      <div className="absolute top-0 left-0 w-1 h-full bg-blue-500 scale-y-0 group-hover:scale-y-100 transition-transform origin-top"></div>
      <div className="flex justify-between items-start mb-4">
        <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">DOT Predictive Balancer</p>
        <div className="text-right">
           <span className={`text-[9px] font-black tracking-widest uppercase ${(finalSteer > limits.steer || finalDrive > limits.drive || finalTrailer > limits.trailer) ? 'text-[#FF0000] animate-pulse' : 'text-green-500'}`}>
             {(finalSteer > limits.steer || finalDrive > limits.drive || finalTrailer > limits.trailer) ? 'OVERWEIGHT' : 'LEGAL TO ROLL'}
           </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-white/50 uppercase font-black tracking-widest">Steer (&lt;12k)</span>
          <input type="number" value={weights.steer || ""} placeholder="LBS" onChange={e => setWeights({...weights, steer: Number(e.target.value) || 0})} className="bg-[#111] border border-white/20 p-2 text-white text-xs outline-none focus:border-blue-500 text-center font-mono placeholder:text-white/20" />
          <div className={`p-2 border font-mono text-center text-sm font-black ${getStatusColor(finalSteer, limits.steer)}`}>{finalSteer.toLocaleString()}</div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-white/50 uppercase font-black tracking-widest">Drive (&lt;34k)</span>
          <input type="number" value={weights.drive || ""} placeholder="LBS" onChange={e => setWeights({...weights, drive: Number(e.target.value) || 0})} className="bg-[#111] border border-white/20 p-2 text-white text-xs outline-none focus:border-blue-500 text-center font-mono placeholder:text-white/20" />
          <div className={`p-2 border font-mono text-center text-sm font-black ${getStatusColor(finalDrive, limits.drive)}`}>{finalDrive.toLocaleString()}</div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[9px] text-white/50 uppercase font-black tracking-widest">Trailer (&lt;34k)</span>
          <input type="number" value={weights.trailer || ""} placeholder="LBS" onChange={e => setWeights({...weights, trailer: Number(e.target.value) || 0})} className="bg-[#111] border border-white/20 p-2 text-white text-xs outline-none focus:border-blue-500 text-center font-mono placeholder:text-white/20" />
          <div className={`p-2 border font-mono text-center text-sm font-black ${getStatusColor(finalTrailer, limits.trailer)}`}>{finalTrailer.toLocaleString()}</div>
        </div>
      </div>

      <div className="flex gap-4 mb-3 border-b border-white/5 pb-3">
         <div className="flex-1 flex flex-col gap-1">
            <span className="flex items-center justify-between text-[9px] text-white/50 uppercase font-black tracking-widest">
              Current Fuel %
              {fuelSynced ? (
                <span className="flex items-center gap-1 text-green-500" title="Live from Samsara telemetry">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" aria-hidden="true" />
                  Truck
                </span>
              ) : truckFuelPct != null ? (
                <button
                  type="button"
                  onClick={() => {
                    setFuelManuallySet(false);
                    setFuelPct(Math.round(truckFuelPct));
                  }}
                  title={`Re-sync with the truck (${Math.round(truckFuelPct)}%)`}
                  className="cursor-pointer text-blue-500 underline hover:text-blue-400"
                >
                  Sync {Math.round(truckFuelPct)}%
                </button>
              ) : (
                <span className="text-white/30">Manual</span>
              )}
            </span>
            <input
              type="number"
              min="0"
              max="100"
              value={fuelPct}
              onChange={(e) => {
                setFuelPct(Math.min(100, Math.max(0, Number(e.target.value) || 0)));
                setFuelManuallySet(true);
              }}
              className={`bg-[#111] border p-2 text-white text-xs outline-none focus:border-blue-500 font-mono text-center ${
                fuelSynced ? "border-green-500/50" : "border-white/20"
              }`}
            />
         </div>
         <div className="flex-1 flex flex-col justify-center bg-[#111] border border-white/20 cursor-pointer hover:border-blue-500 transition-colors p-2" onClick={() => setKpraLocked(!kpraLocked)}>
             <span className={`text-[10px] font-black uppercase tracking-widest text-center leading-tight ${kpraLocked ? 'text-blue-500' : 'text-white/30'}`}>
                {kpraLocked ? '🔒 KPRA 40ft Maxed' : '🔓 KPRA Unlocked'}
             </span>
             <span className="text-[8px] text-center text-white/40 mt-1">California Hole #2</span>
         </div>
      </div>

      <div className="flex-grow flex flex-col justify-end gap-3">
         <div className="bg-[#111] p-3 border border-white/5">
            <div className="flex justify-between text-[9px] font-black uppercase text-white/40 mb-2">
               <span>5th Wheel Vis.</span>
               <span className="text-blue-500">{fwHoles > 0 ? `+${fwHoles} FWD` : fwHoles < 0 ? `${fwHoles} BCK` : '0'}</span>
            </div>
            <input type="range" min="-14" max="14" value={fwHoles} onChange={e => setFwHoles(Number(e.target.value))} className="w-full accent-blue-500" />
         </div>
         <div className="bg-[#111] p-3 border border-white/5">
            <div className="flex justify-between text-[9px] font-black uppercase text-white/40 mb-2">
               <span>Tandems Vis.</span>
               <span className="text-blue-500">{tdHoles > 0 ? `+${tdHoles} FWD` : tdHoles < 0 ? `${tdHoles} BCK` : '0'}</span>
            </div>
            <input type="range" min="-16" max="16" value={tdHoles} onChange={e => setTdHoles(Number(e.target.value))} className="w-full accent-blue-500" />
         </div>
         <div className="mt-2 bg-yellow-500/10 border border-yellow-500/50 p-4 min-h-[120px] overflow-y-auto">
            <p className="text-[9px] font-black text-yellow-500 uppercase tracking-widest mb-2 border-b border-yellow-500/20 pb-1">Dispatcher Action Plan</p>
            <p className="text-[11px] text-white font-mono leading-relaxed whitespace-pre-line">{getActionPlan()}</p>
         </div>
         <button type="button" onClick={() => { setWeights({steer: 0, drive: 0, trailer: 0}); setFwHoles(0); setTdHoles(0); setKpraLocked(false); setFuelManuallySet(false); setFuelPct(truckFuelPct != null ? Math.round(truckFuelPct) : 50); }} className="text-[9px] text-white/30 hover:text-white uppercase tracking-widest font-black underline mt-2 text-center transition-colors">
            Reset Data
         </button>
      </div>
    </div>
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
  const [isChassis, setIsChassis] = useState(false);
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

  const ptiComplete = isPtiComplete(pti, isChassis);
  const visibleSections = PTI_SECTIONS.filter((s) => !s.chassisOnly || isChassis);
  const visibleKeys = visibleSections.flatMap((s) =>
    s.rows.flatMap((r) => (r.key ? [r.key] : [`${r.pair}_left`, `${r.pair}_right`]))
  );
  const allChecked = visibleKeys.every((k) => pti[k]);

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
        setIsChassis(t.is_chassis);
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
      is_chassis: isChassis,
    };
    try {
      if (editId) {
        // R14: the MC is correctable on edit too (trailer identity stays fixed)
        await api<Ticket>(`/api/tickets/${editId}`, {
          method: "PATCH",
          body: JSON.stringify({ ...common, mc_id: mcId }),
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
      setIsChassis(false);
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

          {/* R12: chassis toggle — the Chassis section only applies (and is only
              required) when this is on */}
          <label className="mb-4 flex cursor-pointer items-center justify-between gap-3 rounded border-2 border-blue-200 bg-blue-50 px-3 py-2.5 dark:border-slate-600 dark:bg-slate-800">
            <span className="text-sm font-semibold">
              Is this a Chassis?
              <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                Adds the lock &amp; zip-tie checks to the required list
              </span>
            </span>
            <Toggle
              id="chassis-toggle"
              checked={isChassis}
              onChange={setIsChassis}
              label="Is this a Chassis?"
            />
          </label>

          <div className="space-y-4">
            {visibleSections.map((section) => (
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
                placeholder="e.g. 34,500 lbs or CRVR"
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

          {/* DOT Predictive Balancer — fuel auto-synced from the truck */}
          {needsScale && (
            <ScaleTicketBox
              truckFuelPct={
                Number.isFinite(parseFloat(fuelPct)) ? parseFloat(fuelPct) : null
              }
            />
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

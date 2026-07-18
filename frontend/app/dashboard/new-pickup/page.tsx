"use client";

import {
  CheckSquare,
  ClipboardPaste,
  ExternalLink,
  FileCheck2,
  FileClock,
  Fuel,
  Loader2,
  MapPin,
  Trash2,
  Truck,
  Upload,
  User,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner, Skeleton, SuccessBanner, Toggle } from "@/components/ui";
import { api, ApiError, mediaUrl, uploadTrailerDocument } from "@/lib/api";
import { emptyChecklist, PTI_SECTIONS, type PtiChecklist } from "@/lib/pti";
import type {
  MotorCarrier,
  Telemetry,
  Ticket,
  Trailer,
  TrailerCondition,
  TrailerDocType,
  TrailerDocument,
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

  // Trailer identity — R25: the trailer number is ALWAYS visible (papers
  // persist per trailer across pickups); the LOT toggle only adds the PTI
  // date logic on top. Prefilled from the embedded trailer record on edit.
  const [isLot, setIsLot] = useState(false);
  const [trailerNumber, setTrailerNumber] = useState("");
  const [lastPtiDate, setLastPtiDate] = useState("");
  const [trailerError, setTrailerError] = useState<string | null>(null);
  const [trailerLoading, setTrailerLoading] = useState(false);

  // R25: saved trailer papers (inspection/registration) — instant access
  const [savedDocs, setSavedDocs] = useState<TrailerDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docUploading, setDocUploading] = useState<TrailerDocType | null>(null);
  const docsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // R25b: clipboard paste — which paper slot is waiting for a Ctrl+V
  const [pasteArmed, setPasteArmed] = useState<TrailerDocType | null>(null);

  // R25: hazmat load — UGL does not haul hazmat; arms the movement monitor
  const [isHazmat, setIsHazmat] = useState(false);

  // Checklist
  const [pti, setPti] = useState<PtiChecklist>(emptyChecklist());
  // R18: the MASTER PTI checkbox — verification depends on this alone; the
  // granular checklist below is just a log of what the video showed.
  const [ptiMaster, setPtiMaster] = useState(false);
  const [isChassis, setIsChassis] = useState(false);
  const [registrationVerified, setRegistrationVerified] = useState(false);
  const [inspectionVerified, setInspectionVerified] = useState(false);
  const [stickerVerified, setStickerVerified] = useState(false);
  const [caFlDestination, setCaFlDestination] = useState(false);
  const [bolPresent, setBolPresent] = useState(false);
  // R17: extra checkout confirmations
  const [eldMentioned, setEldMentioned] = useState(false);
  const [checklistSent, setChecklistSent] = useState(false);
  const [weight, setWeight] = useState("");
  const [condition, setCondition] = useState<TrailerCondition>("Good");
  const [conditionNotes, setConditionNotes] = useState("");
  const [needsScale, setNeedsScale] = useState(false);
  const [scaleReceived, setScaleReceived] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // R17: state of the ticket loaded in edit mode (drives draft/redirect logic)
  const [loadedState, setLoadedState] = useState<Ticket["state"] | null>(null);

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
        setLoadedState(t.state);
        setMcId(t.mc_id);
        setTruckNumber(t.truck_number);
        setDriverName(t.driver_name ?? "");
        setTruckLocation(t.truck_location ?? "");
        setTruckModel(t.truck_model ?? "");
        setFuelPct(t.fuel_percentage != null ? String(t.fuel_percentage) : "");
        setCoords({ lat: t.truck_latitude, lon: t.truck_longitude });
        setIsLot(t.is_lot_trailer);
        // R21: trailer prefill — number + last PTI date come from the
        // embedded trailer record (any pickup since R25, not just LOT)
        setTrailerNumber(t.trailer?.trailer_number ?? "");
        setLastPtiDate(t.trailer ? toDateInputValue(t.trailer.last_pti_date) : "");
        if (t.trailer) checkSavedDocs(t.trailer.trailer_number);
        setIsHazmat(t.is_hazmat);
        setIsChassis(t.is_chassis);
        setPtiMaster(t.pti_verified);
        setPti({ ...emptyChecklist(), ...(t.pti_checklist ?? {}) });
        setRegistrationVerified(t.registration_verified);
        setInspectionVerified(t.inspection_paper_verified);
        setStickerVerified(t.sticker_verified);
        setCaFlDestination(t.is_ca_fl_destination);
        setBolPresent(t.bol_present);
        setEldMentioned(t.eld_mentioned);
        setChecklistSent(t.checklist_sent);
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

  // R25: probe for saved papers as soon as a trailer number is known —
  // debounced on typing, immediate on blur/prefill.
  const checkSavedDocs = useCallback(async (num: string) => {
    const trimmed = num.trim();
    if (!trimmed) {
      setSavedDocs([]);
      return;
    }
    setDocsLoading(true);
    try {
      setSavedDocs(
        await api<TrailerDocument[]>(
          `/api/trailers/${encodeURIComponent(trimmed)}/documents`
        )
      );
    } catch {
      setSavedDocs([]); // lookup is best-effort — never blocks the form
    } finally {
      setDocsLoading(false);
    }
  }, []);

  function scheduleDocsCheck(num: string) {
    if (docsTimer.current) clearTimeout(docsTimer.current);
    if (!num.trim()) {
      setSavedDocs([]);
      return;
    }
    docsTimer.current = setTimeout(() => checkSavedDocs(num), 600);
  }

  // R25: "Use Saved Papers" — tick the matching checklist boxes in one click
  function useSavedPapers() {
    if (savedDocs.some((d) => d.doc_type === "inspection")) setInspectionVerified(true);
    if (savedDocs.some((d) => d.doc_type === "registration")) setRegistrationVerified(true);
  }

  async function attachTrailerDoc(
    docType: TrailerDocType,
    source: File | { url: string } | null
  ) {
    if (!source || !trailerNumber.trim()) return;
    setDocUploading(docType);
    setError(null);
    try {
      const doc = await uploadTrailerDocument(trailerNumber, docType, source);
      setSavedDocs((prev) => [...prev.filter((d) => d.doc_type !== docType), doc]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the trailer paper.");
    } finally {
      setDocUploading(null);
    }
  }

  // R25b: paste a COPIED paper instead of uploading — a copied screenshot /
  // photo (image data) or a copied link both work. Clicking "Paste" first
  // tries the direct async clipboard API (https/localhost); where the
  // browser blocks that (plain-http LAN), it arms the slot and the document
  // -level Ctrl+V listener below finishes the job.
  async function armPaste(docType: TrailerDocType) {
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith("image/"));
          if (type) {
            const blob = await item.getType(type);
            const ext = type.split("/")[1] ?? "png";
            attachTrailerDoc(
              docType,
              new File([blob], `pasted-${Date.now()}.${ext}`, { type })
            );
            return;
          }
        }
        const text = (await navigator.clipboard.readText()).trim();
        if (/^https?:\/\//i.test(text)) {
          attachTrailerDoc(docType, { url: text });
          return;
        }
      }
    } catch {
      /* clipboard read blocked — fall through to armed Ctrl+V mode */
    }
    setPasteArmed(docType);
  }

  useEffect(() => {
    if (!pasteArmed) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const fileItem = items.find(
        (i) =>
          i.kind === "file" &&
          (i.type.startsWith("image/") || i.type === "application/pdf")
      );
      const file = fileItem?.getAsFile() ?? null;
      const text = (e.clipboardData?.getData("text") ?? "").trim();
      if (file) {
        e.preventDefault();
        attachTrailerDoc(pasteArmed, file);
      } else if (/^https?:\/\//i.test(text)) {
        e.preventDefault();
        attachTrailerDoc(pasteArmed, { url: text });
      } else {
        setError(
          "Clipboard has no image or link — copy the paper (screenshot/photo or URL) first, then paste again."
        );
      }
      setPasteArmed(null);
    };
    document.addEventListener("paste", onPaste);
    // Auto-disarm so a forgotten armed slot doesn't swallow a later Ctrl+V
    const timer = setTimeout(() => setPasteArmed(null), 20_000);
    return () => {
      document.removeEventListener("paste", onPaste);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteArmed]);

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

  function commonPayload() {
    return {
      truck_number: truckNumber.trim(),
      // R21/R25: trailer identity on every pickup — an empty string
      // explicitly unlinks the trailer on edit
      is_lot_trailer: isLot,
      trailer_number: trailerNumber.trim(),
      last_pti_date_override: isLot && lastPtiDate ? `${lastPtiDate}T00:00:00Z` : null,
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
      eld_mentioned: eldMentioned,
      checklist_sent: checklistSent,
      weight: weight.trim() || null,
      trailer_condition: condition,
      condition_notes: conditionNotes || null,
      needs_scale: needsScale,
      scale_ticket_received: needsScale ? scaleReceived : false,
      pti_checklist: pti,
      pti_verified: ptiMaster,
      is_chassis: isChassis,
      is_hazmat: isHazmat,
    };
  }

  function createPayload() {
    return {
      ...commonPayload(),
      mc_id: mcId,
    };
  }

  function resetForm() {
    setTruckNumber("");
    setDriverName("");
    setTruckLocation("");
    setTruckModel("");
    setFuelPct("");
    setCoords({ lat: null, lon: null });
    setIsLot(false);
    setTrailerNumber("");
    setLastPtiDate("");
    setSavedDocs([]);
    setIsHazmat(false);
    setPti(emptyChecklist());
    setPtiMaster(false);
    setIsChassis(false);
    setRegistrationVerified(false);
    setInspectionVerified(false);
    setStickerVerified(false);
    setCaFlDestination(false);
    setBolPresent(false);
    setEldMentioned(false);
    setChecklistSent(false);
    setWeight("");
    setCondition("Good");
    setConditionNotes("");
    setNeedsScale(false);
    setScaleReceived(false);
    setLoadedState(null);
  }

  // R17 "Still Sending": park the ticket as a draft and clear the form so the
  // dispatcher can start the next concurrent pickup immediately.
  async function saveDraft() {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      if (editId) {
        await api<Ticket>(`/api/tickets/${editId}`, {
          method: "PATCH",
          body: JSON.stringify({ ...commonPayload(), mc_id: mcId, still_sending: true }),
        });
        resetForm();
        router.replace("/dashboard/new-pickup");
      } else {
        await api<Ticket>("/api/tickets", {
          method: "POST",
          body: JSON.stringify({ ...createPayload(), still_sending: true }),
        });
        resetForm();
      }
      setSuccess(
        "Draft saved (Still Sending) — resume it anytime from Active Drafts in the sidebar."
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the draft.");
    } finally {
      setSubmitting(false);
    }
  }

  // R20: discard a parked draft outright — load canceled, no longer needed
  async function discardDraft() {
    if (!editId) return;
    if (!window.confirm("Discard this draft permanently? This cannot be undone.")) return;
    setSubmitting(true);
    setError(null);
    try {
      await api<void>(`/api/tickets/${editId}`, { method: "DELETE" });
      router.push("/dashboard/carryover");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not discard the draft.");
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      if (editId) {
        // R14: the MC is correctable on edit too (trailer identity stays
        // fixed). still_sending:false graduates a parked draft on submit.
        await api<Ticket>(`/api/tickets/${editId}`, {
          method: "PATCH",
          body: JSON.stringify({ ...commonPayload(), mc_id: mcId, still_sending: false }),
        });
        // Approved tickets edited from history don't live on the carryover board
        router.push(
          loadedState === "APPROVED" ? "/dashboard/my-pickups" : "/dashboard/carryover"
        );
        return;
      }
      const ticket = await api<Ticket>("/api/tickets", {
        method: "POST",
        body: JSON.stringify(createPayload()),
      });
      setSuccess(
        ticket.state === "PENDING_QC"
          ? "Ticket created — complete, sent to QC review."
          : "Ticket created — saved to Carryover (awaiting driver/scale ticket)."
      );
      // Reset for the next pickup
      resetForm();
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

        {/* Trailer & saved papers — R25: the trailer number is ALWAYS visible
            so inspection/registration papers persist across pickups; the LOT
            toggle adds the 7-day PTI logic on top */}
        <section className="rounded-lg border border-blue-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Trailer &amp; Papers
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enter the trailer number to pull its saved papers — they persist
                between pickups so nothing is re-uploaded.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                LOT Trailer
              </span>
              <Toggle
                id="lot-toggle"
                checked={isLot}
                onChange={(v) => {
                  setIsLot(v);
                  scheduleTelemetry(mcId, truckNumber, v);
                  if (v) lookupTrailer();
                }}
                label="LOT Trailer"
              />
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="trailer-number" className="mb-1 block text-sm font-medium">
                Trailer Number{" "}
                {isLot ? (
                  <span className="text-red-600">*</span>
                ) : (
                  <span className="text-xs font-normal text-slate-500">(optional)</span>
                )}
              </label>
              <input
                id="trailer-number"
                required={isLot}
                value={trailerNumber}
                onChange={(e) => {
                  setTrailerNumber(e.target.value);
                  scheduleDocsCheck(e.target.value);
                }}
                onBlur={() => {
                  checkSavedDocs(trailerNumber);
                  if (isLot) lookupTrailer();
                }}
                placeholder={isLot ? "e.g. LOT-1001" : "e.g. 53182"}
                className={`${inputCls} font-mono`}
              />
              {trailerError && isLot && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{trailerError}</p>
              )}
            </div>
            {isLot && (
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
                      : `PTI is ${ptiAgeDays} day(s) old — the master PTI checkbox is required.`}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* R25: saved papers panel — instant access when the trailer returns */}
          {trailerNumber.trim() && (
            <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                Saved papers for {trailerNumber.trim()}
                {docsLoading && (
                  <Loader2 className="h-3 w-3 animate-spin text-slate-400" aria-hidden="true" />
                )}
              </p>
              {savedDocs.length > 0 ? (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {savedDocs.map((d) => (
                      <a
                        key={d.id}
                        href={mediaUrl(d.media_url)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
                        title={`Open the saved ${d.doc_type} paper`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        View {d.doc_type === "inspection" ? "Inspection" : "Registration"}
                      </a>
                    ))}
                    <button
                      type="button"
                      onClick={useSavedPapers}
                      className="flex cursor-pointer items-center gap-1.5 rounded bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-brand-700"
                      title="Mark the matching checklist boxes as verified using the saved papers"
                    >
                      <CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />
                      Use Saved Papers
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Papers on file from a previous pickup — no re-upload needed.
                  </p>
                </>
              ) : (
                !docsLoading && (
                  <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
                    No papers on file yet — save them once and they&apos;ll attach
                    automatically the next time this trailer comes in.
                  </p>
                )
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {(["inspection", "registration"] as TrailerDocType[]).map((docType) => {
                  const existing = savedDocs.some((d) => d.doc_type === docType);
                  const docLabel = docType === "inspection" ? "Inspection" : "Registration";
                  return (
                    <span key={docType} className="flex items-center gap-1">
                      <label className="flex cursor-pointer items-center gap-1.5 rounded border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-white dark:border-slate-600 dark:hover:bg-slate-700">
                        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                        {docUploading === docType
                          ? "Saving…"
                          : `${existing ? "Replace" : "Save"} ${docLabel} paper`}
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          disabled={docUploading !== null}
                          onChange={(e) => {
                            attachTrailerDoc(docType, e.target.files?.[0] ?? null);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {/* R25b: paste a copied image or link instead of uploading */}
                      <button
                        type="button"
                        disabled={docUploading !== null}
                        onClick={() =>
                          pasteArmed === docType ? setPasteArmed(null) : armPaste(docType)
                        }
                        title={`Paste a copied image or link as the ${docLabel} paper`}
                        className={`flex cursor-pointer items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 disabled:opacity-40 ${
                          pasteArmed === docType
                            ? "animate-pulse border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
                            : "border-slate-300 hover:bg-white dark:border-slate-600 dark:hover:bg-slate-700"
                        }`}
                      >
                        <ClipboardPaste className="h-3.5 w-3.5" aria-hidden="true" />
                        {pasteArmed === docType ? "Press Ctrl+V now…" : "Paste"}
                      </button>
                    </span>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                Paste works with a copied screenshot/photo of the paper or a copied
                link — click Paste, then Ctrl+V if it doesn&apos;t attach immediately.
              </p>
            </div>
          )}
        </section>

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
            The master PTI box below is what gates QC review. The item list is a
            log of what you saw in the video — it never blocks verification.
          </p>

          {/* R18: MASTER PTI checkbox — verification depends on this alone */}
          <label className="mb-3 flex cursor-pointer items-center justify-between gap-3 rounded border-2 border-brand-600 bg-brand-50 px-3 py-3 dark:border-brand-500 dark:bg-brand-950/30">
            <span className="text-sm font-bold">
              PTI
              <span className="ml-2 text-xs font-normal text-slate-600 dark:text-slate-300">
                Master verification — this box alone marks PTI as done
              </span>
            </span>
            <input
              type="checkbox"
              aria-label="PTI verified (master)"
              checked={ptiMaster}
              onChange={(e) => setPtiMaster(e.target.checked)}
              className="h-5 w-5 shrink-0 accent-brand-600"
            />
          </label>

          {/* R12: chassis toggle — shows the chassis rows in the video log
              (informational since R18) */}
          <label className="mb-4 flex cursor-pointer items-center justify-between gap-3 rounded border-2 border-blue-200 bg-blue-50 px-3 py-2.5 dark:border-slate-600 dark:bg-slate-800">
            <span className="text-sm font-semibold">
              Is this a Chassis?
              <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                Shows the lock &amp; zip-tie rows in the log below
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
              ptiMaster
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            PTI status: {ptiMaster ? "VERIFIED" : "NOT VERIFIED"} (master checkbox)
            {" · "}video log: {Object.values(pti).filter(Boolean).length} item(s) noted
          </p>
        </section>

        {/* Documents & condition */}
        <section className="rounded-lg border border-blue-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Documents & Condition
          </h2>

          {/* R25: hazmat toggle — on AND off (load can be re-classified).
              While on + active, the Samsara watch alerts everyone on movement. */}
          <label
            className={`mb-3 flex cursor-pointer items-center justify-between gap-3 rounded border-2 px-3 py-2.5 transition-colors duration-150 ${
              isHazmat
                ? "border-orange-500 bg-orange-50 dark:border-orange-600 dark:bg-orange-950/40"
                : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"
            }`}
          >
            <span
              className={`text-sm font-bold ${
                isHazmat
                  ? "text-orange-800 dark:text-orange-300"
                  : "text-slate-700 dark:text-slate-300"
              }`}
            >
              ☣ Hazmat load
              <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                UGL does NOT haul hazmat — while on, the truck is movement-watched
                and any motion alerts the whole team instantly
              </span>
            </span>
            <Toggle
              id="hazmat-toggle"
              checked={isHazmat}
              onChange={setIsHazmat}
              label="Hazmat load"
            />
          </label>

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
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={eldMentioned}
                onChange={(e) => setEldMentioned(e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              ELD mentioned
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={checklistSent}
                onChange={(e) => setChecklistSent(e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              Checklist sent
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

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={submitting || (!editId && (!mcId || !truckNumber.trim()))}
            className="flex cursor-pointer items-center gap-2 rounded bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {editId
              ? loadedState === "DRAFT_IN_PROGRESS"
                ? "Submit Ticket"
                : "Save Changes"
              : "Create Ticket"}
          </button>
          {/* R17: park the pickup while the driver is still sending papers —
              available on create, and while resuming an existing draft */}
          {(!editId || loadedState === "DRAFT_IN_PROGRESS") && (
            <button
              type="button"
              disabled={submitting || !mcId || !truckNumber.trim()}
              onClick={saveDraft}
              className="flex cursor-pointer items-center gap-2 rounded border-2 border-sky-500 px-5 py-2.5 text-sm font-semibold text-sky-700 transition-colors duration-150 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-sky-300 dark:hover:bg-sky-950/40"
            >
              <FileClock className="h-4 w-4" aria-hidden="true" />
              Save Draft (Still Sending)
            </button>
          )}
          {/* R20: discard a parked draft outright — load canceled, no need
              to keep cluttering Active Drafts or Carryover */}
          {editId && loadedState === "DRAFT_IN_PROGRESS" && (
            <button
              type="button"
              disabled={submitting}
              onClick={discardDraft}
              className="flex cursor-pointer items-center gap-2 rounded border-2 border-red-300 px-5 py-2.5 text-sm font-semibold text-red-700 transition-colors duration-150 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Discard Draft
            </button>
          )}
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

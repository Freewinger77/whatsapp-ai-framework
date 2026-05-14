import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { CheckCircle2Icon, PlusIcon, QrCodeIcon, XIcon } from "lucide-react";
import { INSTANCES, REGION_OPTIONS } from "@/polymet/data/dashboard-data";
import { instanceGradient } from "@/polymet/data/instance-colors";
import { cn } from "@/lib/utils";

const REGION_SLOT_COUNTS: Record<(typeof REGION_OPTIONS)[number], number> = {
  Finland: 4,
  Sweden: 3,
  "UK South": 2,
  "UK West": 5,
  Germany: 1,
  France: 3,
};

export function InstancesPage() {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-8">
      <div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Instances</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live WhatsApp numbers, regional proxies, webhooks, and pairing state.
          </p>
        </div>
      </div>

      <div className="grid min-h-[calc(100vh-18rem)] grid-cols-1 content-start gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {INSTANCES.map((inst) => (
          <Link
            key={inst.id}
            to={`/instances/${inst.id}`}
            className="group text-left"
          >
            <div
              className="relative aspect-square w-full overflow-hidden rounded-2xl border border-border/40 shadow-sm transition-all duration-300 ease-out will-change-transform group-hover:-translate-y-1 group-hover:shadow-xl group-hover:brightness-110"
              style={{
                background: instanceGradient(inst.id),
              }}
            >
              <div className="absolute left-5 top-4 text-2xl font-semibold text-white/95 transition-transform duration-300 group-hover:translate-x-0.5">
                {inst.name}
              </div>
              <div className="absolute bottom-4 left-5 right-5 flex items-center justify-between text-white/90">
                <span className="rounded-full bg-black/20 px-3 py-1 text-xs backdrop-blur">
                  {inst.region}
                </span>
                <span className="rounded-full bg-black/20 px-3 py-1 text-xs capitalize backdrop-blur">
                  {inst.status === "quality-warning" ? "⚠ " : ""}
                  {inst.status.replace("-", " ")}
                </span>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold">{inst.name}</div>
                <div className="text-sm text-muted-foreground">{inst.phone}</div>
              </div>
              <span
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  inst.status === "active" && "bg-emerald-500",
                  inst.status === "quality-warning" && "bg-amber-500",
                  inst.status === "provisioning" && "bg-blue-500",
                  inst.status === "offline" && "bg-zinc-400"
                )}
              />
            </div>
          </Link>
        ))}

        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="group text-left"
        >
          <div className="flex aspect-square w-full items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 transition-all duration-300 ease-out group-hover:-translate-y-1 group-hover:bg-muted/60 group-hover:border-foreground/30">
            <PlusIcon
              className="h-10 w-10 text-muted-foreground transition-transform duration-300 group-hover:scale-110 group-hover:rotate-90"
              strokeWidth={1.5}
            />
          </div>
          <div className="mt-3 text-base font-semibold">Add another instance</div>
          <div className="text-sm text-muted-foreground">&nbsp;</div>
        </button>
      </div>

      {createOpen &&
        createPortal(
          <CreateInstanceModal onClose={() => setCreateOpen(false)} />,
          document.body,
        )}
    </div>
  );
}

function CreateInstanceModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"form" | "created">("form");
  const [selectedRegion, setSelectedRegion] =
    useState<(typeof REGION_OPTIONS)[number]>("Finland");
  const availableSlots = REGION_SLOT_COUNTS[selectedRegion];

  return (
    <div className="fixed inset-0 z-[100] flex h-screen w-screen items-center justify-center bg-black/45 p-4 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-background p-6 shadow-2xl animate-pop-in">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              {step === "form" ? "Create WhatsApp instance" : "Instance desired state created"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {step === "form"
                ? "Name it, attach your webhook, and choose a region. Billing/proxy checks happen before worker deploy."
                : "This is the mock handoff state before the real Azure worker starts and returns QR."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {step === "form" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Instance name">
                <input
                  defaultValue="Wasup Support"
                  className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                />
              </Field>
              <Field label="Region">
                <select
                  value={selectedRegion}
                  onChange={(event) =>
                    setSelectedRegion(
                      event.target.value as (typeof REGION_OPTIONS)[number],
                    )
                  }
                  className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                >
                  {REGION_OPTIONS.map((region) => (
                    <option key={region}>{region}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Webhook URL">
              <input
                defaultValue="https://n8n.wasup.ai/webhook/customer-support"
                className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
              />
            </Field>
            <div className="rounded-xl border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <CheckCircle2Icon className="h-4 w-4 text-emerald-600" />
                  Paid slot available
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/70 bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 shadow-sm">
                  <span className="grid h-4 w-4 place-items-center rounded-full bg-amber-400 shadow-inner">
                    <span className="h-2 w-2 rounded-full border border-amber-100/90" />
                  </span>
                  1
                </span>
              </div>
              <p className="mt-1">
                {selectedRegion} has {availableSlots} paid{" "}
                {availableSlots === 1 ? "slot" : "slots"} available. Creating
                this instance will use one credit/slot.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStep("created")}
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
              >
                Create instance
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-card p-4">
              <div className="grid h-20 w-20 place-items-center rounded-xl bg-muted">
                <QrCodeIcon className="h-9 w-9 text-muted-foreground" />
              </div>
              <div>
                <div className="font-semibold">QR linking will appear here</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Once the worker comes online, the detail page shows QR/pairing code and live socket status.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

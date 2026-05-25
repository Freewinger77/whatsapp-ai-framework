import { useEffect, useState } from "react";
import { CheckIcon, UploadIcon } from "lucide-react";
import { REGION_OPTIONS } from "@/polymet/data/dashboard-data";
import { importProxyPool, listProxyPool, regionLabelToCode } from "@/polymet/lib/control-plane-api";

export function PlatformProxyPoolPanel() {
  const [region, setRegion] = useState<(typeof REGION_OPTIONS)[number]>("Finland");
  const [proxyText, setProxyText] = useState("");
  const [proxies, setProxies] = useState<
    Array<{
      id: string;
      label: string | null;
      host: string;
      port: number;
      status: string;
      credential: string;
      instance_id: string | null;
      region_code: string;
    }>
  >([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const regionCode = regionLabelToCode(region);

  const refreshProxies = async () => {
    try {
      const result = await listProxyPool(regionCode);
      setProxies(result.proxies);
    } catch {
      setProxies([]);
    }
  };

  useEffect(() => {
    void refreshProxies();
  }, [regionCode]);

  const submitProxies = async () => {
    setLoading(true);
    setMessage("");
    try {
      const result = await importProxyPool({
        regionCode,
        proxies: proxyText,
        providerName: "Webshare",
        labelPrefix: `webshare-${regionCode}`,
      });
      setMessage(
        `Imported ${result.imported} proxies${result.parseErrors.length ? ` with ${result.parseErrors.length} skipped lines` : ""}.`,
      );
      setProxyText("");
      await refreshProxies();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import proxies");
    } finally {
      setLoading(false);
    }
  };

  const freeCount = proxies.filter((proxy) => proxy.status === "free").length;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/60 bg-card px-4 sm:px-5">
        <div className="flex flex-col gap-3 border-b border-border/60 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium">Region</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Imported proxies are only offered to instances in the matching hosting zone.
            </p>
          </div>
          <select
            value={region}
            onChange={(event) => setRegion(event.target.value as (typeof REGION_OPTIONS)[number])}
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none sm:w-auto"
          >
            {REGION_OPTIONS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>

        <div className="border-b border-border/60 py-5">
          <div className="mb-2 text-sm font-medium">Add Webshare proxies</div>
          <p className="mb-3 text-xs text-muted-foreground">
            Paste one per line as `host:port:user:pass`, `host:port`, or a full proxy URL.
          </p>
          <textarea
            value={proxyText}
            onChange={(event) => setProxyText(event.target.value)}
            placeholder="proxy.example.com:8080:username:password"
            className="min-h-28 w-full rounded-xl border border-border/60 bg-background p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/30"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{message}</span>
            <button
              type="button"
              onClick={submitProxies}
              disabled={loading || !proxyText.trim()}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <CheckIcon className="h-3.5 w-3.5" /> : <UploadIcon className="h-3.5 w-3.5" />}
              {loading ? "Importing" : "Import proxies"}
            </button>
          </div>
        </div>

        <div className="py-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">{region} pool</div>
              <p className="text-xs text-muted-foreground">
                {freeCount} free of {proxies.length} imported proxies in this region.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refreshProxies()}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
            >
              Refresh
            </button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Host</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Assignment</th>
                </tr>
              </thead>
              <tbody>
                {proxies.map((proxy) => (
                  <tr key={proxy.id} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-2 font-mono">
                      {proxy.host}:{proxy.port}
                    </td>
                    <td className="px-3 py-2 capitalize">{proxy.status}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {proxy.instance_id ? `Instance ${proxy.instance_id.slice(0, 8)}…` : "Unassigned"}
                    </td>
                  </tr>
                ))}
                {!proxies.length && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                      No proxies imported for {region} yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

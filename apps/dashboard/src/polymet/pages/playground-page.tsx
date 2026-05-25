import { useEffect, useState } from "react";
import { WorkerToolsPanel } from "@/polymet/components/worker-tools-panel";
import { getConnection } from "@/polymet/lib/control-plane-api";
import { getWorkerBaseUrl, getWorkerLinks, isWorkerReady } from "@/polymet/lib/worker-links";

export function PlaygroundPage() {
  const [state, setState] = useState({
    links: getWorkerLinks(""),
    status: "loading",
    progressMessage: "",
    ready: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof window.setInterval> | undefined;

    const load = () => {
      getConnection()
        .then((connection) => {
          if (cancelled) return;
          const baseUrl = getWorkerBaseUrl(connection);
          const provisioning = ["queued", "provisioning", "dns_pending"].includes(connection.deployment.status);
          setState({
            links: getWorkerLinks(baseUrl),
            status: connection.deployment.status,
            progressMessage: connection.deployment.progress?.message || connection.deployment.progress?.label || "",
            ready: isWorkerReady(connection),
            loading: false,
          });

          if (provisioning && !pollTimer) {
            pollTimer = window.setInterval(load, 5000);
          } else if (!provisioning && pollTimer) {
            window.clearInterval(pollTimer);
            pollTimer = undefined;
          }
        })
        .catch(() => {
          if (!cancelled) {
            setState({
              links: getWorkerLinks(""),
              status: "unavailable",
              progressMessage: "Could not load workspace connection details.",
              ready: false,
              loading: false,
            });
          }
        });
    };

    load();

    return () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, []);

  return (
    <WorkerToolsPanel
      title="Playground"
      subtitle="Open the worker test console on your workspace URL — the same interactive playground used on wasup-dev and wasup2."
      links={state.links}
      ready={state.ready}
      loading={state.loading}
      status={state.status}
      progressMessage={state.progressMessage}
    />
  );
}

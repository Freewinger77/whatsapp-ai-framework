import { useEffect, useState } from "react";
import { WorkerToolsPanel } from "@/polymet/components/worker-tools-panel";
import { getConnection } from "@/polymet/lib/control-plane-api";
import { getWorkerBaseUrl, getWorkerLinks, isWorkerReady } from "@/polymet/lib/worker-links";

export function DocsPage() {
  const [state, setState] = useState({
    links: getWorkerLinks(""),
    status: "loading",
    progressMessage: "",
    ready: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    getConnection()
      .then((connection) => {
        if (cancelled) return;
        const baseUrl = getWorkerBaseUrl(connection);
        setState({
          links: getWorkerLinks(baseUrl),
          status: connection.deployment.status,
          progressMessage: connection.deployment.progress?.message || connection.deployment.progress?.label || "",
          ready: isWorkerReady(connection),
          loading: false,
        });
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

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <WorkerToolsPanel
      title="Worker tools"
      subtitle="Docs, test console, and admin for your provisioned workspace — all on your own wasup.co URL."
      links={state.links}
      ready={state.ready}
      loading={state.loading}
      status={state.status}
      progressMessage={state.progressMessage}
    />
  );
}

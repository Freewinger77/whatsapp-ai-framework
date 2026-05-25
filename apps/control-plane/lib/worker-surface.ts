export type WorkerSurfaceCheck = {
  ok: boolean;
  testOk: boolean;
  docsOk: boolean;
  testStatus: number | null;
  docsStatus: number | null;
  error?: string;
};

export async function checkWorkerSurfaceMarkers(baseUrl: string | null | undefined): Promise<WorkerSurfaceCheck> {
  if (!baseUrl) {
    return {
      ok: false,
      testOk: false,
      docsOk: false,
      testStatus: null,
      docsStatus: null,
      error: 'missing_base_url'
    };
  }

  const origin = baseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const [testRes, docsRes] = await Promise.all([
      fetch(`${origin}/test`, { signal: controller.signal, headers: { Accept: 'text/html' } }),
      fetch(`${origin}/docs`, { signal: controller.signal, headers: { Accept: 'text/html' } })
    ]);

    const [testBody, docsBody] = await Promise.all([testRes.text(), docsRes.text()]);
    const testOk = testRes.ok && /interactive-message-playground|sendReaction/i.test(testBody);
    const docsOk = docsRes.ok && /createApiReference|Scalar/i.test(docsBody);

    return {
      ok: testOk && docsOk,
      testOk,
      docsOk,
      testStatus: testRes.status,
      docsStatus: docsRes.status
    };
  } catch (error) {
    return {
      ok: false,
      testOk: false,
      docsOk: false,
      testStatus: null,
      docsStatus: null,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

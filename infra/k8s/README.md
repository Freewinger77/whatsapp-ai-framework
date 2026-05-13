# Wasup v3 Kubernetes Scaffold

This directory is an additive scaffold for the proposed Wasup v3 SaaS data plane. It is not wired into production and should not be applied to a live cluster without the Phase 1 app changes described in `docs/WASUP_V3_SAAS_K8S_PLAN.md`.

Current contents:

- `wasup-worker/`: placeholder Helm chart for a future per-instance WhatsApp worker.

Important assumptions before this can run:

- The app image exists and includes the current `app/` server.
- The app supports `WASUP_DATA_DIR` for auth/state persistence.
- The app supports single-instance worker mode, or the chart is changed to run a per-org worker.
- Secrets are supplied by External Secrets or another secret manager, not committed to Git.

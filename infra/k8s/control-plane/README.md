# Wasup v3 Control Plane on AKS

The control plane is the central SaaS app: dashboard, org/customer metadata, API keys, provisioning, billing hooks, and proxy inventory.

Recommended Azure resources:

- Azure Kubernetes Service for worker pods.
- Azure Container Registry for app images.
- Azure Key Vault for provider credentials, worker shared secrets, and proxy secrets.
- External Secrets Operator to sync Key Vault entries into per-org namespaces.
- Supabase for relational state.
- Clerk for auth/org membership.

## Deployment Shape

The control plane can run as:

1. Azure Container Apps for the first SaaS dashboard/API.
2. AKS deployment once worker provisioning is automated.

Keep it separate from worker pods. Reloading the control plane must not touch WhatsApp sockets.

## Required Environment

See `apps/control-plane/.env.example`.

## First Production Principle

Use the control plane to create desired state in Supabase. A provisioner reconciles that desired state into AKS resources. Avoid synchronous dashboard actions that directly mutate Kubernetes without a persisted audit trail.

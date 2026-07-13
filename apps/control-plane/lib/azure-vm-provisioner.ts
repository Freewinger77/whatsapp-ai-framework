import { randomBytes } from 'node:crypto';
import { DefaultAzureCredential } from '@azure/identity';
import { ComputeManagementClient } from '@azure/arm-compute';
import { NetworkManagementClient } from '@azure/arm-network';
import { ResourceManagementClient } from '@azure/arm-resources';
import { DeploymentsClient } from '@azure/arm-resourcesdeployments';
import { getServerEnv } from './env';

type ProvisionInput = {
  org: {
    id: string;
    slug: string;
    name: string;
  };
  deployment: {
    id: string;
    azure_resource_group?: string | null;
    azure_region?: string | null;
    vm_name?: string | null;
    vm_size?: string | null;
    base_url?: string | null;
    fqdn?: string | null;
  };
};

export async function startAzureVmProvisioning(input: ProvisionInput) {
  const env = getServerEnv();
  if (!env.AZURE_SUBSCRIPTION_ID) throw new Error('AZURE_SUBSCRIPTION_ID is required');
  if (!env.AZURE_SSH_PUBLIC_KEY) throw new Error('AZURE_SSH_PUBLIC_KEY is required');
  if (!process.env.WASUP_WORKER_SHARED_SECRET) throw new Error('WASUP_WORKER_SHARED_SECRET is required');

  const resourceGroup = input.deployment.azure_resource_group || `${env.AZURE_RESOURCE_GROUP_PREFIX}-${input.org.slug}`;
  const location = input.deployment.azure_region || env.AZURE_LOCATION;
  const vmName = input.deployment.vm_name || stableVmName(input.org.slug);
  const fqdn = input.deployment.fqdn || new URL(input.deployment.base_url || `https://${input.org.slug}.${env.WASUP_BASE_DOMAIN}`).hostname;

  const credential = new DefaultAzureCredential();
  const resources = new ResourceManagementClient(credential, env.AZURE_SUBSCRIPTION_ID);
  const deployments = new DeploymentsClient(credential, env.AZURE_SUBSCRIPTION_ID);

  await resources.resourceGroups.createOrUpdate(resourceGroup, { location });
  const deploymentName = `wasup-worker-${input.deployment.id.slice(0, 8)}`;
  const poller = await deployments.deployments.beginCreateOrUpdate(resourceGroup, deploymentName, {
    properties: {
      mode: 'Incremental',
      template: buildWorkerTemplate({
        location,
        vmName,
        vmSize: input.deployment.vm_size || env.AZURE_VM_SIZE,
        osDiskGb: env.AZURE_VM_OS_DISK_GB,
        adminUsername: env.AZURE_VM_ADMIN_USERNAME,
        sshPublicKey: env.AZURE_SSH_PUBLIC_KEY,
        fqdn,
        orgId: input.org.id,
        workerSecret: process.env.WASUP_WORKER_SHARED_SECRET,
        controlPlaneUrl: env.WASUP_CONTROL_PLANE_URL,
        dashboardUrl: env.WASUP_DASHBOARD_URL,
        workerGitRepo: env.WASUP_WORKER_GIT_REPO,
        workerGitRef: env.WASUP_WORKER_GIT_REF
      }),
      parameters: {}
    }
  });

  return {
    accepted: true,
    operationState: poller.getOperationState().status,
    resourceGroup,
    vmName,
    fqdn,
    deploymentName
  };
}

export async function reconcileAzureVmDeployment(input: {
  resourceGroup: string;
  vmName: string;
}) {
  const env = getServerEnv();
  if (!env.AZURE_SUBSCRIPTION_ID) throw new Error('AZURE_SUBSCRIPTION_ID is required');

  const credential = new DefaultAzureCredential();
  const compute = new ComputeManagementClient(credential, env.AZURE_SUBSCRIPTION_ID);
  const network = new NetworkManagementClient(credential, env.AZURE_SUBSCRIPTION_ID);

  const vm = await compute.virtualMachines.get(input.resourceGroup, input.vmName, { expand: 'instanceView' });
  const statuses = vm.instanceView?.statuses ?? [];
  const isReady = statuses.some((status) => status.code === 'PowerState/running');
  const publicIp = await network.publicIPAddresses.get(input.resourceGroup, `${input.vmName}-pip`);

  return {
    ready: isReady && Boolean(publicIp.ipAddress),
    publicIp: publicIp.ipAddress || null,
    statuses: statuses.map((status) => ({ code: status.code, displayStatus: status.displayStatus })),
    fqdn: publicIp.dnsSettings?.fqdn || null
  };
}

export async function deleteAzureVmResourceGroup(resourceGroup: string) {
  const env = getServerEnv();
  if (!env.AZURE_SUBSCRIPTION_ID) throw new Error('AZURE_SUBSCRIPTION_ID is required');

  const resources = new ResourceManagementClient(new DefaultAzureCredential(), env.AZURE_SUBSCRIPTION_ID);
  const poller = await resources.resourceGroups.beginDelete(resourceGroup);
  return { accepted: true, operationState: poller.getOperationState().status, resourceGroup };
}

export async function standardizeWorkerRuntime(input: {
  resourceGroup: string;
  vmName: string;
  workerGitRepo: string;
  workerGitRef: string;
}) {
  const env = getServerEnv();
  if (!env.AZURE_SUBSCRIPTION_ID) throw new Error('AZURE_SUBSCRIPTION_ID is required');

  const credential = new DefaultAzureCredential();
  const compute = new ComputeManagementClient(credential, env.AZURE_SUBSCRIPTION_ID);
  const script = buildWorkerStandardizeScript(input.workerGitRepo, input.workerGitRef);

  const poller = await compute.virtualMachines.beginRunCommand(
    input.resourceGroup,
    input.vmName,
    {
      commandId: 'RunShellScript',
      script: [script]
    }
  );

  const result = await poller.pollUntilDone();
  const message = result.value?.[0]?.message || '';
  const testOk = /test:ok|interactive-message-playground/i.test(message);
  const docsOk = /docs:ok|createApiReference/i.test(message);

  return {
    accepted: true,
    succeeded: testOk && docsOk,
    testOk,
    docsOk,
    message: message.slice(0, 4000)
  };
}

function buildWorkerStandardizeScript(workerGitRepo: string, workerGitRef: string) {
  const repo = shellQuote(workerGitRepo);
  const ref = shellQuote(workerGitRef);
  return `#!/bin/bash
set -eu
APP_DIR=$(ls -d /opt/wasup-*/app 2>/dev/null | head -1 || true)
if [ -z "$APP_DIR" ] && [ -d /opt/whatsapp-ai/app ]; then APP_DIR=/opt/whatsapp-ai/app; fi
if [ -z "$APP_DIR" ]; then echo "worker-app-missing"; exit 1; fi
TMP=$(mktemp -d)
git clone --depth 1 --branch ${ref} ${repo} "$TMP"
rsync -a --delete \
  --exclude node_modules \
  --exclude instances \
  --exclude logs \
  --exclude auth \
  --exclude .env \
  "$TMP/app/" "$APP_DIR/"
rm -rf "$TMP"
if [ -f /opt/wasup-worker.env ]; then
  grep -q '^DOCS_REVEAL_PASSWORD=' /opt/wasup-worker.env || echo 'DOCS_REVEAL_PASSWORD=Wasup@123' >> /opt/wasup-worker.env
  grep -q '^ALLOW_PUBLIC_DASHBOARD=' /opt/wasup-worker.env || echo 'ALLOW_PUBLIC_DASHBOARD=true' >> /opt/wasup-worker.env
  grep -q '^WASUP_DASHBOARD_URL=' /opt/wasup-worker.env || echo 'WASUP_DASHBOARD_URL=https://dev.wasup.co' >> /opt/wasup-worker.env
  cp /opt/wasup-worker.env "$APP_DIR/.env"
fi
cd "$APP_DIR"
npm install --omit=dev --legacy-peer-deps --ignore-scripts
# Keep Baileys on the tctoken/reachout RC line for every newly standardized org worker.
npm install baileys@7.0.0-rc13 --save-exact --omit=dev --legacy-peer-deps --ignore-scripts
node scripts/patch-baileys.js || true
node -e "console.log('baileys', require('./node_modules/baileys/package.json').version)"
pm2 reload wasup-worker || pm2 restart wasup-worker || pm2 start server.js --name wasup-worker
sleep 4
TEST_BODY=$(curl -sf http://127.0.0.1:3000/test || true)
DOCS_BODY=$(curl -sf http://127.0.0.1:3000/docs || true)
echo "$TEST_BODY" | grep -q interactive-message-playground && echo test:ok || echo test:missing-markers
echo "$DOCS_BODY" | grep -q createApiReference && echo docs:ok || echo docs:missing-markers
`.trim();
}

function buildWorkerTemplate(input: {
  location: string;
  vmName: string;
  vmSize: string;
  osDiskGb: number;
  adminUsername: string;
  sshPublicKey: string;
  fqdn: string;
  orgId: string;
  workerSecret: string;
  controlPlaneUrl?: string;
  dashboardUrl?: string;
  workerGitRepo: string;
  workerGitRef: string;
}) {
  const vnetName = `${input.vmName}-vnet`;
  const subnetName = 'default';
  const nsgName = `${input.vmName}-nsg`;
  const pipName = `${input.vmName}-pip`;
  const nicName = `${input.vmName}-nic`;

  return {
    $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
    contentVersion: '1.0.0.0',
    resources: [
      {
        type: 'Microsoft.Network/networkSecurityGroups',
        apiVersion: '2023-09-01',
        name: nsgName,
        location: input.location,
        properties: {
          securityRules: [
            inboundRule('AllowHttp', 100, '80'),
            inboundRule('AllowHttps', 110, '443'),
            inboundRule('AllowSsh', 120, '22')
          ]
        }
      },
      {
        type: 'Microsoft.Network/publicIPAddresses',
        apiVersion: '2023-09-01',
        name: pipName,
        location: input.location,
        sku: { name: 'Standard' },
        properties: {
          publicIPAllocationMethod: 'Static'
        }
      },
      {
        type: 'Microsoft.Network/virtualNetworks',
        apiVersion: '2023-09-01',
        name: vnetName,
        location: input.location,
        dependsOn: [resourceId('Microsoft.Network/networkSecurityGroups', nsgName)],
        properties: {
          addressSpace: { addressPrefixes: ['10.42.0.0/16'] },
          subnets: [
            {
              name: subnetName,
              properties: {
                addressPrefix: '10.42.1.0/24',
                networkSecurityGroup: {
                  id: resourceId('Microsoft.Network/networkSecurityGroups', nsgName)
                }
              }
            }
          ]
        }
      },
      {
        type: 'Microsoft.Network/networkInterfaces',
        apiVersion: '2023-09-01',
        name: nicName,
        location: input.location,
        dependsOn: [
          resourceId('Microsoft.Network/virtualNetworks', vnetName),
          resourceId('Microsoft.Network/publicIPAddresses', pipName)
        ],
        properties: {
          ipConfigurations: [
            {
              name: 'ipconfig1',
              properties: {
                privateIPAllocationMethod: 'Dynamic',
                subnet: {
                  id: `[resourceId('Microsoft.Network/virtualNetworks/subnets', '${vnetName}', '${subnetName}')]`
                },
                publicIPAddress: {
                  id: resourceId('Microsoft.Network/publicIPAddresses', pipName)
                }
              }
            }
          ]
        }
      },
      {
        type: 'Microsoft.Compute/virtualMachines',
        apiVersion: '2023-09-01',
        name: input.vmName,
        location: input.location,
        dependsOn: [resourceId('Microsoft.Network/networkInterfaces', nicName)],
        properties: {
          hardwareProfile: { vmSize: input.vmSize },
          storageProfile: {
            imageReference: {
              publisher: 'Canonical',
              offer: '0001-com-ubuntu-server-jammy',
              sku: '22_04-lts-gen2',
              version: 'latest'
            },
            osDisk: {
              createOption: 'FromImage',
              diskSizeGB: input.osDiskGb,
              managedDisk: { storageAccountType: 'Premium_LRS' }
            }
          },
          osProfile: {
            computerName: input.vmName,
            adminUsername: input.adminUsername,
            customData: Buffer.from(buildCloudInit(input)).toString('base64'),
            linuxConfiguration: {
              disablePasswordAuthentication: true,
              ssh: {
                publicKeys: [
                  {
                    path: `/home/${input.adminUsername}/.ssh/authorized_keys`,
                    keyData: input.sshPublicKey
                  }
                ]
              }
            }
          },
          networkProfile: {
            networkInterfaces: [
              {
                id: resourceId('Microsoft.Network/networkInterfaces', nicName),
                properties: { primary: true }
              }
            ]
          }
        }
      }
    ]
  };
}

function buildCloudInit(input: {
  fqdn: string;
  orgId: string;
  workerSecret: string;
  controlPlaneUrl?: string;
  dashboardUrl?: string;
  workerGitRepo: string;
  workerGitRef: string;
}) {
  const installId = randomBytes(6).toString('hex');
  const runcmd = [
    'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -',
    'apt-get install -y nodejs debian-keyring debian-archive-keyring apt-transport-https',
    'npm install -g pm2',
    `mkdir -p /opt/wasup-${installId}`,
    `git clone --depth 1 --branch ${shellQuote(input.workerGitRef)} ${shellQuote(input.workerGitRepo)} /opt/wasup-${installId}`,
    `cd /opt/wasup-${installId}/app && (npm ci --omit=dev --legacy-peer-deps || npm install --omit=dev --legacy-peer-deps)`,
    `cd /opt/wasup-${installId}/app && npm install baileys@7.0.0-rc13 --save-exact --omit=dev --legacy-peer-deps --ignore-scripts && node scripts/patch-baileys.js || true`,
    `cp /opt/wasup-worker.env /opt/wasup-${installId}/app/.env`,
    // Prefer reply-first; operators can set WASUP_BLOCK_COLD_WITHOUT_TOKEN=true after warm traffic is proven.
    `grep -q '^WASUP_BLOCK_COLD_WITHOUT_TOKEN=' /opt/wasup-${installId}/app/.env || echo 'WASUP_BLOCK_COLD_WITHOUT_TOKEN=false' >> /opt/wasup-${installId}/app/.env`,
    `pm2 start /opt/wasup-${installId}/app/server.js --name wasup-worker --cwd /opt/wasup-${installId}/app`,
    'pm2 startup systemd -u root --hp /root || true',
    'pm2 save',
    'curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg',
    'curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list',
    'apt-get update',
    'DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Options::=--force-confold caddy',
    'install -m 0644 /tmp/wasup-Caddyfile /etc/caddy/Caddyfile',
    'systemctl reload caddy || systemctl restart caddy',
    `curl -fsS --retry 10 --retry-delay 3 -H "X-API-Key: ${input.workerSecret}" http://127.0.0.1:3000/api/health >/tmp/wasup-worker-health.json`
  ]
    .map((command) => `  - ${yamlSingleQuote(command)}`)
    .join('\n');

  return `#cloud-config
package_update: true
packages:
  - ca-certificates
  - curl
  - git
  - gnupg
write_files:
  - path: /tmp/wasup-Caddyfile
    content: |
      ${input.fqdn} {
        reverse_proxy 127.0.0.1:3000
      }
  - path: /opt/wasup-worker.env
    permissions: '0600'
    content: |
      PORT=3000
      API_KEY=${input.workerSecret}
      ADMIN_PASSWORD=${input.workerSecret}
      WASUP_WORKER_SHARED_SECRET=${input.workerSecret}
      WASUP_CONTROL_PLANE_URL=${input.controlPlaneUrl || 'https://control-plane.wasup.co'}
      WASUP_ORG_ID=${input.orgId}
      WASUP_DASHBOARD_URL=${input.dashboardUrl || 'https://dev.wasup.co'}
      DOCS_REVEAL_PASSWORD=Wasup@123
      ALLOW_PUBLIC_DASHBOARD=true
      NODE_ENV=production
runcmd:
${runcmd}
`;
}

function inboundRule(name: string, priority: number, destinationPortRange: string) {
  return {
    name,
    properties: {
      priority,
      direction: 'Inbound',
      access: 'Allow',
      protocol: 'Tcp',
      sourcePortRange: '*',
      destinationPortRange,
      sourceAddressPrefix: '*',
      destinationAddressPrefix: '*'
    }
  };
}

function resourceId(type: string, ...names: string[]) {
  return `[resourceId('${type}', ${names.map((name) => `'${name}'`).join(', ')})]`;
}

function stableVmName(slug: string) {
  return `wasup-${slug}`.replace(/[^a-z0-9-]/g, '-').slice(0, 48);
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function yamlSingleQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

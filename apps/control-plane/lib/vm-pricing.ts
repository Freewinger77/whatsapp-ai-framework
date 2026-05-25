const VM_COMPUTE_USD_PER_MONTH: Record<string, number> = {
  Standard_B1s: 7.59,
  Standard_B1ms: 15.18,
  Standard_B2s: 30.37,
  Standard_B2ms: 60.74,
  Standard_B4ms: 121.47,
  Standard_D2s_v3: 70.08,
  Standard_D2s_v5: 70.08
};

const DISK_USD_PER_GB_MONTH = 0.17;
const PUBLIC_IP_USD_PER_MONTH = 3.65;

export function estimateVmMonthlyUsd(input: {
  vmSize?: string | null;
  osDiskGb?: number | null;
  includePublicIp?: boolean;
}) {
  const vmSize = input.vmSize || 'Standard_B2s';
  const osDiskGb = input.osDiskGb ?? 64;
  const compute = VM_COMPUTE_USD_PER_MONTH[vmSize] ?? VM_COMPUTE_USD_PER_MONTH.Standard_B2s;
  const disk = osDiskGb * DISK_USD_PER_GB_MONTH;
  const ip = input.includePublicIp === false ? 0 : PUBLIC_IP_USD_PER_MONTH;
  const total = compute + disk + ip;

  return {
    vmSize,
    osDiskGb,
    computeUsd: roundUsd(compute),
    diskUsd: roundUsd(disk),
    publicIpUsd: roundUsd(ip),
    totalUsd: roundUsd(total)
  };
}

function roundUsd(value: number) {
  return Math.round(value * 100) / 100;
}

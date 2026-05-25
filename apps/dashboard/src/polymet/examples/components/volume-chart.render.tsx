import { VolumeChart } from "@/polymet/components/volume-chart";
import { VOLUME_SERIES } from "@/polymet/data/dashboard-data";

export default function VolumeChartRender() {
  return (
    <div className="p-6">
      <VolumeChart data={VOLUME_SERIES} />
    </div>
  );
}

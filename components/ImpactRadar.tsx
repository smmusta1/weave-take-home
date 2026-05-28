"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";

export function ImpactRadar({
  output,
  leverage,
  durability,
}: {
  output: number;
  leverage: number;
  durability: number;
}) {
  const data = [
    { axis: "Output", value: output },
    { axis: "Leverage", value: leverage },
    { axis: "Durability", value: durability },
  ];
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="75%">
          <PolarGrid stroke="#e5e5e5" />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11 }} />
          <Radar dataKey="value" stroke="#171717" fill="#171717" fillOpacity={0.18} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

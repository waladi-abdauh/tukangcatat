"use client";

// Bar chart tren 12 bulan: pengeluaran (terracotta) vs "berhasil dijaga"
// (teal lembut) — stacked, tinggi bar = budget bulan itu.
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatIDR, formatIDRCompact } from "../../lib/utils";
import type { MonthlyTrendPoint } from "../../lib/dash/data";

interface MonthlyTrendChartProps {
  data: MonthlyTrendPoint[];
}

export default function MonthlyTrendChart({ data }: MonthlyTrendChartProps) {
  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Chart muncul setelah bulan catatan pertamamu ✍️
      </p>
    );
  }

  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            tickFormatter={(v) => formatIDRCompact(Number(v))}
            tickLine={false}
            axisLine={false}
            width={48}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            formatter={(value, name) => [
              formatIDR(Number(value ?? 0)),
              String(name),
            ]}
          />
          <Bar
            dataKey="spent"
            stackId="t"
            name="Pengeluaran"
            fill="var(--brand)"
          />
          <Bar
            dataKey="kept"
            stackId="t"
            name="Berhasil dijaga"
            fill="var(--chart-3)"
            fillOpacity={0.45}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
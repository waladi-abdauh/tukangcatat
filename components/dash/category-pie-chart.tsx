"use client";

// Pie chart komposisi pengeluaran per kategori (Recharts).
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { formatIDR } from "../../lib/utils";

export interface PieDatum {
  category: string;
  amount: number;
}

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#94a3b8",
  "#a78bfa",
  "#f472b6",
];

interface CategoryPieChartProps {
  data: PieDatum[];
}

export default function CategoryPieChart({ data }: CategoryPieChartProps) {
  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Belum ada catatan bulan ini.
      </p>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="category"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((entry, index) => (
              <Cell key={entry.category} fill={PALETTE[index % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) =>
              formatIDR(typeof value === "number" ? value : Number(value ?? 0))
            }
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
// Marker: garis bawah goresan spidol (SVG bergelombang, warna brand) di bawah
// kata/frasa, animasi digambar sekali saat load. Server-safe, tanpa JS.
import type { ReactNode } from "react";

export function Marker({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`marker ${className}`}>
      {children}
      <svg
        className="marker-stroke"
        viewBox="0 0 100 14"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          pathLength={100}
          d="M 0 6 C 12.5 11 18.75 2.5 25 6 C 31.25 10 37.5 2.5 43.75 6 C 50 9 56.25 2.5 62.5 6 C 68.75 10 75 3 81.25 6 C 87.5 9.5 93.75 4 100 6.5"
        />
      </svg>
    </span>
  );
}
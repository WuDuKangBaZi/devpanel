import { useId } from "react";

interface AppLogoProps {
  className?: string;
}

export function AppLogo({ className = "h-5 w-5" }: AppLogoProps) {
  const uid = useId().replace(/:/g, "");
  const bgId = `dp-logo-bg-${uid}`;
  const chevronId = `dp-logo-chevron-${uid}`;
  const barId = `dp-logo-bar-${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient
          id={bgId}
          x1="48"
          y1="32"
          x2="464"
          y2="480"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#13203A" />
          <stop offset="100%" stopColor="#060B16" />
        </linearGradient>
        <linearGradient
          id={chevronId}
          x1="112"
          y1="184"
          x2="248"
          y2="372"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#4ADE80" />
          <stop offset="100%" stopColor="#16A34A" />
        </linearGradient>
        <linearGradient
          id={barId}
          x1="256"
          y1="216"
          x2="404"
          y2="216"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#22C55E" />
        </linearGradient>
      </defs>
      <rect x="20" y="20" width="472" height="472" rx="112" fill={`url(#${bgId})`} />
      <rect
        x="24"
        y="24"
        width="464"
        height="464"
        rx="108"
        stroke="#334155"
        strokeWidth="10"
      />
      <path d="M24 132H488" stroke="#24344D" strokeWidth="8" />
      <circle cx="98" cy="82" r="14" fill="#22C55E" />
      <circle cx="144" cy="82" r="14" fill="#F59E0B" />
      <circle cx="190" cy="82" r="14" fill="#38BDF8" />
      <path
        d="M108 202L216 286L108 370"
        stroke={`url(#${chevronId})`}
        strokeWidth="40"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="256" y="204" width="148" height="32" rx="16" fill={`url(#${barId})`} />
      <rect x="256" y="270" width="114" height="32" rx="16" fill="#38BDF8" />
      <rect x="256" y="336" width="148" height="32" rx="16" fill="#64748B" />
    </svg>
  );
}

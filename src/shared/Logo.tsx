import React from 'react'

interface LogoProps {
  size?: number
}

export default function Logo({ size = 28 }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 128 128"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="pp-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#15803d" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="24" fill="url(#pp-bg)" />
      <polygon points="80,14 40,70 64,70 48,114 88,58 64,58" fill="white" />
    </svg>
  )
}

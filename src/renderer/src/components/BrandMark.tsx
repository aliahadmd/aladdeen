interface BrandMarkProps {
  className?: string
  title?: string
}

export function BrandMark({ className = '', title }: BrandMarkProps): React.JSX.Element {
  return (
    <svg
      className={`brand-logo ${className}`.trim()}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="2" y="2" width="60" height="60" rx="16" fill="#09090b" />
      <path
        d="M33 21c-4-3.2 2.6-5.5-.5-9C30.9 9.6 32 6.7 36 4"
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <g fill="#fff">
        <path d="m44 10 0.85 2.15L47 13l-2.15.85L44 16l-.85-2.15L41 13l2.15-.85L44 10Z" />
        <path
          fillRule="evenodd"
          d="M43 29h4.5C55.2 29 60 33.1 60 38s-4.8 9-12.5 9H41v-5h6.5c4.5 0 7.5-1.7 7.5-4s-3-4-7.5-4H43v-5Z"
        />
        <path d="M24 27h20a3 3 0 0 1 3 3v1H21v-1a3 3 0 0 1 3-3Z" />
        <rect x="30" y="23" width="9" height="4" rx="2" />
        <path d="M23 32c-5.8.2-10.5-1.5-16-5l-4-3 1.2 5.2C5.8 36.5 11 41 19 41h7l-3-9Z" />
        <path d="M20 31h28v4.5C48 43 42 48 33 48s-15-5-15-12.5V33c0-1.1.9-2 2-2Z" />
        <path d="M26 46h14a3 3 0 0 1 3 3v2H23v-2a3 3 0 0 1 3-3Z" />
      </g>
    </svg>
  )
}

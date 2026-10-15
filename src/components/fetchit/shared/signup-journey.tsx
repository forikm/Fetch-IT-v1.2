import styles from "./signup-places.module.css";

/** All artwork shares one viewBox, including the route endpoints and pin anchors. */
export function SignupJourney({ step }: { step: number }) {
  return <div className={styles.scene} data-step={step} aria-hidden="true">
    <svg viewBox="0 0 480 320" fill="none" className={styles.map}>
      <rect x="22" y="24" width="436" height="272" rx="42" fill="#e4ecdf" />
      <path d="M44 184C118 151 93 57 189 27M280 293C286 243 413 259 457 194" stroke="#cbdcc5" strokeWidth="36" strokeLinecap="round" />
      <g fill="#d3e0cd">
        <rect x="213" y="44" width="62" height="45" rx="12" />
        <rect x="309" y="61" width="102" height="35" rx="12" />
        <rect x="72" y="235" width="77" height="29" rx="10" />
        <rect x="180" y="248" width="58" height="27" rx="10" />
      </g>
      <path d="M23 211H166Q193 211 193 184V147Q193 120 220 120H458" stroke="#f8f7f2" strokeWidth="30" />
      <path d="M123 24V94Q123 120 150 120H220M348 122V295" stroke="#f8f7f2" strokeWidth="22" />
      <path d="M23 211H166Q193 211 193 184V147Q193 120 220 120H458" stroke="#c6d1c0" strokeDasharray="2 9" strokeLinecap="round" />
      <path d="M123 188V211H166Q193 211 193 184V147Q193 120 220 120H348" stroke="#183b33" strokeWidth="4" strokeLinecap="round" opacity=".12" />
      <path key={step} className={styles.route} pathLength="1" d="M123 188V211H166Q193 211 193 184V147Q193 120 220 120H348" stroke="#bd4c1d" strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="123" cy="190" rx="45" ry="9" fill="#183b33" opacity=".1" />
      <g className={styles.house}>
        <path d="M89 144V182Q89 188 95 188H151Q157 188 157 182V144L123 116L89 144Z" fill="#fffdf7" stroke="#183b33" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M80 149L123 113L166 149" stroke="#bd4c1d" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M116 188V161H132V188" fill="#d6e2d0" stroke="#183b33" strokeWidth="2" />
        <rect x="98" y="153" width="11" height="12" rx="2" fill="#f1cc90" />
        <rect x="139" y="153" width="10" height="12" rx="2" fill="#f1cc90" />
        <path d="M146 126V114H155V134" fill="#bd4c1d" />
      </g>
      <g className={styles.destination}>
        <ellipse cx="348" cy="121" rx="22" ry="5" fill="#183b33" opacity=".13" />
        <path d="M348 119C348 119 325 96 325 80C325 67 335 57 348 57C361 57 371 67 371 80C371 96 348 119 348 119Z" fill="#183b33" stroke="#fffdf7" strokeWidth="4" />
        <circle cx="348" cy="80" r="8" fill="#f1cc90" />
      </g>
      <g stroke="#8ca889" strokeWidth="3" strokeLinecap="round">
        <path d="M64 102V119M58 108H70M404 214V231M398 221H410" />
      </g>
      <circle cx="62" cy="91" r="11" fill="#afc5a7" /><circle cx="404" cy="203" r="11" fill="#afc5a7" />
      <g className={styles.homeLabel}>
        <rect x="70" y="62" width="106" height="32" rx="16" fill="#fffdf7" />
        <circle cx="88" cy="78" r="4" fill="#bd4c1d" />
        <text x="132" y="82" fill="#183b33" textAnchor="middle" fontSize="11" fontWeight="600">Your home</text>
      </g>
      <g className={styles.placeLabel}>
        <rect x="286" y="146" width="124" height="32" rx="16" fill="#fffdf7" />
        <circle cx="304" cy="162" r="4" fill="#183b33" />
        <text x="356" y="166" fill="#183b33" textAnchor="middle" fontSize="11" fontWeight="600">Your usual stop</text>
      </g>
      {step === 2 && <g className={styles.check}>
        <circle cx="240" cy="220" r="25" fill="#183b33" stroke="#f8f7f2" strokeWidth="5" />
        <path d="M230 220L237 227L251 213" stroke="#fffdf7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </g>}
    </svg>
  </div>;
}

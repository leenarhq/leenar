/**
 * The Leenar mark, for the console and the auth pages.
 *
 * Height-driven: set a height and the width follows the 576:726 ratio.
 * Inherits colour from `currentColor`.
 *
 * `components/marketing/LogoMark.tsx` is the same glyph, byte for byte. It
 * stays a separate copy on purpose: the marketing/console import boundary in
 * DESIGN.md is hard in both directions, and one shared file would be the
 * first thing to breach it. Two copies of a static path is the cheaper price.
 */
export function LogoMark({ className = "h-4 w-auto" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="16 16 576 726"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g transform="translate(0,978) scale(0.1,-0.1)">
        <path d="M3015 9548 c-38 -17 -135 -60 -215 -95 -146 -66 -282 -126 -575 -255 -88 -39 -187 -83 -220 -98 -33 -15 -134 -60 -225 -100 -91 -40 -179 -84 -196 -96 -69 -53 -53 7 -385 -1364 -55 -228 -125 -516 -155 -640 -30 -124 -71 -295 -90 -380 -19 -85 -77 -328 -129 -540 -227 -922 -275 -1123 -275 -1141 0 -10 -33 -155 -74 -321 -41 -167 -115 -471 -165 -675 -98 -399 -114 -504 -101 -640 30 -297 170 -527 396 -651 533 -292 1501 -149 2115 313 86 64 80 64 193 25 519 -175 1352 -199 1985 -56 533 121 710 270 797 673 30 144 131 603 143 658 111 486 -13 843 -389 1119 -288 212 -816 293 -1238 191 -410 -100 -840 -367 -1146 -714 -117 -132 -294 -362 -443 -574 -69 -97 -128 -179 -132 -181 -20 -13 -551 246 -551 269 0 1 16 63 34 136 19 74 58 249 86 389 28 140 57 280 65 310 8 30 55 235 105 455 50 220 102 448 116 508 29 120 -15 50 374 602 151 215 776 1114 888 1278 40 59 87 137 104 173 54 115 47 133 -262 759 -117 237 -241 490 -276 563 -35 74 -69 132 -76 131 -7 -1 -44 -15 -83 -31z m1406 -4958 c83 -96 184 -213 223 -260 39 -47 102 -121 140 -165 39 -44 76 -88 84 -97 14 -16 9 -20 -54 -49 -317 -142 -884 -254 -1202 -237 l-62 3 92 135 c237 345 607 852 618 848 4 -2 77 -82 161 -178z m-3243 -793 c156 -133 277 -218 563 -400 75 -48 143 -89 153 -93 27 -10 19 -22 -36 -54 -267 -153 -668 -176 -806 -47 -62 57 -101 199 -82 298 10 52 111 369 118 369 2 0 43 -33 90 -73z" />
      </g>
    </svg>
  );
}

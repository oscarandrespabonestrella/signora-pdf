import type { SignatureAsset } from 'signora-pdf';
import { rasterizeToAsset } from 'signora-pdf/ui';

/**
 * Example of an organization signature catalog. In a real application these
 * would come from your API (return them from the `assets` loader). They are
 * built here from inline SVG so the playground has no binary assets.
 */
const CATALOG = [
  {
    id: 'acme-approved',
    label: 'Approved stamp',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120">
      <rect x="6" y="6" width="308" height="108" rx="14" fill="none" stroke="#2b8a3e" stroke-width="6"/>
      <text x="160" y="62" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="42" fill="#2b8a3e">APPROVED</text>
      <text x="160" y="94" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#2b8a3e">Acme Corp · Legal</text>
    </svg>`,
  },
  {
    id: 'acme-logo',
    label: 'Acme logo',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="92" fill="#3b5bdb"/>
      <path d="M52 140 L100 44 L148 140 L128 140 L100 84 L72 140 Z" fill="#fff"/>
      <rect x="76" y="112" width="48" height="12" fill="#fff"/>
    </svg>`,
  },
  {
    id: 'acme-cfo',
    label: 'Jane Roe, CFO',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="130" viewBox="0 0 360 130">
      <text x="14" y="70" font-family="'Segoe Script','Brush Script MT',cursive" font-size="56" fill="#1b1f3b">Jane Roe</text>
      <line x1="14" y1="86" x2="346" y2="86" stroke="#1b1f3b" stroke-width="2"/>
      <text x="14" y="112" font-family="Arial, sans-serif" font-size="16" fill="#5b6475">Chief Financial Officer · Acme Corp</text>
    </svg>`,
  },
] as const;

export function loadAcmeSignatures(): Promise<readonly SignatureAsset[]> {
  return Promise.all(
    CATALOG.map((entry) =>
      rasterizeToAsset(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(entry.svg)}`, {
        id: entry.id,
        kind: 'organization',
        label: entry.label,
      }),
    ),
  );
}

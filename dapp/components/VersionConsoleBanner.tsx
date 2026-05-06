'use client';

import { useEffect, useRef } from 'react';

/**
 * Print a readable version banner to the browser console once per page
 * load. Lets developers and curious users confirm exactly which dApp
 * bundle they're looking at — without us having to plaster version info
 * across the UI.
 *
 * Mirrors the build-identifier banner the CLI participant prints on
 * startup (`cli/commands/participant.js`), so a session that spans CLI +
 * dApp can be diagnosed by comparing the two banners.
 */
export function VersionConsoleBanner() {
  // Module-level dedupe across HMR / route changes — printed once per
  // tab session.
  const printedRef = useRef(false);

  useEffect(() => {
    if (printedRef.current) return;
    printedRef.current = true;
    if (typeof window === 'undefined') return;

    const version = process.env.NEXT_PUBLIC_DAPP_VERSION || 'dev';
    const buildTime = process.env.NEXT_PUBLIC_DAPP_BUILD_TIME || 'unknown';

    console.log(
      `%cHedera MultiSig dApp%c v${version}`,
      'color:#3b82f6;font-weight:bold;font-size:14px',
      'color:inherit;font-weight:normal;font-size:14px'
    );
    console.log(
      `%cBuild:%c ${buildTime}`,
      'color:#6b7280',
      'color:inherit;font-family:monospace'
    );
    console.log(
      `%cSource:%c https://github.com/lazysuperheroes/hedera-multisig`,
      'color:#6b7280',
      'color:inherit'
    );
  }, []);

  return null;
}

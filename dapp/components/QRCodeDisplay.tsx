/**
 * QR Code Display Component
 *
 * Reusable component for displaying QR codes with optional styling and download.
 * Used for sharing session connection strings and other shareable data.
 */

'use client';

import { useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface QRCodeDisplayProps {
  /** The data to encode in the QR code */
  value: string;
  /** Size of the QR code in pixels (default: 200) */
  size?: number;
  /** Optional title above the QR code */
  title?: string;
  /** Optional description below the QR code */
  description?: string;
  /** Show download button */
  showDownload?: boolean;
  /** Filename for download (without extension) */
  downloadFilename?: string;
  /** Additional class names */
  className?: string;
  /** Background color */
  bgColor?: string;
  /** Foreground color */
  fgColor?: string;
  /** Error correction level */
  level?: 'L' | 'M' | 'Q' | 'H';
}

export function QRCodeDisplay({
  value,
  size = 200,
  title,
  description,
  showDownload = false,
  downloadFilename = 'qrcode',
  className = '',
  bgColor = '#FFFFFF',
  fgColor = '#000000',
  level = 'M',
}: QRCodeDisplayProps) {
  const qrRef = useRef<HTMLDivElement>(null);

  const handleDownload = useCallback(() => {
    if (!qrRef.current) return;

    const svg = qrRef.current.querySelector('svg');
    if (!svg) return;

    // Create a canvas to convert SVG to PNG
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size with padding
    const padding = 20;
    canvas.width = size + padding * 2;
    canvas.height = size + padding * 2;

    // Fill background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Convert SVG to image
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, padding, padding, size, size);
      URL.revokeObjectURL(svgUrl);

      // Download
      const pngUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `${downloadFilename}.png`;
      link.href = pngUrl;
      link.click();
    };
    img.src = svgUrl;
  }, [size, bgColor, downloadFilename]);

  return (
    <div className={`flex flex-col items-center ${className}`}>
      {title && (
        <h3 className="text-lg font-semibold text-gray-800 mb-3">{title}</h3>
      )}

      {/* QR Code Container */}
      <div
        ref={qrRef}
        className="bg-white p-4 rounded-lg shadow-sm border border-gray-200"
        style={{ backgroundColor: bgColor }}
      >
        <QRCodeSVG
          value={value}
          size={size}
          level={level}
          bgColor={bgColor}
          fgColor={fgColor}
          includeMargin={false}
        />
      </div>

      {description && (
        <p className="text-sm text-gray-600 mt-3 text-center max-w-xs">
          {description}
        </p>
      )}

      {showDownload && (
        <button
          onClick={handleDownload}
          className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          Download QR Code
        </button>
      )}
    </div>
  );
}

export default QRCodeDisplay;

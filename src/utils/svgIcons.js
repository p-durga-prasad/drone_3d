/**
 * svgIcons.js
 * Inline SVG path strings for each detection class + drone.
 * All icons: viewBox="0 0 24 24", fill="currentColor", no strokes, no gradients.
 * Top-down silhouette style suitable for map markers.
 */

export const ICON_PATHS = {
  // Top-down car: body + windshield/cabin glass band + four wheel marks
  four_wheeler: `
    <rect fill="currentColor" x="6" y="4" width="12" height="16" rx="2.5"/>
    <rect fill="#000000aa" x="7.3" y="8.2" width="9.4" height="7.6" rx="1.3"/>
    <ellipse fill="#000000cc" cx="6.2" cy="8" rx="1.3" ry="2"/>
    <ellipse fill="#000000cc" cx="17.8" cy="8" rx="1.3" ry="2"/>
    <ellipse fill="#000000cc" cx="6.2" cy="16" rx="1.3" ry="2"/>
    <ellipse fill="#000000cc" cx="17.8" cy="16" rx="1.3" ry="2"/>
  `,

  // Top-down motorcycle: front + rear wheel in line, narrow frame, seat block
  two_wheeler: `
    <rect fill="currentColor" x="10.5" y="3" width="3" height="18" rx="1.5"/>
    <ellipse fill="currentColor" cx="12" cy="4.5" rx="2.6" ry="1.6"/>
    <ellipse fill="currentColor" cx="12" cy="19.5" rx="2.2" ry="1.6"/>
    <rect fill="#000000aa" x="9" y="10" width="6" height="4" rx="1.3"/>
  `,

  // Top-down auto-rickshaw: single front wheel, two rear wheels, tapered cabin
  three_wheeler: `
    <path fill="currentColor" d="M9 4h6l2.5 3v9.5A2.5 2.5 0 0 1 15 19H9a2.5 2.5 0 0 1-2.5-2.5V7L9 4Z"/>
    <rect fill="#000000aa" x="7.8" y="8" width="8.4" height="7" rx="1.2"/>
    <ellipse fill="#000000cc" cx="12" cy="4.2" rx="1.7" ry="1.3"/>
    <ellipse fill="#000000cc" cx="6.8" cy="16.5" rx="1.3" ry="1.9"/>
    <ellipse fill="#000000cc" cx="17.2" cy="16.5" rx="1.3" ry="1.9"/>
  `,

  // Top-down truck/bus silhouette
  six_plus_wheeler: `<path fill="currentColor" d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v10h12V6H6Zm1 1h10v3H7V7Zm0 5h10v3H7v-3Z"/>`,

  // Top-down person silhouette
  person: `<path fill="currentColor" d="M12 3a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm-3.5 7h7l1.5 2v7h-2v-4h-1v4h-3v-4h-1v4H9v-7l1.5-2Z"/>`,

  // Simple circle fallback
  unknown: `<circle fill="currentColor" cx="12" cy="12" r="8"/>`,
};

// Drone top-down quadcopter silhouette
export const DRONE_PATH = `<path fill="currentColor" d="M8.5 4.5h2v2h3v-2h2v2h1.5a1 1 0 0 1 1 1V8h-2v3h2v1.5h-2V16h2v.5a1 1 0 0 1-1 1H15.5v-2h-3v2h-2v-2H9a1 1 0 0 1-1-1V16h2v-3.5H8V11h2V8H8V7.5a1 1 0 0 1 1-1H10.5v-2Zm1.5 4v7h4V8.5h-4Z"/>`;

/**
 * Build a complete SVG string for a detection class marker.
 * @param {string} cls  - normalised class key
 * @param {string} color - hex color
 * @param {number} size  - pixel size
 */
export function buildObjectSVG(cls, color, size) {
  const path = ICON_PATHS[cls] ?? ICON_PATHS.unknown;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="color:${color};display:block;">${path}</svg>`;
}

/**
 * Build the drone SVG string.
 * @param {string} color - hex color
 * @param {number} size  - pixel size
 * @param {number} rotation - degrees (heading)
 */
export function buildDroneSVG(color, size, rotation = 0) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="color:${color};display:block;transform:rotate(${rotation}deg);transform-origin:center;">${DRONE_PATH}</svg>`;
}

/**
 * Build a "beacon" marker for the 3D map: the actual per-class vehicle
 * silhouette (car / auto-rickshaw / motorcycle / truck / person) sitting on
 * the ground with a vertical glowing beam rising above it. Meant to be used
 * with marker anchor "bottom" so the icon's base sits exactly on [lng, lat]
 * and the beam reads as pointing straight up regardless of map pitch.
 * @param {string} cls   - normalised class key
 * @param {string} color - hex color
 * @param {number} size  - icon width/height in px
 */
export function buildBeaconHTML(cls, color, size) {
  const path  = ICON_PATHS[cls] ?? ICON_PATHS.unknown;
  const beamH = Math.round(size * 3.4);

  return `
    <div style="position:relative;width:${size}px;">
      <div style="
        position:absolute;
        bottom:${size}px;
        left:50%;
        transform:translateX(-50%);
        width:3px;
        height:${beamH}px;
        background:linear-gradient(to top, ${color} 0%, ${color}cc 12%, ${color}00 95%);
        border-radius:2px;
      "></div>
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
           style="color:${color};display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.45)) drop-shadow(0 0 5px ${color}77);">
        ${path}
      </svg>
    </div>`;
}

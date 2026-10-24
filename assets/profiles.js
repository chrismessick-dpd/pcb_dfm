// Fab capability profiles (mm). Numbers are typical limits, not a specific vendor's datasheet.
(function (Fab) {
  'use strict';
  Fab.profiles = {
    standard: {
      label: 'Standard (quick-turn)',
      minTrace: 0.127, minSpace: 0.127, minDrill: 0.20, maxAspect: 10,
      ringPth: 0.15, ringVia: 0.10, copperToEdge: 0.30, npthToCopper: 0.25,
      minMaskExp: 0.0, minMaskDam: 0.10, minSilkLine: 0.15, minSilkText: 0.80,
      minSpoke: 0.20, minSpokes: 2, minSlot: 0.50, thickness: 1.6, viaMaxDrill: 0.40, isoMinArea: 0.05,
    },
    advanced: {
      label: 'Advanced (HDI-lite)',
      minTrace: 0.075, minSpace: 0.075, minDrill: 0.15, maxAspect: 12,
      ringPth: 0.10, ringVia: 0.075, copperToEdge: 0.20, npthToCopper: 0.20,
      minMaskExp: 0.0, minMaskDam: 0.075, minSilkLine: 0.10, minSilkText: 0.60,
      minSpoke: 0.15, minSpokes: 2, minSlot: 0.45, thickness: 1.6, viaMaxDrill: 0.30, isoMinArea: 0.05,
    },
  };
})(window.Fab);

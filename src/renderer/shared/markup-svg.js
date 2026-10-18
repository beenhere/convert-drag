// Turns annotation shapes into SVG. Used by the Annotate/Redact editor for the
// live preview and by the main process (via sharp) for the saved file, so both
// draw exactly the same thing. Works as a CommonJS module and as a plain
// browser script (window.MarkupSvg).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarkupSvg = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/[<>&"']/g, function (c) {
      return '&#' + c.charCodeAt(0) + ';';
    });
  }

  function num(n) {
    return Math.round(Number(n) * 100) / 100;
  }

  function rectOf(s) {
    return {
      x: Math.min(s.x, s.x + s.w),
      y: Math.min(s.y, s.y + s.h),
      w: Math.abs(s.w),
      h: Math.abs(s.h),
    };
  }

  function arrowHead(s, size) {
    var dx = s.x2 - s.x1;
    var dy = s.y2 - s.y1;
    var len = Math.hypot(dx, dy) || 1;
    var ux = dx / len;
    var uy = dy / len;
    var head = Math.max(size * 3.2, 12);
    var bx = s.x2 - ux * head;
    var by = s.y2 - uy * head;
    var px = -uy * head * 0.55;
    var py = ux * head * 0.55;
    return {
      tip: [s.x2, s.y2],
      left: [bx + px, by + py],
      right: [bx - px, by - py],
      base: [bx + ux * head * 0.25, by + uy * head * 0.25],
    };
  }

  /**
   * @param {object} s shape
   * @param {{preview?: boolean}} opts preview draws placeholders for pixel redactions
   */
  function shapeSvg(s, opts) {
    var color = esc(s.color || '#ff3b30');
    var size = Math.max(1, Number(s.size) || 4);
    var r;
    switch (s.type) {
      case 'rect':
        r = rectOf(s);
        return '<rect x="' + num(r.x) + '" y="' + num(r.y) + '" width="' + num(r.w) + '" height="' + num(r.h) + '" rx="' + num(size * 1.5) + '" fill="none" stroke="' + color + '" stroke-width="' + size + '"/>';
      case 'ellipse':
        r = rectOf(s);
        return '<ellipse cx="' + num(r.x + r.w / 2) + '" cy="' + num(r.y + r.h / 2) + '" rx="' + num(r.w / 2) + '" ry="' + num(r.h / 2) + '" fill="none" stroke="' + color + '" stroke-width="' + size + '"/>';
      case 'highlight':
        r = rectOf(s);
        return '<rect x="' + num(r.x) + '" y="' + num(r.y) + '" width="' + num(r.w) + '" height="' + num(r.h) + '" fill="' + color + '" fill-opacity="0.35"/>';
      case 'line':
        return '<line x1="' + num(s.x1) + '" y1="' + num(s.y1) + '" x2="' + num(s.x2) + '" y2="' + num(s.y2) + '" stroke="' + color + '" stroke-width="' + size + '" stroke-linecap="round"/>';
      case 'arrow': {
        var h = arrowHead(s, size);
        return (
          '<g><line x1="' + num(s.x1) + '" y1="' + num(s.y1) + '" x2="' + num(h.base[0]) + '" y2="' + num(h.base[1]) + '" stroke="' + color + '" stroke-width="' + size + '" stroke-linecap="round"/>' +
          '<polygon points="' + [h.tip, h.left, h.right].map(function (p) { return num(p[0]) + ',' + num(p[1]); }).join(' ') + '" fill="' + color + '" stroke="' + color + '" stroke-width="' + num(size / 2) + '" stroke-linejoin="round"/></g>'
        );
      }
      case 'pen': {
        var pts = s.points || [];
        if (pts.length < 2) return '';
        var d = 'M' + num(pts[0][0]) + ' ' + num(pts[0][1]);
        for (var i = 1; i < pts.length; i++) d += ' L' + num(pts[i][0]) + ' ' + num(pts[i][1]);
        return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + size + '" stroke-linecap="round" stroke-linejoin="round"/>';
      }
      case 'text': {
        var fs = Math.max(8, Number(s.fontSize) || size * 6);
        var lines = String(s.text || '').split('\n');
        var tspans = lines
          .map(function (line, i) {
            return '<tspan x="' + num(s.x) + '" dy="' + (i === 0 ? 0 : num(fs * 1.2)) + '">' + esc(line) + '</tspan>';
          })
          .join('');
        return (
          '<text x="' + num(s.x) + '" y="' + num(s.y + fs) + '" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="700" font-size="' + num(fs) + '" fill="' + color + '" stroke="#ffffff" stroke-width="' + num(fs / 7) + '" paint-order="stroke" stroke-linejoin="round">' + tspans + '</text>'
        );
      }
      case 'redact':
        r = rectOf(s);
        if (s.style === 'solid' || !s.style) return '<rect x="' + num(r.x) + '" y="' + num(r.y) + '" width="' + num(r.w) + '" height="' + num(r.h) + '" fill="#000000"/>';
        if (opts && opts.preview) return '<rect x="' + num(r.x) + '" y="' + num(r.y) + '" width="' + num(r.w) + '" height="' + num(r.h) + '" fill="url(#cd-redact)" stroke="#000" stroke-opacity="0.4" stroke-dasharray="6 4"/>';
        return '';
      default:
        return '';
    }
  }

  function toSvg(shapes, width, height, opts) {
    var defs = '';
    if (opts && opts.preview) {
      defs = '<defs><pattern id="cd-redact" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#888" fill-opacity="0.55"/><rect width="8" height="8" fill="#444" fill-opacity="0.55"/><rect x="8" y="8" width="8" height="8" fill="#444" fill-opacity="0.55"/></pattern></defs>';
    }
    var body = (shapes || [])
      .map(function (s) {
        return shapeSvg(s, opts);
      })
      .join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">' + defs + body + '</svg>';
  }

  return { toSvg: toSvg, shapeSvg: shapeSvg };
});

/**
 * Downloadable verification receipt, as PDF or PNG.
 * Built in the browser. No server, no external requests.
 */

import { jsPDF } from 'jspdf';
import type { VerificationResult } from '@/lib/verify';

type RGB = [number, number, number];

export type StatusKind = 'verified' | 'failed' | 'mismatch' | 'unverified';

export interface ReceiptStatus {
  kind: StatusKind;
  title: string;
  subtitle: string; // empty when the card has no subtitle
  description: string;
  rgb: RGB; // icon colour (and subtitle colour)
  hex: string;
}

const GREEN: RGB = [21, 128, 61];
const AMBER: RGB = [180, 83, 9];
const GREY_ICON: RGB = [107, 114, 128];
const NAVY: RGB = [27, 49, 88];
const INK: RGB = [27, 37, 56];
const MUTED: RGB = [107, 114, 128];
const RULE: RGB = [226, 231, 240];
const TINT: RGB = [243, 245, 249];
const GREY: RGB = [156, 163, 175];
const WHITE: RGB = [255, 255, 255];
const SKY: RGB = [172, 198, 233];

const css = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
const hexOf = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

/**
 * The status card: icon, title, subtitle and description.
 * Based on two results: whether the transaction succeeded on-chain, and whether the
 * payment details matched the expected ones.
 */
export function receiptStatus(result: VerificationResult): ReceiptStatus {
  if (result.txStatus === 'Failed (reverted)') {
    return {
      kind: 'failed',
      title: 'FAILED / PENDING',
      subtitle: '',
      description: 'The transaction failed on-chain. No payment was completed.',
      rgb: AMBER,
      hex: hexOf(AMBER),
    };
  }
  if (result.txStatus === 'Succeeded' && result.outcome === 'MATCH') {
    return {
      kind: 'verified',
      title: 'SUCCESSFUL',
      subtitle: 'Payment verified',
      description: 'The transaction matches the expected recipient, token, and amount.',
      rgb: GREEN,
      hex: hexOf(GREEN),
    };
  }
  if (result.txStatus === 'Succeeded' && result.outcome === 'MISMATCH') {
    return {
      kind: 'mismatch',
      title: 'SUCCESSFUL',
      subtitle: 'Payment details mismatch',
      description:
        'The transaction succeeded on-chain, but the payment details do not match the expected order. Review the details below before marking the order as paid.',
      rgb: AMBER,
      hex: hexOf(AMBER),
    };
  }
  return {
    kind: 'unverified',
    title: 'UNVERIFIABLE',
    subtitle: '',
    description: 'The transaction could not be fully verified. Review the notes below before making a payment decision.',
    rgb: GREY_ICON,
    hex: hexOf(GREY_ICON),
  };
}

/** Format a block time for the receipt, in UTC. */
export function chainTime(seconds?: number): string {
  if (seconds === undefined) return 'Not available';
  return new Date(seconds * 1000).toUTCString().replace('GMT', 'UTC');
}

/**
 * Wrap text at spaces, so words are never split. Only a single word that is wider
 * than the whole line (such as a hash or URL) is broken, at the character that overflows.
 */
function wrapWords(measure: (s: string) => number, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    let piece = '';
    for (const ch of word) {
      if (piece && measure(piece + ch) > maxWidth) {
        lines.push(piece);
        piece = ch;
      } else {
        piece += ch;
      }
    }
    line = piece;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function wrapText(doc: jsPDF, text: string, width: number): string[] {
  return wrapWords((s) => doc.getTextWidth(s), text, width);
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, font: string): string[] {
  ctx.font = font;
  return wrapWords((s) => ctx.measureText(s).width, text, maxWidth);
}

// ---------- PDF ----------

const MARGIN = 20;
const CONTENT_W = 170; // A4 210mm minus 20mm margins on each side
// Table columns (sum = CONTENT_W)
const COL_FIELD = 36;
const COL_CLAIMED = 48;
const COL_ONCHAIN = 64;
const COL_RESULT = 22;

function setFill(doc: jsPDF, c: RGB) {
  doc.setFillColor(c[0], c[1], c[2]);
}
function setInk(doc: jsPDF, c: RGB) {
  doc.setTextColor(c[0], c[1], c[2]);
}
function setStroke(doc: jsPDF, c: RGB) {
  doc.setDrawColor(c[0], c[1], c[2]);
}

/** Draw a status icon in the PDF. (cx, cy) is the centre; r is the radius, in mm. */
function drawPdfIcon(doc: jsPDF, kind: StatusKind, cx: number, cy: number, r: number, color: RGB) {
  setStroke(doc, color);
  setInk(doc, color);
  doc.setLineWidth(0.7);
  if (kind === 'verified') {
    doc.circle(cx, cy, r, 'S');
    doc.line(cx - r * 0.5, cy, cx - r * 0.12, cy + r * 0.4);
    doc.line(cx - r * 0.12, cy + r * 0.4, cx + r * 0.5, cy - r * 0.35);
    return;
  }
  if (kind === 'failed') {
    doc.triangle(cx, cy - r, cx - r, cy + r * 0.85, cx + r, cy + r * 0.85, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('!', cx, cy + r * 0.55, { align: 'center' });
    return;
  }
  if (kind === 'mismatch') {
    const w = r * 0.85;
    const pts: [number, number][] = [
      [cx, cy - r],
      [cx + w, cy - r * 0.55],
      [cx + w, cy + r * 0.1],
      [cx, cy + r],
      [cx - w, cy + r * 0.1],
      [cx - w, cy - r * 0.55],
    ];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      doc.line(a[0], a[1], b[0], b[1]);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('!', cx, cy + r * 0.45, { align: 'center' });
    return;
  }
  doc.circle(cx, cy, r, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('?', cx, cy + r * 0.5, { align: 'center' });
}

export function buildReceiptPdf(result: VerificationResult, shareUrl: string, repeatCount: number): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const bottom = pageH - 26;
  let y = 0;

  const status = receiptStatus(result);
  const label = status.title;
  const badgeColor = status.rgb;

  // Watermark: a solid, very pale tint of the status colour, drawn first on each page
  // so it sits behind the text. No transparency, so every viewer shows it the same way.
  const stamp = () => {
    const tint = badgeColor.map((c) => Math.round(255 - (255 - c) * 0.1)) as RGB;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(label.length > 10 ? 36 : 54);
    doc.setTextColor(tint[0], tint[1], tint[2]);
    doc.text(label, pageW / 2, pageH / 2, { angle: 35, align: 'center' });
  };

  const newPage = () => {
    doc.addPage();
    stamp();
    y = MARGIN;
  };
  const ensureSpace = (needed: number) => {
    if (y + needed > bottom) newPage();
  };

  stamp();

  // ---- Header band ----
  setFill(doc, NAVY);
  doc.rect(0, 0, pageW, 30, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text('PayProof', MARGIN, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(SKY[0], SKY[1], SKY[2]);
  doc.text('Verification receipt', MARGIN, 21);
  doc.text("Don't trust the screenshot. Verify the payment.", pageW - MARGIN, 21, { align: 'right' });
  y = 42;

  // ---- Status card ----
  drawPdfIcon(doc, status.kind, MARGIN + 5, y + 5, 4.5, status.rgb);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  setInk(doc, INK);
  doc.text(status.title, MARGIN + 14, y + 6);
  let headBase = y + 6;
  if (status.subtitle) {
    doc.setFontSize(10);
    setInk(doc, status.rgb);
    doc.text(status.subtitle, MARGIN + 14, y + 12);
    headBase = y + 12;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  setInk(doc, INK);
  const descLines = wrapText(doc, status.description, CONTENT_W - 14);
  const descTop = headBase + 6.5;
  descLines.forEach((line, i) => doc.text(line, MARGIN + 14, descTop + i * 4.8));
  y = descTop + descLines.length * 4.8 + 6;

  // ---- Details ----
  const issued = new Date(result.timestamp);
  const detailRow = (name: string, value: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const lines = wrapText(doc, value, CONTENT_W - 40);
    const h = lines.length * 4.8 + 2.5;
    ensureSpace(h);
    setInk(doc, MUTED);
    doc.text(name, MARGIN, y);
    setInk(doc, INK);
    lines.forEach((line, i) => doc.text(line, MARGIN + 40, y + i * 4.8));
    y += h;
  };
  detailRow('Issued', `${issued.toUTCString()}  (${issued.toISOString()})`);
  detailRow('Network', `${result.network} (Chain ID ${result.chainId})`);
  detailRow('Token', `USDC, contract ${result.usdcContractAddress}`);
  detailRow('Checks this session', String(repeatCount));

  const sectionTitle = (title: string) => {
    ensureSpace(14);
    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    setInk(doc, NAVY);
    doc.text(title.toUpperCase(), MARGIN, y);
    y += 2.5;
    setStroke(doc, RULE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 5;
  };

  // ---- Transaction ----
  sectionTitle('Transaction');
  detailRow('Hash', result.txHash);
  if (result.blockNumber !== undefined) detailRow('Block', result.blockNumber.toString());
  detailRow('Transaction time', chainTime(result.blockTime));
  detailRow('Explorer', result.explorerUrl);

  // ---- Claim vs. chain table ----
  sectionTitle('Claim vs. chain');
  const PAD_TOP = 3.4; // baseline of the first line, from the top of the row
  const LINE_H = 4; // distance between wrapped lines
  const xs = [MARGIN + 2, MARGIN + COL_FIELD + 2, MARGIN + COL_FIELD + COL_CLAIMED + 2];
  const resultX = MARGIN + COL_FIELD + COL_CLAIMED + COL_ONCHAIN + 2;

  const drawTableHeader = () => {
    setFill(doc, TINT);
    doc.rect(MARGIN, y - 4.5, CONTENT_W, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    setInk(doc, MUTED);
    doc.text('FIELD', xs[0], y);
    doc.text('CLAIMED', xs[1], y);
    doc.text('ON-CHAIN', xs[2], y);
    doc.text('RESULT', resultX, y);
    y += 6;
  };

  if (result.fields.length === 0) {
    ensureSpace(10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    setInk(doc, MUTED);
    doc.text('No field comparison is available for this outcome.', MARGIN, y);
    y += 8;
  } else {
    ensureSpace(20);
    drawTableHeader();
    for (const field of result.fields) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      const cols = [
        wrapText(doc, field.label, COL_FIELD - 4),
        wrapText(doc, field.claimed, COL_CLAIMED - 4),
        wrapText(doc, field.actual, COL_ONCHAIN - 4),
      ];
      const lines = Math.max(...cols.map((c) => c.length));
      const rowH = PAD_TOP + (lines - 1) * LINE_H + 2.8; // top of row to its rule

      if (y + rowH > bottom) {
        newPage();
        drawTableHeader();
      }

      setInk(doc, INK);
      cols.forEach((col, c) => {
        col.forEach((text, i) => doc.text(text, xs[c], y + PAD_TOP + i * LINE_H));
      });

      const resultText = field.match === true ? 'Match' : field.match === false ? 'No match' : 'n/a';
      doc.setFont('helvetica', 'bold');
      setInk(doc, field.match === true ? GREEN : field.match === false ? AMBER : GREY);
      doc.text(resultText, resultX, y + PAD_TOP);

      const ruleY = y + rowH;
      setStroke(doc, RULE);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, ruleY, MARGIN + CONTENT_W, ruleY);
      y = ruleY + 0.6;
    }
    y += 2;
  }

  // ---- Notes ----
  if (result.errorDetail) {
    sectionTitle('Notes');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    setInk(doc, INK);
    const lines = wrapText(doc, result.errorDetail, CONTENT_W);
    ensureSpace(lines.length * 4.8);
    lines.forEach((line, i) => doc.text(line, MARGIN, y + i * 4.8));
    y += lines.length * 4.8 + 2;
  }

  // ---- Re-run link ----
  sectionTitle('Re-run this check');
  detailRow('Link', shareUrl);

  // ---- Disclaimer ----
  const disclaimerText =
    'This receipt verifies specific on-chain transaction details only. It does not verify the identity or honesty of any party who submitted the payment.';
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const dLines = wrapText(doc, disclaimerText, CONTENT_W - 8);
  const boxH = dLines.length * 4.4 + 6;
  ensureSpace(boxH + 6);
  y += 6;
  setFill(doc, TINT);
  doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 2, 2, 'F');
  setInk(doc, MUTED);
  dLines.forEach((line, i) => doc.text(line, MARGIN + 4, y + 6 + i * 4.4));

  // ---- Footer on every page ----
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    setInk(doc, GREY);
    setStroke(doc, RULE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, pageH - 18, MARGIN + CONTENT_W, pageH - 18);
    doc.text('Generated by PayProof', MARGIN, pageH - 12);
    doc.text(`Page ${i} of ${pages}`, MARGIN + CONTENT_W, pageH - 12, { align: 'right' });
  }

  return doc;
}

/** Build the receipt and download it as a PDF. */
export function downloadReceipt(result: VerificationResult, shareUrl: string, repeatCount: number): void {
  const doc = buildReceiptPdf(result, shareUrl, repeatCount);
  doc.save(`payproof-receipt-${result.txHash.slice(0, 10)}.pdf`);
}

// ---------- PNG ----------

const PNG_WIDTH = 800; // CSS pixels. The image is saved at 2x for sharpness.

function fillRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

/** Draw a status icon on the canvas. (cx, cy) is the centre; r is the radius, in CSS pixels. */
function drawCanvasIcon(ctx: CanvasRenderingContext2D, kind: StatusKind, cx: number, cy: number, r: number, color: RGB) {
  ctx.strokeStyle = css(color);
  ctx.fillStyle = css(color);
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const glyph = (ch: string, size: number) => {
    ctx.font = `bold ${size}px Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, cx, cy + r * 0.1);
  };
  if (kind === 'verified') {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.5, cy);
    ctx.lineTo(cx - r * 0.12, cy + r * 0.4);
    ctx.lineTo(cx + r * 0.5, cy - r * 0.35);
    ctx.stroke();
    return;
  }
  if (kind === 'failed') {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy + r * 0.85);
    ctx.lineTo(cx - r, cy + r * 0.85);
    ctx.closePath();
    ctx.stroke();
    glyph('!', r * 1.1);
    return;
  }
  if (kind === 'mismatch') {
    const w = r * 0.85;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + w, cy - r * 0.55);
    ctx.lineTo(cx + w, cy + r * 0.1);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - w, cy + r * 0.1);
    ctx.lineTo(cx - w, cy - r * 0.55);
    ctx.closePath();
    ctx.stroke();
    glyph('!', r * 1.0);
    return;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  glyph('?', r * 1.1);
}

/**
 * Lay out and draw the receipt. Called twice: first with height 0 to measure,
 * then with the final height to draw. Returns the y position where content ends.
 */
function renderPng(
  ctx: CanvasRenderingContext2D,
  height: number,
  result: VerificationResult,
  shareUrl: string,
  repeatCount: number,
): number {
  const M = 48;
  const CW = PNG_WIDTH - M * 2;
  const drawing = height > 0;
  const sans = (size: number, weight = 'normal') => `${weight} ${size}px Helvetica, Arial, sans-serif`;
  const status = receiptStatus(result);
  let y = 0;

  const text = (value: string, x: number, baseline: number, font: string, color: RGB, align: CanvasTextAlign = 'left') => {
    if (!drawing) return;
    ctx.font = font;
    ctx.fillStyle = css(color);
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(value, x, baseline);
  };
  const rule = (yy: number) => {
    if (!drawing) return;
    ctx.strokeStyle = css(RULE);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(M, yy);
    ctx.lineTo(M + CW, yy);
    ctx.stroke();
  };

  // Watermark first, so it sits behind everything else.
  if (drawing) {
    const tint = status.rgb.map((c) => Math.round(255 - (255 - c) * 0.1));
    ctx.save();
    ctx.translate(PNG_WIDTH / 2, height / 2);
    ctx.rotate((-35 * Math.PI) / 180);
    ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
    ctx.font = sans(status.title.length > 10 ? 72 : 110, 'bold');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(status.title, 0, 0);
    ctx.restore();
  }

  // Header band
  if (drawing) {
    ctx.fillStyle = css(NAVY);
    ctx.fillRect(0, 0, PNG_WIDTH, 84);
  }
  text('PayProof', M, 46, sans(28, 'bold'), WHITE);
  text('Verification receipt', M, 68, sans(14), SKY);
  text("Don't trust the screenshot. Verify the payment.", PNG_WIDTH - M, 68, sans(13), SKY, 'right');

  // Status card
  const top = 112;
  if (drawing) drawCanvasIcon(ctx, status.kind, M + 16, top + 16, 13, status.rgb);
  text(status.title, M + 44, top + 24, sans(24, 'bold'), INK);
  let descY = top + 48;
  if (status.subtitle) {
    text(status.subtitle, M + 44, top + 48, sans(16, 'bold'), status.rgb);
    descY = top + 72;
  }
  const descLines = wrapCanvasText(ctx, status.description, CW - 44, sans(15));
  descLines.forEach((line, i) => text(line, M + 44, descY + i * 21, sans(15), INK));
  y = descY + descLines.length * 21 + 18;

  const detailRow = (name: string, value: string) => {
    const lines = wrapCanvasText(ctx, value, CW - 200, sans(14));
    text(name, M, y + 14, sans(14), MUTED);
    lines.forEach((line, i) => text(line, M + 200, y + 14 + i * 20, sans(14), INK));
    y += lines.length * 20 + 10;
  };
  const sectionTitle = (title: string) => {
    y += 10;
    text(title.toUpperCase(), M, y + 12, sans(12, 'bold'), NAVY);
    rule(y + 20);
    y += 32;
  };

  const issued = new Date(result.timestamp);
  detailRow('Issued', `${issued.toUTCString()}  (${issued.toISOString()})`);
  detailRow('Network', `${result.network} (Chain ID ${result.chainId})`);
  detailRow('Token', `USDC, contract ${result.usdcContractAddress}`);
  detailRow('Checks this session', String(repeatCount));

  sectionTitle('Transaction');
  detailRow('Hash', result.txHash);
  if (result.blockNumber !== undefined) detailRow('Block', result.blockNumber.toString());
  detailRow('Transaction time', chainTime(result.blockTime));
  detailRow('Explorer', result.explorerUrl);

  // Claim vs. chain table. Column widths in px, summing to the content width.
  const COLS = [149, 199, 265, 91];
  const xs = [M + 8, M + COLS[0] + 8, M + COLS[0] + COLS[1] + 8, M + COLS[0] + COLS[1] + COLS[2] + 8];
  const PAD = 22; // baseline of the first line, from the top of the row
  const LINE = 18; // distance between wrapped lines

  sectionTitle('Claim vs. chain');
  if (result.fields.length === 0) {
    text('No field comparison is available for this outcome.', M, y + 14, sans(14), MUTED);
    y += 30;
  } else {
    if (drawing) {
      ctx.fillStyle = css(TINT);
      ctx.fillRect(M, y, CW, 30);
    }
    ['FIELD', 'CLAIMED', 'ON-CHAIN', 'RESULT'].forEach((label, i) => text(label, xs[i], y + 19, sans(11, 'bold'), MUTED));
    y += 34;

    for (const field of result.fields) {
      const cols = [
        wrapCanvasText(ctx, field.label, COLS[0] - 16, sans(14)),
        wrapCanvasText(ctx, field.claimed, COLS[1] - 16, sans(14)),
        wrapCanvasText(ctx, field.actual, COLS[2] - 16, sans(14)),
      ];
      const lines = Math.max(...cols.map((c) => c.length));
      const rowH = PAD + (lines - 1) * LINE + 14;

      cols.forEach((col, c) => col.forEach((t, i) => text(t, xs[c], y + PAD + i * LINE, sans(14), INK)));
      const resultText = field.match === true ? 'Match' : field.match === false ? 'No match' : 'n/a';
      const resultColor = field.match === true ? GREEN : field.match === false ? AMBER : GREY;
      text(resultText, xs[3], y + PAD, sans(14, 'bold'), resultColor);

      rule(y + rowH);
      y += rowH + 2;
    }
    y += 8;
  }

  if (result.errorDetail) {
    sectionTitle('Notes');
    for (const line of wrapCanvasText(ctx, result.errorDetail, CW, sans(14))) {
      text(line, M, y + 14, sans(14), INK);
      y += 20;
    }
    y += 8;
  }

  sectionTitle('Re-run this check');
  detailRow('Link', shareUrl);

  // Disclaimer box
  const disclaimer = wrapCanvasText(
    ctx,
    'This receipt verifies specific on-chain transaction details only. It does not verify the identity or honesty of any party who submitted the payment.',
    CW - 24,
    sans(13),
  );
  const boxH = disclaimer.length * 18 + 16;
  y += 14;
  if (drawing) fillRoundRect(ctx, M, y, CW, boxH, 6, css(TINT));
  disclaimer.forEach((line, i) => text(line, M + 12, y + 20 + i * 18, sans(13), MUTED));
  y += boxH;

  // Footer, drawn at the bottom of the final image
  if (drawing) rule(height - 50);
  text('Generated by PayProof', M, height - 26, sans(11), GREY);
  text('Page 1 of 1', M + CW, height - 26, sans(11), GREY, 'right');

  return y;
}

/** Build the receipt as a PNG image. */
export async function buildReceiptPng(result: VerificationResult, shareUrl: string, repeatCount: number): Promise<Blob> {
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('This browser cannot create images.');
  const contentEnd = renderPng(measure, 0, result, shareUrl, repeatCount);
  const height = Math.ceil(contentEnd + 90);

  const canvas = document.createElement('canvas');
  canvas.width = PNG_WIDTH * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot create images.');
  ctx.scale(2, 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PNG_WIDTH, height);
  renderPng(ctx, height, result, shareUrl, repeatCount);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not create the image.'));
    }, 'image/png');
  });
}

/** Build the receipt and download it as a PNG image. */
export async function downloadReceiptPng(result: VerificationResult, shareUrl: string, repeatCount: number): Promise<void> {
  const blob = await buildReceiptPng(result, shareUrl, repeatCount);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `payproof-receipt-${result.txHash.slice(0, 10)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

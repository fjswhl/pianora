import { LocalizedError } from '../i18n';
/**
 * Lazy-loaded MusicXML sheet music engraver powered by OpenSheetMusicDisplay (OSMD).
 *
 * Dynamically imports `opensheetmusicdisplay` only when a user imports a `.musicxml` / `.xml` / `.mxl`
 * score, keeping the initial bundle completely unaffected.
 *
 * Outputs standalone SVG pages normalized to staff-space units (1 unit = 1 staff space, matching
 * LilyPond's SVG coordinate system) and registers exact system + measure geometry with
 * `followScore.ts` so both `SheetMusicPanel` (五线谱) and `FollowScorePanel` (三行随奏谱) work
 * seamlessly on MusicXML imports.
 */
import { registerFollowScore, type FollowScore } from './followScore';

const OSMD_UNIT_IN_PIXELS = 10;
const RENDER_WIDTH_PX = 1080;

function readSvgDimension(svg: SVGSVGElement): { width: number; height: number } {
  const attrW = parseFloat(svg.getAttribute('width') || '');
  const attrH = parseFloat(svg.getAttribute('height') || '');
  if (Number.isFinite(attrW) && attrW > 0 && Number.isFinite(attrH) && attrH > 0) {
    return { width: attrW, height: attrH };
  }
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    return { width: vb[2], height: vb[3] };
  }
  const rect = svg.getBoundingClientRect();
  return {
    width: rect.width > 0 ? rect.width : RENDER_WIDTH_PX,
    height: rect.height > 0 ? rect.height : Math.round(RENDER_WIDTH_PX * 1.414),
  };
}

/**
 * Normalizes an OSMD pixel-coordinate SVG into staff-space units (`viewBox="0 0 boxW boxH"`)
 * while preserving native pixel dimensions for crisp rendering inside both inline DOM and
 * `<image href="blob:...">` in FollowScorePanel.
 */
function serializeNormalizedSvg(
  svg: SVGSVGElement,
  unitPx: number,
): { source: string; box: [number, number, number, number] } {
  const { width: wPx, height: hPx } = readSvgDimension(svg);
  const boxW = wPx / unitPx;
  const boxH = hPx / unitPx;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `0 0 ${boxW.toFixed(3)} ${boxH.toFixed(3)}`);
  clone.setAttribute('width', String(Math.round(wPx)));
  clone.setAttribute('height', String(Math.round(hPx)));
  clone.removeAttribute('style');

  const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  wrapper.setAttribute('transform', `scale(${(1 / unitPx).toFixed(6)})`);
  while (clone.firstChild) {
    wrapper.appendChild(clone.firstChild);
  }
  clone.appendChild(wrapper);

  const source = new XMLSerializer().serializeToString(clone);
  return { source, box: [0, 0, boxW, boxH] };
}

export async function renderMusicXmlToSvgPages(xmlText: string): Promise<string[]> {
  const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');

  const host = document.createElement('div');
  host.style.cssText =
    `position:fixed;left:-10000px;top:0;width:${RENDER_WIDTH_PX}px;` +
    'visibility:hidden;pointer-events:none;background:#ffffff;';
  document.body.appendChild(host);

  let osmd: InstanceType<typeof OpenSheetMusicDisplay> | null = null;
  try {
    osmd = new OpenSheetMusicDisplay(host, {
      backend: 'svg',
      autoResize: false,
      pageFormat: 'A4_P',
      drawTitle: true,
      drawSubtitle: true,
      drawComposer: true,
      drawCredits: true,
      drawPartNames: false,
      drawPartAbbreviations: false,
      drawMeasureNumbers: true,
      drawingParameters: 'compacttight',
    });

    await osmd.load(xmlText);
    osmd.render();

    const unitPx = OSMD_UNIT_IN_PIXELS * (osmd.Zoom || 1);
    const svgElements = Array.from(host.querySelectorAll('svg'));
    if (!svgElements.length) {
      throw new LocalizedError("MusicXML 五线谱渲染未生成任何页面。");
    }

    const svgStrings: string[] = [];
    const pages: FollowScore['pages'] = [];
    const rows: FollowScore['rows'] = [];
    const measures: FollowScore['measures'] = [];

    for (const svg of svgElements) {
      const { source, box } = serializeNormalizedSvg(svg, unitPx);
      svgStrings.push(source);
      pages.push({ box });
    }

    const musicPages = osmd.GraphicSheet?.MusicPages ?? [];
    for (let pageIdx = 0; pageIdx < musicPages.length && pageIdx < pages.length; pageIdx++) {
      const musicPage = musicPages[pageIdx];
      const pageBox = pages[pageIdx].box;

      for (const system of musicPage.MusicSystems ?? []) {
        // Group GraphicalMeasures across all staves by measureListIndex so ordering is guaranteed
        // regardless of [staff][col] vs [col][staff] layout.
        const byMeasure = new Map<
          number,
          {
            number: number;
            moment: number;
            end: number;
            left: number;
            right: number;
            top: number;
            bottom: number;
          }
        >();

        for (const group of system.GraphicalMeasures ?? []) {
          for (const gm of group ?? []) {
            if (!gm || !gm.parentSourceMeasure || !gm.PositionAndShape) continue;
            const sm = gm.parentSourceMeasure;
            const idx = sm.measureListIndex;
            const ps = gm.PositionAndShape;
            const abs = ps.AbsolutePosition;
            if (!abs) continue;

            const left = abs.x + (ps.BorderLeft ?? 0);
            const right = abs.x + (ps.BorderRight ?? 0);
            const top = abs.y + (ps.BorderTop ?? 0);
            const bottom = abs.y + (ps.BorderBottom ?? 0);
            const moment = sm.AbsoluteTimestamp?.RealValue ?? 0;
            const dur = sm.Duration?.RealValue || sm.ActiveTimeSignature?.RealValue || 1;
            const end = moment + Math.max(0.0625, dur);
            const num = sm.MeasureNumber > 0 ? sm.MeasureNumber : idx + 1;

            const existing = byMeasure.get(idx);
            if (!existing) {
              byMeasure.set(idx, { number: num, moment, end, left, right, top, bottom });
            } else {
              existing.left = Math.min(existing.left, left);
              existing.right = Math.max(existing.right, right);
              existing.top = Math.min(existing.top, top);
              existing.bottom = Math.max(existing.bottom, bottom);
            }
          }
        }

        const ordered = [...byMeasure.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, v]) => v);
        if (!ordered.length) continue;

        let sysTop = Infinity;
        let sysBottom = -Infinity;
        for (const sl of system.StaffLines ?? []) {
          const ps = sl?.PositionAndShape;
          const abs = ps?.AbsolutePosition;
          if (!abs) continue;
          sysTop = Math.min(sysTop, abs.y + (ps.BorderTop ?? 0));
          sysBottom = Math.max(sysBottom, abs.y + (ps.BorderBottom ?? 4));
        }
        if (!Number.isFinite(sysTop) || !Number.isFinite(sysBottom) || sysBottom <= sysTop) {
          sysTop = Math.min(...ordered.map((m) => m.top));
          sysBottom = Math.max(...ordered.map((m) => m.bottom));
        }

        // Clamp row bounds cleanly inside the page box with breathing room for tempo & volta marks
        const sysLeft = Math.max(0, Math.min(...ordered.map((m) => m.left)));
        const sysRight = Math.min(pageBox[2], Math.max(...ordered.map((m) => m.right)));
        const prevRow = rows.at(-1);
        const minTop = prevRow && prevRow.page === pageIdx ? prevRow.bottom + 0.2 : 0.7;
        const top = Math.max(minTop, sysTop - 2.4);
        const bottom = Math.min(pageBox[3] - 0.7, sysBottom + 2.0);
        if (sysRight <= sysLeft || bottom <= top) continue;

        const rowIndex = rows.length;
        rows.push({
          page: pageIdx,
          moment: ordered[0].moment,
          end: ordered[ordered.length - 1].end,
          left: sysLeft,
          right: sysRight,
          top,
          bottom,
        });

        for (const m of ordered) {
          if (m.right > m.left && m.end > m.moment) {
            measures.push({
              row: rowIndex,
              moment: m.moment,
              end: m.end,
              number: m.number,
              left: m.left,
              right: m.right,
            });
          }
        }
      }
    }

    registerFollowScore(svgStrings, { rows, measures, pages, repeats: '' });
    return svgStrings;
  } finally {
    try {
      osmd?.clear();
    } catch {
      // Ignore OSMD teardown errors
    }
    host.remove();
  }
}

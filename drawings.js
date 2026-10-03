/**
 * TradingView Pro - Interactive Drawing Tools Engine
 * Overlays an interactive HTML5 Canvas over Lightweight Charts.
 * Syncs drawing coordinates (time & price) dynamically with chart pan & zoom.
 * Supported Tools:
 * - Lines: Trendline, Ray, Info Line, Extended Line, Trend Angle, Horizontal Ray, Horizontal Line, Vertical Line, Crossline
 * - Complete Fibonacci & Gann Suite (15 tools):
 *     Fib Retracement, Trend-based Fib Extension, Fib Channel, Fib Time Zone,
 *     Fib Speed Resistance Fan, Trend-based Fib Time, Fib Circles, Fib Spiral,
 *     Fib Speed Resistance Arcs, Fib Wedge, Pitchfan, Gann Box, Gann Square Fixed,
 *     Gann Square, Gann Fan
 * - Shapes & Analysis: Order Block / Rectangle, Measure, Patterns, Text Annotation
 * - Trading: Long Position Tool & Short Position Tool (Risk/Reward, TP, SL)
 *
 * Full Drawing Interaction:
 * - Click & drag drawing body to MOVE ANYWHERE across price & time
 * - Click & drag handles to resize or reposition endpoints
 * - Double-click drawing to open full TradingView-style Settings Modal
 * - Floating action toolbar with live Color Swatches, Line Width, Line Style, Lock, Settings Cog, Delete
 */

window.DrawingEngine = (function () {
  let canvas = null;
  let ctx = null;
  let chart = null;
  let candleSeries = null;
  let container = null;

  let activeTool = 'cursor';
  let magnetMode = false;
  let stayInDrawingMode = false;
  let isLocked = false;
  let isHidden = false;

  let currentUserId = localStorage.getItem('tv_active_user_id') || 'default';
  let currentSymbol = 'XAUUSD';
  let saveDebounceTimer = null;
  let isInitialLoaded = false;

  let drawings = [];
  let currentDrawing = null;
  let selectedDrawing = null;
  let isDrawing = false;
  let drawStep = 0; // 0: idle, 1: drawing p1->p2, 2: drawing p2->p3 (for 3-point tools)
  let hoverDrawing = null;

  // Move & Drag interaction state
  let isDraggingDrawing = false;
  let dragMode = null; // 'handle' or 'body'
  let dragHandle = null; // { id: 'p1'|'p2'|'p3'|'target'|'stop', d: drawing }
  let dragDrawing = null;
  let dragStartPt = null; // { time, price }
  let dragInitialPoints = null;
  let mouseDownStartPos = null;

  // Undo & Redo History Engine (TradingView Style)
  const undoHistory = [];
  const redoHistory = [];
  const MAX_HISTORY = 50;
  let dragSnapshot = null;

  function pushUndoState() {
    const snapshot = JSON.stringify(drawings);
    if (undoHistory.length > 0 && undoHistory[undoHistory.length - 1] === snapshot) {
      return;
    }
    undoHistory.push(snapshot);
    if (undoHistory.length > MAX_HISTORY) undoHistory.shift();
    redoHistory.length = 0;
    updateUndoRedoUI();
  }

  function undo() {
    if (undoHistory.length === 0) {
      if (window.showToast) window.showToast('Nothing to undo (គ្មានអ្វីត្រូវត្រឡប់វិញ)');
      return;
    }
    redoHistory.push(JSON.stringify(drawings));
    const prev = undoHistory.pop();
    drawings = JSON.parse(prev);
    selectedDrawing = null;
    hideFloatingToolbar();
    saveDrawings(true);
    redraw();
    updateUndoRedoUI();
    if (window.showToast) window.showToast('↩ មិនធ្វើវិញ / Undo (Ctrl+Z)');
  }

  function redo() {
    if (redoHistory.length === 0) {
      if (window.showToast) window.showToast('Nothing to redo (គ្មានអ្វីត្រូវធ្វើឡើងវិញ)');
      return;
    }
    undoHistory.push(JSON.stringify(drawings));
    const next = redoHistory.pop();
    drawings = JSON.parse(next);
    selectedDrawing = null;
    hideFloatingToolbar();
    saveDrawings(true);
    redraw();
    updateUndoRedoUI();
    if (window.showToast) window.showToast('↪ ធ្វើឡើងវិញ / Redo (Ctrl+Y)');
  }

  function updateUndoRedoUI() {
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    if (btnUndo) {
      const can = undoHistory.length > 0;
      btnUndo.style.opacity = can ? '1' : '0.35';
      btnUndo.style.pointerEvents = can ? 'auto' : 'none';
      btnUndo.title = can ? `មិនធ្វើវិញ / Undo (Ctrl+Z) [${undoHistory.length}]` : 'មិនធ្វើវិញ / Undo (Ctrl+Z)';
    }
    if (btnRedo) {
      const can = redoHistory.length > 0;
      btnRedo.style.opacity = can ? '1' : '0.35';
      btnRedo.style.pointerEvents = can ? 'auto' : 'none';
      btnRedo.title = can ? `ធ្វើឡើងវិញ / Redo (Ctrl+Y) [${redoHistory.length}]` : 'ធ្វើឡើងវិញ / Redo (Ctrl+Y)';
    }
  }

  function duplicateSelectedDrawing() {
    if (!selectedDrawing) return;
    pushUndoState();
    const clone = JSON.parse(JSON.stringify(selectedDrawing));
    clone.id = Date.now().toString();

    // Offset clone slightly in time so it sits right next to the original
    const candles = window.DataFeed ? window.DataFeed.getLiveCandles() : null;
    const interval = (candles && candles.length > 1) ? (candles[1].time - candles[0].time) : 300;
    const dt = interval * 3;

    if (clone.p1 && clone.p1.time) clone.p1.time += dt;
    if (clone.p2 && clone.p2.time) clone.p2.time += dt;
    if (clone.p3 && clone.p3.time) clone.p3.time += dt;

    drawings.push(clone);
    selectedDrawing = clone;
    saveDrawings();
    updateFloatingToolbar();
    redraw();
    if (window.showToast) window.showToast('📋 បង្កើតចម្លង / Duplicated (Ctrl+D)');
  }

  function hexToRgba(hex, alpha = 1) {
    if (!hex) return 'rgba(41, 98, 255, ' + alpha + ')';
    if (hex.startsWith('rgba(')) {
      const parts = hex.split(',');
      if (parts.length === 4) {
        return parts.slice(0, 3).join(',') + ', ' + alpha + ')';
      }
    } else if (hex.startsWith('rgb(')) {
      return hex.replace('rgb(', 'rgba(').replace(')', ', ' + alpha + ')');
    }
    let c = hex.replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    const r = parseInt(c.substring(0, 2), 16) || 0;
    const g = parseInt(c.substring(2, 4), 16) || 0;
    const b = parseInt(c.substring(4, 6), 16) || 0;
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
  }

  // 24 Standard TradingView Fibonacci Levels (2 columns x 12 rows)
  const TV_DEFAULT_24_FIB_LEVELS = [
    // Column 1 (12 rows)
    { ratio: 0, color: '#787b86', visible: true },
    { ratio: 0.236, color: '#f23645', visible: true },
    { ratio: 0.382, color: '#ff9800', visible: true },
    { ratio: 0.5, color: '#4caf50', visible: true },
    { ratio: 0.618, color: '#089981', visible: true },
    { ratio: 0.786, color: '#00bcd4', visible: true },
    { ratio: 1.0, color: '#787b86', visible: true },
    { ratio: 1.618, color: '#2962ff', visible: true },
    { ratio: 2.618, color: '#f23645', visible: false },
    { ratio: 3.618, color: '#9c27b0', visible: false },
    { ratio: 4.236, color: '#e91e63', visible: false },
    { ratio: -0.5, color: '#ff9800', visible: false },

    // Column 2 (12 rows)
    { ratio: 0.702, color: '#00897b', visible: false },
    { ratio: 0.886, color: '#2962ff', visible: false },
    { ratio: 1.272, color: '#ff9800', visible: false },
    { ratio: 1.414, color: '#f23645', visible: false },
    { ratio: 2.0, color: '#787b86', visible: false },
    { ratio: 2.272, color: '#089981', visible: false },
    { ratio: 3.0, color: '#787b86', visible: false },
    { ratio: 3.272, color: '#00bcd4', visible: false },
    { ratio: 4.0, color: '#787b86', visible: false },
    { ratio: 4.272, color: '#ab47bc', visible: false },
    { ratio: -0.236, color: '#f23645', visible: false },
    { ratio: -0.618, color: '#089981', visible: false }
  ];

  const FIB_LEVELS = TV_DEFAULT_24_FIB_LEVELS;
  window.TV_DEFAULT_24_FIB_LEVELS = TV_DEFAULT_24_FIB_LEVELS;

  // Standard TradingView Gann Box Levels (Price & Time)
  const TV_DEFAULT_GANN_PRICE_LEVELS = [
    // Column 1 (4 rows)
    { ratio: 0, color: '#00bcd4', visible: true },
    { ratio: 0.382, color: '#00897b', visible: false },
    { ratio: 0.618, color: '#00897b', visible: false },
    { ratio: 1.0, color: '#4caf50', visible: true },
    // Column 2 (3 rows)
    { ratio: 0.25, color: '#ff9800', visible: false },
    { ratio: 0.5, color: '#f23645', visible: true },
    { ratio: 0.75, color: '#089981', visible: false }
  ];

  const TV_DEFAULT_GANN_TIME_LEVELS = [
    // Column 1 (4 rows)
    { ratio: 0, color: '#00bcd4', visible: true },
    { ratio: 0.382, color: '#00897b', visible: false },
    { ratio: 0.618, color: '#089981', visible: false },
    { ratio: 1.0, color: '#787b86', visible: true },
    // Column 2 (3 rows)
    { ratio: 0.25, color: '#ff9800', visible: false },
    { ratio: 0.5, color: '#4caf50', visible: false },
    { ratio: 0.75, color: '#2962ff', visible: false }
  ];

  window.TV_DEFAULT_GANN_PRICE_LEVELS = TV_DEFAULT_GANN_PRICE_LEVELS;
  window.TV_DEFAULT_GANN_TIME_LEVELS = TV_DEFAULT_GANN_TIME_LEVELS;

  function init(chartInstance, seriesInstance, containerElement) {
    chart = chartInstance;
    candleSeries = seriesInstance;
    container = containerElement;

    // Create or locate overlay canvas
    let existingCanvas = container.querySelector('.tv-drawing-canvas');
    if (existingCanvas) existingCanvas.remove();

    canvas = document.createElement('canvas');
    canvas.className = 'tv-drawing-canvas';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = '15';
    canvas.style.pointerEvents = 'none';

    container.style.position = 'relative';
    container.appendChild(canvas);
    ctx = canvas.getContext('2d');

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Synchronize redraw when chart pans or zooms
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      requestAnimationFrame(() => {
        redraw();
        if (selectedDrawing) {
          updateFloatingToolbar();
        }
      });
    });

    if (window.DataFeed && window.DataFeed.getCurrentSymbol) {
      const curSym = window.DataFeed.getCurrentSymbol();
      if (curSym && curSym.id) currentSymbol = curSym.id;
    }

    // Connect Undo / Redo Header Buttons
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    if (btnUndo) {
      btnUndo.addEventListener('click', (e) => {
        e.stopPropagation();
        undo();
      });
    }
    if (btnRedo) {
      btnRedo.addEventListener('click', (e) => {
        e.stopPropagation();
        redo();
      });
    }
    updateUndoRedoUI();

    setupToolbarActions();
    bindEvents();
    loadDrawings();
  }

  function resizeCanvas() {
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    redraw();
  }

  function setTool(toolName) {
    activeTool = toolName;
    if (activeTool !== 'cursor') {
      selectedDrawing = null;
      hideFloatingToolbar();
    }
    if (canvas) {
      if (activeTool === 'cursor') {
        canvas.style.pointerEvents = 'none';
        canvas.style.cursor = 'default';
      } else if (activeTool === 'eraser') {
        canvas.style.pointerEvents = 'auto';
        canvas.style.cursor = 'crosshair';
      } else {
        canvas.style.pointerEvents = 'auto';
        canvas.style.cursor = 'crosshair';
      }
    }
    redraw();
  }

  function setMagnetMode(enabled) {
    magnetMode = enabled;
  }

  function toggleLock(locked) {
    isLocked = locked;
  }

  function toggleHide(hidden) {
    isHidden = hidden;
    if (isHidden) hideFloatingToolbar();
    redraw();
  }

  function clearAllDrawings() {
    if (drawings.length === 0) return;
    pushUndoState();
    drawings = [];
    currentDrawing = null;
    selectedDrawing = null;
    hoverDrawing = null;
    hideFloatingToolbar();
    const cacheKey = `tv_user_drawings_${currentUserId}_${currentSymbol}`;
    try {
      localStorage.removeItem(cacheKey);
      if (currentSymbol === 'XAUUSD' && currentUserId === 'default') {
        localStorage.removeItem('tv_user_drawings');
      }
    } catch (e) {}

    // Clear in SQLite database
    fetch('/api/drawings/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUserId, symbol: currentSymbol })
    }).catch(() => {});

    updateCloudStatus('saved');
    redraw();
    if (activeTool === 'cursor' && canvas) {
      canvas.style.pointerEvents = 'none';
      canvas.style.cursor = 'default';
    }
  }

  function deleteSelectedDrawing() {
    if (selectedDrawing) {
      pushUndoState();
      drawings = drawings.filter(d => d !== selectedDrawing);
      selectedDrawing = null;
      hoverDrawing = null;
      hideFloatingToolbar();
      saveDrawings();
      redraw();
      if (activeTool === 'cursor' && canvas) {
        canvas.style.pointerEvents = 'none';
        canvas.style.cursor = 'default';
      }
    }
  }

  function setDrawingColor(color) {
    if (!selectedDrawing || !color) return;
    pushUndoState();
    selectedDrawing.color = color;
    if (selectedDrawing.fillColor) selectedDrawing.fillColor = color;
    saveDrawings();
    redraw();
    updateFloatingToolbar();
  }

  function setDrawingWidth(width) {
    if (!selectedDrawing) return;
    pushUndoState();
    selectedDrawing.lineWidth = parseInt(width, 10) || 2;
    saveDrawings();
    redraw();
    updateFloatingToolbar();
  }

  function setDrawingStyle(style) {
    if (!selectedDrawing) return;
    pushUndoState();
    selectedDrawing.lineStyle = style; // 'solid', 'dashed', 'dotted'
    saveDrawings();
    redraw();
    updateFloatingToolbar();
  }

  function toggleDrawingLock() {
    if (!selectedDrawing) return;
    pushUndoState();
    selectedDrawing.locked = !selectedDrawing.locked;
    saveDrawings();
    redraw();
    updateFloatingToolbar();
  }

  function openDrawingSettings(d) {
    const target = d || selectedDrawing;
    if (!target) return;
    selectedDrawing = target;
    updateFloatingToolbar();
    redraw();
    if (window.openDrawingSettingsModal) {
      window.openDrawingSettingsModal(target);
    }
  }

  function setupToolbarActions() {
    const toolbar = document.getElementById('tv-drawing-actions');
    if (toolbar) {
      toolbar.addEventListener('mousedown', (e) => e.stopPropagation());
      toolbar.addEventListener('mouseup', (e) => e.stopPropagation());
      toolbar.addEventListener('click', (e) => e.stopPropagation());
    }

    // Duplicate selected button
    const cloneBtn = document.getElementById('btn-draw-clone');
    if (cloneBtn) {
      cloneBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        duplicateSelectedDrawing();
      });
    }

    // Delete selected button
    const delBtn = document.getElementById('btn-delete-drawing');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        deleteSelectedDrawing();
      });
    }

    // Delete all button
    const delAllBtn = document.getElementById('btn-delete-all-drawings');
    if (delAllBtn) {
      delAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        clearAllDrawings();
      });
    }

    // Color Swatch popover trigger & dots
    const colorBtn = document.getElementById('btn-draw-color');
    const colorPalette = document.getElementById('draw-color-palette');
    if (colorBtn && colorPalette) {
      colorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = colorPalette.style.display === 'flex';
        closeAllActionPopovers();
        colorPalette.style.display = isOpen ? 'none' : 'flex';
      });

      colorPalette.querySelectorAll('.color-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          const col = dot.getAttribute('data-color');
          setDrawingColor(col);
          colorPalette.style.display = 'none';
        });
      });
    }

    // Width menu popover trigger & items
    const widthBtn = document.getElementById('btn-draw-width');
    const widthMenu = document.getElementById('draw-width-menu');
    if (widthBtn && widthMenu) {
      widthBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = widthMenu.style.display === 'flex';
        closeAllActionPopovers();
        widthMenu.style.display = isOpen ? 'none' : 'flex';
      });

      widthMenu.querySelectorAll('.popover-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const w = item.getAttribute('data-width');
          setDrawingWidth(w);
          widthMenu.style.display = 'none';
        });
      });
    }

    // Style menu popover trigger & items
    const styleBtn = document.getElementById('btn-draw-style');
    const styleMenu = document.getElementById('draw-style-menu');
    if (styleBtn && styleMenu) {
      styleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = styleMenu.style.display === 'flex';
        closeAllActionPopovers();
        styleMenu.style.display = isOpen ? 'none' : 'flex';
      });

      styleMenu.querySelectorAll('.popover-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const s = item.getAttribute('data-style');
          setDrawingStyle(s);
          styleMenu.style.display = 'none';
        });
      });
    }

    // Lock toggle button
    const lockBtn = document.getElementById('btn-draw-lock');
    if (lockBtn) {
      lockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDrawingLock();
      });
    }

    // Settings Cog button
    const settingsBtn = document.getElementById('btn-draw-settings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDrawingSettings(selectedDrawing);
      });
    }

    // Close popovers on outer click
    document.addEventListener('click', () => {
      closeAllActionPopovers();
    });
  }

  function closeAllActionPopovers() {
    const p1 = document.getElementById('draw-color-palette');
    const p2 = document.getElementById('draw-width-menu');
    const p3 = document.getElementById('draw-style-menu');
    if (p1) p1.style.display = 'none';
    if (p2) p2.style.display = 'none';
    if (p3) p3.style.display = 'none';
  }

  function updateFloatingToolbar() {
    const toolbar = document.getElementById('tv-drawing-actions');
    const label = document.getElementById('tv-drawing-type-label');
    const delAllBtn = document.getElementById('btn-delete-all-drawings');
    const delAllLabel = document.getElementById('btn-delete-all-label');

    if (!toolbar || !selectedDrawing || isHidden) {
      hideFloatingToolbar();
      return;
    }

    const p1 = priceTimeToCoordinate(selectedDrawing.p1.time, selectedDrawing.p1.price);
    const p2 = priceTimeToCoordinate(selectedDrawing.p2.time, selectedDrawing.p2.price);
    if (!p1 || !p2) {
      hideFloatingToolbar();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    let posX = (p1.x + p2.x) / 2;
    let posY = Math.min(p1.y, p2.y) - 38;

    if (selectedDrawing.type === 'long_pos' || selectedDrawing.type === 'short_pos') {
      posX = Math.min(p1.x, p2.x) + 30;
      posY = p1.y - 42;
    }

    const clampX = Math.max(65, Math.min(posX, rect.width - 320));
    const clampY = Math.max(25, Math.min(posY, rect.height - 45));

    toolbar.style.left = `${clampX}px`;
    toolbar.style.top = `${clampY}px`;
    toolbar.style.display = 'flex';

    // Update color preview
    const colPrev = document.getElementById('draw-color-preview');
    if (colPrev) colPrev.style.backgroundColor = selectedDrawing.color || '#2962ff';

    // Update width preview
    const widthPrev = document.getElementById('draw-width-preview');
    if (widthPrev) widthPrev.style.height = `${selectedDrawing.lineWidth || 2}px`;

    // Update style preview
    const stylePrev = document.getElementById('draw-style-preview');
    if (stylePrev) {
      const s = selectedDrawing.lineStyle;
      stylePrev.textContent = s === 'dashed' ? '- -' : (s === 'dotted' ? '···' : '——');
    }

    // Update lock button state
    const lockBtn = document.getElementById('btn-draw-lock');
    if (lockBtn) {
      lockBtn.classList.toggle('active', !!selectedDrawing.locked);
      lockBtn.style.color = selectedDrawing.locked ? '#f23645' : '';
    }

    if (delAllBtn) {
      if (drawings.length > 1) {
        delAllBtn.style.display = 'flex';
        if (delAllLabel) delAllLabel.textContent = `Clear All (${drawings.length})`;
      } else {
        delAllBtn.style.display = 'none';
      }
    }

    if (label) {
      const labels = {
        trendline: 'Trendline',
        ray: 'Ray',
        info_line: 'Info line',
        extended_line: 'Extended line',
        trend_angle: 'Trend angle',
        hray: 'Horizontal Ray',
        hline: 'Horizontal Line',
        vline: 'Vertical Line',
        crossline: 'Crossline',
        fib: 'Fib Retracement',
        fib_ext: 'Trend-based Fib Extension',
        fib_channel: 'Fib Channel',
        fib_time: 'Fib Time Zone',
        fib_fan: 'Fib Speed Resistance Fan',
        fib_trend_time: 'Trend-based Fib Time',
        fib_circles: 'Fib Circles',
        fib_spiral: 'Fib Spiral',
        fib_arcs: 'Fib Speed Resistance Arcs',
        fib_wedge: 'Fib Wedge',
        pitchfan: 'Pitchfan',
        gann_box: 'Gann Box',
        gann_sq_fixed: 'Gann Square Fixed',
        gann_square: 'Gann Square',
        gann_fan: 'Gann Fan',
        rectangle: 'Order Block (OB)',
        long_pos: 'Long Position',
        short_pos: 'Short Position',
        text: 'Text Note',
        patterns: 'SMC Pattern',
        stickers: 'Sticker',
        measure: 'Measure'
      };
      label.textContent = labels[selectedDrawing.type] || 'Drawing';
    }
  }

  function hideFloatingToolbar() {
    const toolbar = document.getElementById('tv-drawing-actions');
    if (toolbar) toolbar.style.display = 'none';
    closeAllActionPopovers();
  }

  /**
   * Converts mouse pixel event to Chart Price & Time with future whitespace extrapolation
   */
  function coordinateToPriceTime(x, y, ignoreMagnet = false) {
    if (!chart || !candleSeries) return null;
    const timeScale = chart.timeScale();
    let time = timeScale.coordinateToTime(x);
    if (time === null && window.DataFeed) {
      const candles = window.DataFeed.getLiveCandles();
      if (candles && candles.length > 1) {
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const lastX = timeScale.timeToCoordinate(last.time);
        const prevX = timeScale.timeToCoordinate(prev.time);
        if (lastX !== null && prevX !== null && lastX !== prevX) {
          const barW = lastX - prevX;
          const dt = last.time - prev.time;
          const offset = (x - lastX) / barW;
          time = Math.round(last.time + offset * dt);
        }
      }
    }
    let price = candleSeries.coordinateToPrice(y);
    if (price === null) return null;

    // TradingView Magnet Mode: Snap to nearest candle OHLC price & exact timestamp
    if (magnetMode && !ignoreMagnet && window.DataFeed) {
      const candles = window.DataFeed.getLiveCandles();
      if (candles && candles.length > 0 && time !== null) {
        let nearest = null;
        let minDist = Infinity;
        for (let i = 0; i < candles.length; i++) {
          const d = Math.abs(candles[i].time - time);
          if (d < minDist) {
            minDist = d;
            nearest = candles[i];
          }
        }
        if (nearest) {
          const ohlc = [nearest.open, nearest.high, nearest.low, nearest.close];
          let bestPrice = nearest.close;
          let minPriceDiff = Infinity;
          for (const p of ohlc) {
            const diff = Math.abs(p - price);
            if (diff < minPriceDiff) {
              minPriceDiff = diff;
              bestPrice = p;
            }
          }
          price = bestPrice;
          time = nearest.time;
        }
      }
    }

    return { time, price };
  }

  /**
   * Converts Price & Time to Canvas Pixel (X, Y) with future whitespace extrapolation
   */
  function priceTimeToCoordinate(time, price) {
    if (!chart || !candleSeries) return null;
    const timeScale = chart.timeScale();
    let x = timeScale.timeToCoordinate(time);
    if (x === null && window.DataFeed) {
      const candles = window.DataFeed.getLiveCandles();
      if (candles && candles.length > 1) {
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2];
        const lastX = timeScale.timeToCoordinate(last.time);
        const prevX = timeScale.timeToCoordinate(prev.time);
        if (lastX !== null && prevX !== null && lastX !== prevX) {
          const barW = lastX - prevX;
          const dt = last.time - prev.time;
          const diff = time - last.time;
          x = lastX + (diff / dt) * barW;
        }
      }
    }
    const y = candleSeries.priceToCoordinate(price);
    if (x === null || y === null || isNaN(x) || isNaN(y)) return null;
    return { x, y };
  }

  /**
   * Helper to draw TradingView-style circular handle puck
   */
  function drawCustomHandle(x, y, color = '#2962ff') {
    if (x === null || y === null || isNaN(x) || isNaN(y)) return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Returns list of interactive handles for a drawing
   */
  function getDrawingHandles(d) {
    if (!d || !d.p1 || !d.p2) return [];
    const handles = [];
    const p1 = priceTimeToCoordinate(d.p1.time, d.p1.price);
    const p2 = priceTimeToCoordinate(d.p2.time, d.p2.price);
    if ((d.type === 'long_pos' || d.type === 'short_pos') && p1 && p2 && candleSeries) {
      const isLong = d.type === 'long_pos';
      const entryPrice = d.p1.price;
      const defaultDelta = entryPrice * 0.0015;
      const stopPrice = d.stopPrice !== undefined ? d.stopPrice : (isLong ? entryPrice - defaultDelta : entryPrice + defaultDelta);
      const targetPrice = d.targetPrice !== undefined ? d.targetPrice : (isLong ? entryPrice + defaultDelta * 2 : entryPrice - defaultDelta * 2);

      const leftX = Math.min(p1.x, p2.x);
      const width = Math.max(90, Math.abs(p2.x - p1.x));
      const rightX = leftX + width;
      const midX = (leftX + rightX) / 2;
      const entryY = p1.y;

      const stopCoord = candleSeries.priceToCoordinate(stopPrice);
      const targetCoord = candleSeries.priceToCoordinate(targetPrice);
      const stopY = stopCoord !== null ? stopCoord : (isLong ? entryY + 45 : entryY - 45);
      const targetY = targetCoord !== null ? targetCoord : (isLong ? entryY - 90 : entryY + 90);

      handles.push({ id: 'target', x: midX, y: targetY, d });
      handles.push({ id: 'stop', x: midX, y: stopY, d });
      handles.push({ id: 'p2', x: rightX, y: entryY, d });
      handles.push({ id: 'p1', x: leftX, y: entryY, d });
      return handles;
    }

    if (d.type === 'gann_box' && p1 && p2) {
      handles.push({ id: 'p1', x: p1.x, y: p1.y, d });
      handles.push({ id: 'p2', x: p2.x, y: p2.y, d });
      handles.push({ id: 'c1', x: p1.x, y: p2.y, d });
      handles.push({ id: 'c2', x: p2.x, y: p1.y, d });
      return handles;
    }

    if (p1) handles.push({ id: 'p1', x: p1.x, y: p1.y, d });
    if (p2) handles.push({ id: 'p2', x: p2.x, y: p2.y, d });
    if (d.p3) {
      const p3 = priceTimeToCoordinate(d.p3.time, d.p3.price);
      if (p3) handles.push({ id: 'p3', x: p3.x, y: p3.y, d });
    }
    return handles;
  }

  function findHandleAt(x, y) {
    // Check handles of selected drawing first
    const list = selectedDrawing ? [selectedDrawing, ...drawings.filter(d => d !== selectedDrawing)] : drawings;
    for (const d of list) {
      const handles = getDrawingHandles(d);
      for (const h of handles) {
        if (Math.hypot(x - h.x, y - h.y) <= 12) {
          return h;
        }
      }
    }
    return null;
  }

  function bindEvents() {
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('contextmenu', handleContextMenu);
    canvas.addEventListener('dblclick', handleDoubleClick);

    // Track mouse on chart viewport to activate canvas pointer events when hovering over drawings
    if (container) {
      container.addEventListener('mousemove', handleContainerMouseMove);
    }

    window.addEventListener('keydown', (e) => {
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        return;
      }

      // Ctrl + Z -> Undo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl + Y or Ctrl + Shift + Z -> Redo
      if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        redo();
        return;
      }

      // Ctrl + D -> Duplicate selected drawing
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelectedDrawing();
        return;
      }

      // Ctrl + Shift + S -> Copy chart image to clipboard
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (window.copyChartImageToClipboard) {
          window.copyChartImageToClipboard();
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedDrawing) {
          e.preventDefault();
          deleteSelectedDrawing();
        } else if (hoverDrawing) {
          e.preventDefault();
          selectedDrawing = hoverDrawing;
          deleteSelectedDrawing();
        }
      }
      if (e.key === 'Escape') {
        currentDrawing = null;
        isDrawing = false;
        drawStep = 0;
        isDraggingDrawing = false;
        selectedDrawing = null;
        hideFloatingToolbar();
        if (window.selectDrawingTool) {
          window.selectDrawingTool('cursor');
        } else {
          setTool('cursor');
        }
        if (canvas) {
          canvas.style.pointerEvents = 'none';
          canvas.style.cursor = 'default';
        }
        redraw();
      }
    });
  }

  function handleDoubleClick(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = findDrawingAt(x, y);
    if (hit) {
      selectedDrawing = hit;
      updateFloatingToolbar();
      redraw();
      openDrawingSettings(hit);
    }
  }

  function handleContainerMouseMove(e) {
    if (isDrawing || isDraggingDrawing || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;

    const handleHit = findHandleAt(x, y);
    const bodyHit = findDrawingAt(x, y);

    if (handleHit) {
      canvas.style.pointerEvents = 'auto';
      const isPos = handleHit.d && (handleHit.d.type === 'long_pos' || handleHit.d.type === 'short_pos');
      if (isPos && (handleHit.id === 'target' || handleHit.id === 'stop')) {
        canvas.style.cursor = 'ns-resize';
      } else if (isPos && handleHit.id === 'p2') {
        canvas.style.cursor = 'ew-resize';
      } else {
        canvas.style.cursor = 'move';
      }
    } else if (bodyHit) {
      canvas.style.pointerEvents = 'auto';
      canvas.style.cursor = 'grab';
      if (hoverDrawing !== bodyHit) {
        hoverDrawing = bodyHit;
        redraw();
      }
    } else if (!selectedDrawing && activeTool === 'cursor') {
      canvas.style.pointerEvents = 'none';
      canvas.style.cursor = 'default';
      if (hoverDrawing) {
        hoverDrawing = null;
        redraw();
      }
    }
  }

  function handleContextMenu(e) {
    if (isDrawing) {
      e.preventDefault();
      currentDrawing = null;
      isDrawing = false;
      drawStep = 0;
      if (!stayInDrawingMode) {
        if (window.selectDrawingTool) window.selectDrawingTool('cursor');
        else setTool('cursor');
      }
      redraw();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = findDrawingAt(x, y);
    if (hit) {
      selectedDrawing = hit;
      updateFloatingToolbar();
      redraw();
    }
  }

  function handleMouseDown(e) {
    if (isLocked || isHidden) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (activeTool === 'eraser') {
      const hit = findDrawingAt(x, y);
      if (hit) {
        pushUndoState();
        drawings = drawings.filter(d => d !== hit);
        if (selectedDrawing === hit) {
          selectedDrawing = null;
          hideFloatingToolbar();
        }
        saveDrawings();
        redraw();
      }
      return;
    }

    // 1. Check if user clicked an anchor handle of any drawing (only in cursor mode or on selected drawing)
    const handleHit = findHandleAt(x, y);
    if (handleHit && !handleHit.d.locked && (activeTool === 'cursor' || selectedDrawing === handleHit.d)) {
      dragSnapshot = JSON.stringify(drawings);
      selectedDrawing = handleHit.d;
      isDraggingDrawing = true;
      dragMode = 'handle';
      dragHandle = handleHit;
      dragDrawing = handleHit.d;
      dragStartPt = coordinateToPriceTime(x, y);
      const isPos = handleHit.d && (handleHit.d.type === 'long_pos' || handleHit.d.type === 'short_pos');
      if (isPos && (handleHit.id === 'target' || handleHit.id === 'stop')) {
        canvas.style.cursor = 'ns-resize';
      } else if (isPos && handleHit.id === 'p2') {
        canvas.style.cursor = 'ew-resize';
      } else {
        canvas.style.cursor = 'move';
      }
      canvas.style.pointerEvents = 'auto';
      updateFloatingToolbar();
      redraw();
      return;
    }

    // 2. Check if user clicked the body of an existing drawing (only in cursor mode)
    const bodyHit = findDrawingAt(x, y);
    if (bodyHit && (activeTool === 'cursor' || selectedDrawing === bodyHit)) {
      selectedDrawing = bodyHit;
      updateFloatingToolbar();

      if (!bodyHit.locked && activeTool === 'cursor') {
        dragSnapshot = JSON.stringify(drawings);
        isDraggingDrawing = true;
        dragMode = 'body';
        dragDrawing = bodyHit;
        dragStartPt = coordinateToPriceTime(x, y);
        dragInitialPoints = {
          p1: { time: bodyHit.p1.time, price: bodyHit.p1.price },
          p2: { time: bodyHit.p2.time, price: bodyHit.p2.price },
          p3: bodyHit.p3 ? { time: bodyHit.p3.time, price: bodyHit.p3.price } : null,
          stopPrice: bodyHit.stopPrice,
          targetPrice: bodyHit.targetPrice
        };
        canvas.style.cursor = 'grabbing';
        canvas.style.pointerEvents = 'auto';
      }
      redraw();
      return;
    }

    // 3. Cursor mode clicking empty space -> deselect
    if (activeTool === 'cursor') {
      selectedDrawing = null;
      hideFloatingToolbar();
      canvas.style.pointerEvents = 'none';
      canvas.style.cursor = 'default';
      redraw();
      return;
    }

    // 4. Two-Click / Three-Click Mode: If a drawing was already in progress, advance or finalize it!
    if (isDrawing && currentDrawing) {
      const pt = coordinateToPriceTime(x, y);
      if (pt && pt.time !== null && pt.price !== null) {
        const isThreePointTool = ['fib_ext', 'fib_channel', 'pitchfan'].includes(currentDrawing.type);
        if (isThreePointTool && drawStep === 1) {
          // Point 2 placed; now waiting for Point 3!
          currentDrawing.p2 = { time: pt.time, price: pt.price };
          currentDrawing.p3 = { time: pt.time, price: pt.price };
          drawStep = 2;
          redraw();
          return;
        }

        if (isThreePointTool && drawStep === 2) {
          currentDrawing.p3 = { time: pt.time, price: pt.price };
        } else {
          currentDrawing.p2 = { time: pt.time, price: pt.price };
        }

        pushUndoState();
        drawings.push(currentDrawing);
        selectedDrawing = currentDrawing;
        saveDrawings();
        updateFloatingToolbar();
      }
      currentDrawing = null;
      isDrawing = false;
      drawStep = 0;
      if (!stayInDrawingMode) {
        if (window.selectDrawingTool) {
          window.selectDrawingTool('cursor');
        } else {
          setTool('cursor');
        }
      }
      redraw();
      return;
    }

    // 5. Initiating a NEW drawing
    const pt = coordinateToPriceTime(x, y);
    if (!pt || pt.time === null || pt.price === null) return;

    // Instant TradingView Single-Click Placement for 1-Click Tools
    if (['hline', 'hray', 'vline', 'crossline', 'long_pos', 'short_pos', 'text', 'stickers'].includes(activeTool)) {
      let newDrawing = null;
      if (activeTool === 'long_pos' || activeTool === 'short_pos') {
        const isLong = activeTool === 'long_pos';
        const candles = window.DataFeed ? window.DataFeed.getLiveCandles() : null;
        const interval = (candles && candles.length > 1) ? (candles[1].time - candles[0].time) : 300;
        // TradingView standard: ~10 bars width, clean & easy to view
        const futureTime = pt.time + interval * 10;

        let stopPrice = null;
        let targetPrice = null;

        // TradingView-style dynamic screen pixel scaling:
        // Stop loss: ~45px, Target: ~90px (exact 2.0 Risk-to-Reward ratio on current screen)
        if (candleSeries && canvas) {
          const testY = Math.max(20, Math.min(canvas.height - 20, y));
          const refY = (testY + 45 <= canvas.height) ? (testY + 45) : (testY - 45);
          const pEntry = candleSeries.coordinateToPrice(testY);
          const pRef = candleSeries.coordinateToPrice(refY);

          if (pEntry !== null && pRef !== null && Math.abs(refY - testY) > 0) {
            const pricePerPx = Math.abs(pRef - pEntry) / Math.abs(refY - testY);
            const stopDelta = pricePerPx * 45;
            const targetDelta = pricePerPx * 90;

            stopPrice = isLong ? (pt.price - stopDelta) : (pt.price + stopDelta);
            targetPrice = isLong ? (pt.price + targetDelta) : (pt.price - targetDelta);
          }
        }

        // Robust fallback using ATR-10 or sensible tick distance
        if (!stopPrice || !targetPrice || isNaN(stopPrice) || isNaN(targetPrice)) {
          let avgRange = 0;
          if (candles && candles.length > 0) {
            const sample = candles.slice(-10);
            for (const c of sample) avgRange += Math.abs(c.high - c.low);
            avgRange = avgRange / sample.length;
          }
          if (!avgRange || avgRange <= 0) {
            avgRange = pt.price * 0.0015;
          }
          const stopDelta = avgRange * 1.5;
          const targetDelta = stopDelta * 2.0;
          stopPrice = isLong ? (pt.price - stopDelta) : (pt.price + stopDelta);
          targetPrice = isLong ? (pt.price + targetDelta) : (pt.price - targetDelta);
        }

        const precision = pt.price >= 100 ? 2 : (pt.price >= 1 ? 4 : 5);
        stopPrice = Number(stopPrice.toFixed(precision));
        targetPrice = Number(targetPrice.toFixed(precision));

        newDrawing = {
          id: Date.now().toString(),
          type: activeTool,
          p1: { time: pt.time, price: pt.price },
          p2: { time: futureTime, price: pt.price },
          stopPrice: stopPrice,
          targetPrice: targetPrice,
          color: isLong ? '#089981' : '#f23645',
          lineWidth: 1.5,
          lineStyle: 'solid',
          fillEnabled: true,
          locked: false
        };
      } else if (activeTool === 'hline') {
        newDrawing = {
          id: Date.now().toString(),
          type: 'hline',
          p1: { time: pt.time, price: pt.price },
          p2: { time: pt.time + 3600, price: pt.price },
          color: '#2962ff',
          lineWidth: 2,
          lineStyle: 'solid',
          locked: false
        };
      } else if (activeTool === 'hray') {
        newDrawing = {
          id: Date.now().toString(),
          type: 'hray',
          p1: { time: pt.time, price: pt.price },
          p2: { time: pt.time + 3600, price: pt.price },
          color: '#2962ff',
          lineWidth: 2,
          lineStyle: 'solid',
          locked: false
        };
      } else if (activeTool === 'vline') {
        newDrawing = {
          id: Date.now().toString(),
          type: 'vline',
          p1: { time: pt.time, price: pt.price },
          p2: { time: pt.time, price: pt.price },
          color: '#2962ff',
          lineWidth: 2,
          lineStyle: 'solid',
          locked: false
        };
      } else if (activeTool === 'crossline') {
        newDrawing = {
          id: Date.now().toString(),
          type: 'crossline',
          p1: { time: pt.time, price: pt.price },
          p2: { time: pt.time, price: pt.price },
          color: '#2962ff',
          lineWidth: 1.5,
          lineStyle: 'solid',
          locked: false
        };
      } else if (activeTool === 'text') {
        newDrawing = {
          id: Date.now().toString(),
          type: 'text',
          p1: { time: pt.time, price: pt.price },
          p2: { time: pt.time, price: pt.price },
          color: '#2962ff',
          text: 'Analysis Note',
          locked: false
        };
      } else if (activeTool === 'stickers') {
        newDrawing = {
          id: Date.now().toString(),
          type: 'stickers',
          p1: { time: pt.time, price: pt.price },
          p2: { time: pt.time, price: pt.price },
          color: '#2962ff',
          locked: false
        };
      }

      if (newDrawing) {
        pushUndoState();
        drawings.push(newDrawing);
        selectedDrawing = newDrawing;
        saveDrawings();
        updateFloatingToolbar();
        redraw();

        if (activeTool === 'text') {
          openDrawingSettings(newDrawing);
        }

        if (!stayInDrawingMode) {
          if (window.selectDrawingTool) {
            window.selectDrawingTool('cursor');
          } else {
            setTool('cursor');
          }
        }
        return;
      }
    }

    // Other multi-point tools (Fibonacci, Lines, Box, etc.)
    mouseDownStartPos = { x, y };
    isDrawing = true;
    drawStep = 1;
    currentDrawing = {
      id: Date.now().toString(),
      type: activeTool,
      p1: { time: pt.time, price: pt.price },
      p2: { time: pt.time, price: pt.price },
      p3: { time: pt.time, price: pt.price },
      color: '#2962ff',
      lineWidth: 2,
      lineStyle: 'solid',
      fillEnabled: true,
      fillColor: '#2962ff',
      fillOpacity: 20,
      locked: false,
      text: ''
    };

    if (activeTool === 'rectangle') {
      currentDrawing.color = '#089981';
      currentDrawing.fillColor = '#089981';
      currentDrawing.label = 'Order Block';
    } else if (activeTool === 'fib') {
      currentDrawing.fibLevels = JSON.parse(JSON.stringify(TV_DEFAULT_24_FIB_LEVELS));
      currentDrawing.showTrendLine = true;
      currentDrawing.trendLineColor = 'rgba(209, 212, 220, 0.65)';
      currentDrawing.trendLineWidth = 1.2;
      currentDrawing.trendLineStyle = 'dashed';
      currentDrawing.levelLineWidth = 1;
      currentDrawing.levelLineStyle = 'solid';
      currentDrawing.extendMode = 'none';
      currentDrawing.useOneColor = false;
      currentDrawing.oneColor = '#00897b';
      currentDrawing.fillEnabled = true;
      currentDrawing.fillOpacity = 20;
      currentDrawing.reverse = false;
      currentDrawing.showPrices = true;
      currentDrawing.showLevels = true;
      currentDrawing.levelsFormat = 'values';
      currentDrawing.labelHorz = 'left';
      currentDrawing.labelVert = 'middle';
      currentDrawing.showText = true;
      currentDrawing.textHorz = 'center';
      currentDrawing.textVert = 'middle';
      currentDrawing.fontSize = 12;
      currentDrawing.logScale = false;
    } else if (activeTool === 'gann_box') {
      currentDrawing.priceLevels = JSON.parse(JSON.stringify(TV_DEFAULT_GANN_PRICE_LEVELS));
      currentDrawing.timeLevels = JSON.parse(JSON.stringify(TV_DEFAULT_GANN_TIME_LEVELS));
      currentDrawing.leftLabels = true;
      currentDrawing.rightLabels = true;
      currentDrawing.priceBgEnabled = true;
      currentDrawing.priceBgOpacity = 20;
      currentDrawing.topLabels = false;
      currentDrawing.bottomLabels = true;
      currentDrawing.timeBgEnabled = true;
      currentDrawing.timeBgOpacity = 20;
      currentDrawing.useOneColor = false;
      currentDrawing.oneColor = '#00bcd4';
      currentDrawing.angles = false;
      currentDrawing.anglesColor = '#787b86';
      currentDrawing.reverse = false;
      currentDrawing.lineWidth = 1;
      currentDrawing.lineStyle = 'solid';
    } else if (activeTool.startsWith('fib') || activeTool.startsWith('gann') || activeTool === 'pitchfan') {
      currentDrawing.fibLevels = JSON.parse(JSON.stringify(TV_DEFAULT_24_FIB_LEVELS));
    }
  }

  function handleMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // 1. Moving an existing drawing (Handle or Body translation)
    if (isDraggingDrawing && dragDrawing) {
      const pt = coordinateToPriceTime(x, y);
      if (!pt || pt.time === null || pt.price === null) return;

      if (dragMode === 'handle' && dragHandle) {
        if (dragHandle.id === 'p1') {
          if (dragDrawing.type === 'long_pos' || dragDrawing.type === 'short_pos') {
            const deltaPrice = pt.price - dragDrawing.p1.price;
            dragDrawing.p1.time = pt.time;
            dragDrawing.p1.price = pt.price;
            if (dragDrawing.stopPrice !== undefined) dragDrawing.stopPrice += deltaPrice;
            if (dragDrawing.targetPrice !== undefined) dragDrawing.targetPrice += deltaPrice;
          } else {
            dragDrawing.p1.time = pt.time;
            dragDrawing.p1.price = pt.price;
          }
        } else if (dragHandle.id === 'p2') {
          dragDrawing.p2.time = pt.time;
          if (dragDrawing.type !== 'long_pos' && dragDrawing.type !== 'short_pos') {
            dragDrawing.p2.price = pt.price;
          }
        } else if (dragHandle.id === 'p3' && dragDrawing.p3) {
          dragDrawing.p3.time = pt.time;
          dragDrawing.p3.price = pt.price;
        } else if (dragHandle.id === 'c1') {
          dragDrawing.p1.time = pt.time;
          dragDrawing.p2.price = pt.price;
        } else if (dragHandle.id === 'c2') {
          dragDrawing.p2.time = pt.time;
          dragDrawing.p1.price = pt.price;
        } else if (dragHandle.id === 'target') {
          const isLong = dragDrawing.type === 'long_pos';
          const entryPrice = dragDrawing.p1.price;
          const minStep = entryPrice >= 100 ? 0.05 : (entryPrice >= 1 ? 0.001 : 0.00005);
          if (isLong) {
            dragDrawing.targetPrice = Math.max(pt.price, entryPrice + minStep);
          } else {
            dragDrawing.targetPrice = Math.min(pt.price, entryPrice - minStep);
          }
        } else if (dragHandle.id === 'stop') {
          const isLong = dragDrawing.type === 'long_pos';
          const entryPrice = dragDrawing.p1.price;
          const minStep = entryPrice >= 100 ? 0.05 : (entryPrice >= 1 ? 0.001 : 0.00005);
          if (isLong) {
            dragDrawing.stopPrice = Math.min(pt.price, entryPrice - minStep);
          } else {
            dragDrawing.stopPrice = Math.max(pt.price, entryPrice + minStep);
          }
        }
        redraw();
        updateFloatingToolbar();
        return;
      } else if (dragMode === 'body' && dragInitialPoints && dragStartPt) {
        // Smooth translation math across both price and time
        const deltaPrice = pt.price - dragStartPt.price;
        const deltaTime = pt.time - dragStartPt.time;

        dragDrawing.p1.price = dragInitialPoints.p1.price + deltaPrice;
        dragDrawing.p1.time = dragInitialPoints.p1.time + deltaTime;
        dragDrawing.p2.price = dragInitialPoints.p2.price + deltaPrice;
        dragDrawing.p2.time = dragInitialPoints.p2.time + deltaTime;

        if (dragDrawing.p3 && dragInitialPoints.p3) {
          dragDrawing.p3.price = dragInitialPoints.p3.price + deltaPrice;
          dragDrawing.p3.time = dragInitialPoints.p3.time + deltaTime;
        }
        if (dragDrawing.stopPrice !== undefined && dragInitialPoints.stopPrice !== undefined) {
          dragDrawing.stopPrice = dragInitialPoints.stopPrice + deltaPrice;
        }
        if (dragDrawing.targetPrice !== undefined && dragInitialPoints.targetPrice !== undefined) {
          dragDrawing.targetPrice = dragInitialPoints.targetPrice + deltaPrice;
        }

        redraw();
        updateFloatingToolbar();
        return;
      }
    }

    // 2. Creating a new drawing in progress (live preview following cursor!)
    if (isDrawing && currentDrawing) {
      const pt = coordinateToPriceTime(x, y);
      if (pt && pt.time !== null && pt.price !== null) {
        if (drawStep === 2) {
          currentDrawing.p3 = { time: pt.time, price: pt.price };
        } else {
          currentDrawing.p2 = { time: pt.time, price: pt.price };
          if (currentDrawing.p3) {
            currentDrawing.p3 = { time: pt.time, price: pt.price };
          }
        }
        redraw();
      }
      return;
    }

    // 3. Hover testing when not dragging
    const handleHit = findHandleAt(x, y);
    if (handleHit) {
      const isPos = handleHit.d && (handleHit.d.type === 'long_pos' || handleHit.d.type === 'short_pos');
      if (isPos && (handleHit.id === 'target' || handleHit.id === 'stop')) {
        canvas.style.cursor = 'ns-resize';
      } else if (isPos && handleHit.id === 'p2') {
        canvas.style.cursor = 'ew-resize';
      } else {
        canvas.style.cursor = 'move';
      }
      return;
    }

    const hit = findDrawingAt(x, y);
    if (hit) {
      canvas.style.cursor = 'grab';
      if (hit !== hoverDrawing) {
        hoverDrawing = hit;
        redraw();
      }
    } else {
      if (activeTool === 'cursor') {
        canvas.style.cursor = 'default';
      } else {
        canvas.style.cursor = 'crosshair';
      }
      if (hoverDrawing) {
        hoverDrawing = null;
        redraw();
      }
    }
  }

  function handleMouseUp(e) {
    // If was dragging an existing drawing
    if (isDraggingDrawing) {
      isDraggingDrawing = false;
      dragMode = null;
      dragHandle = null;
      dragDrawing = null;
      dragInitialPoints = null;
      dragStartPt = null;
      if (dragSnapshot && dragSnapshot !== JSON.stringify(drawings)) {
        undoHistory.push(dragSnapshot);
        if (undoHistory.length > MAX_HISTORY) undoHistory.shift();
        redoHistory.length = 0;
        updateUndoRedoUI();
      }
      dragSnapshot = null;
      saveDrawings();
      redraw();
      updateFloatingToolbar();
      return;
    }

    // If was creating a new drawing
    if (isDrawing && currentDrawing) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dragDist = mouseDownStartPos ? Math.hypot(x - mouseDownStartPos.x, y - mouseDownStartPos.y) : 0;

      const isThreePointTool = ['fib_ext', 'fib_channel', 'pitchfan'].includes(currentDrawing.type);

      // If user dragged more than 15px, finalize immediately on release (Click-and-Drag mode for 2-point tools)
      if (dragDist > 15 && !isThreePointTool) {
        const pt = coordinateToPriceTime(x, y);
        if (pt && pt.time !== null && pt.price !== null) {
          currentDrawing.p2 = { time: pt.time, price: pt.price };

          pushUndoState();
          drawings.push(currentDrawing);
          selectedDrawing = currentDrawing;
          saveDrawings();
          updateFloatingToolbar();
        }

        currentDrawing = null;
        isDrawing = false;
        drawStep = 0;
        if (!stayInDrawingMode) {
          if (window.selectDrawingTool) {
            window.selectDrawingTool('cursor');
          } else {
            setTool('cursor');
          }
        }
        redraw();
      } else {
        // Single click: keep isDrawing = true for Two-Click / Three-Click Mode!
        // The live preview continues to follow mouse until second click in handleMouseDown!
      }
    }
  }

  function findDrawingAt(x, y) {
    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i];
      const p1 = priceTimeToCoordinate(d.p1.time, d.p1.price);
      const p2 = priceTimeToCoordinate(d.p2.time, d.p2.price);
      if (!p1 || !p2) continue;

      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);

      // Line tools
      if (['trendline', 'info_line', 'fib_channel'].includes(d.type)) {
        if (distToSegment({ x, y }, p1, p2) < 14) return d;
      } else if (d.type === 'ray') {
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const farX = p1.x + Math.cos(angle) * 4000;
        const farY = p1.y + Math.sin(angle) * 4000;
        if (distToSegment({ x, y }, p1, { x: farX, y: farY }) < 14) return d;
      } else if (d.type === 'extended_line') {
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const x1 = p1.x - Math.cos(angle) * 4000;
        const y1 = p1.y - Math.sin(angle) * 4000;
        const x2 = p1.x + Math.cos(angle) * 4000;
        const y2 = p1.y + Math.sin(angle) * 4000;
        if (distToSegment({ x, y }, { x: x1, y: y1 }, { x: x2, y: y2 }) < 14) return d;
      } else if (d.type === 'trend_angle') {
        const dist1 = distToSegment({ x, y }, p1, p2);
        const baseLen = Math.max(70, Math.abs(p2.x - p1.x));
        const dist2 = distToSegment({ x, y }, p1, { x: p1.x + (p2.x >= p1.x ? baseLen : -baseLen), y: p1.y });
        if (dist1 < 14 || dist2 < 14) return d;
      } else if (d.type === 'hray') {
        if (Math.abs(y - p1.y) < 14 && x >= minX - 15) return d;
      } else if (d.type === 'hline') {
        if (Math.abs(y - p1.y) < 14) return d;
      } else if (d.type === 'vline') {
        if (Math.abs(x - p1.x) < 14) return d;
      } else if (d.type === 'crossline') {
        if (Math.abs(x - p1.x) < 14 || Math.abs(y - p1.y) < 14) return d;
      }

      // Fibonacci Retracement (100% TradingView exact hit testing)
      else if (d.type === 'fib') {
        const chartWidth = canvas ? (canvas.width / (window.devicePixelRatio || 1)) : 2000;
        const leftX = Math.min(p1.x, p2.x);
        const rightX = Math.max(p1.x, p2.x);
        let lineStartX = leftX;
        let lineEndX = rightX;
        const ext = d.extendMode || 'none';
        if (ext === 'right') lineEndX = chartWidth;
        else if (ext === 'left') lineStartX = 0;
        else if (ext === 'both') { lineStartX = 0; lineEndX = chartWidth; }

        const isRev = d.reverse === true;
        const basePrice = isRev ? d.p2.price : d.p1.price;
        const priceRange = isRev ? (d.p1.price - d.p2.price) : (d.p2.price - d.p1.price);
        const levels = (d.fibLevels && d.fibLevels.length) ? d.fibLevels : TV_DEFAULT_24_FIB_LEVELS;

        // Check diagonal swing line between P1 and P2
        if (d.showTrendLine !== false && distToSegment({ x, y }, p1, p2) < 14) return d;

        // Check horizontal level lines
        for (const level of levels) {
          if (level.visible === false) continue;
          const ratio = parseFloat(level.ratio);
          if (isNaN(ratio)) continue;
          const lvlPrice = basePrice + (priceRange * ratio);
          const coord = candleSeries ? candleSeries.priceToCoordinate(lvlPrice) : null;
          const ly = coord !== null ? coord : p1.y + (p2.y - p1.y) * ratio;
          if (x >= lineStartX - 10 && x <= lineEndX + 10 && Math.abs(y - ly) < 10) return d;
        }

        // Check inside shaded zone
        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);
        if (x >= lineStartX && x <= lineEndX && y >= minY - 20 && y <= maxY + 20) return d;
      }

      // Box / Area tools (Fib Extension, Gann Box, Rectangle, Measure)
      else if (['fib_ext', 'gann_box', 'gann_sq_fixed', 'gann_square', 'rectangle', 'measure'].includes(d.type)) {
        const effectiveMaxX = Math.max(maxX, minX + 100);
        const effectiveMaxY = Math.max(maxY, minY + 40);
        if (x >= minX - 12 && x <= effectiveMaxX + 12 && y >= minY - 12 && y <= effectiveMaxY + 12) return d;
      }

      // Fan / Wedge / Arc tools
      else if (['fib_fan', 'gann_fan', 'fib_wedge', 'pitchfan'].includes(d.type)) {
        const distP1 = Math.hypot(x - p1.x, y - p1.y);
        if (distP1 < 20) return d;
        if (distToSegment({ x, y }, p1, p2) < 20) return d;
        if (x >= Math.min(p1.x, p2.x) - 15 && x <= Math.max(p1.x, p2.x) + 200 && y >= minY - 20 && y <= maxY + 40) return d;
      }

      // Circle & Spiral & Arcs tools
      else if (['fib_circles', 'fib_spiral', 'fib_arcs'].includes(d.type)) {
        const baseR = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const curR = Math.hypot(x - p1.x, y - p1.y);
        if (curR <= baseR * 2.62 + 20) return d;
      }

      // Time Zone tools
      else if (['fib_time', 'fib_trend_time'].includes(d.type)) {
        if (x >= minX - 15 && x <= Math.max(canvas.width, maxX + 400)) return d;
      }

      // Position tools (Long / Short)
      else if (d.type === 'long_pos' || d.type === 'short_pos') {
        const leftX = Math.min(p1.x, p2.x);
        const width = Math.max(90, Math.abs(p2.x - p1.x));
        const rightX = leftX + width;
        const entryY = p1.y;

        const isLong = d.type === 'long_pos';
        const entryPrice = d.p1.price;
        const defaultDelta = entryPrice * 0.0015;
        const stopPrice = d.stopPrice !== undefined ? d.stopPrice : (isLong ? entryPrice - defaultDelta : entryPrice + defaultDelta);
        const targetPrice = d.targetPrice !== undefined ? d.targetPrice : (isLong ? entryPrice + defaultDelta * 2 : entryPrice - defaultDelta * 2);

        const stopCoord = candleSeries ? candleSeries.priceToCoordinate(stopPrice) : null;
        const targetCoord = candleSeries ? candleSeries.priceToCoordinate(targetPrice) : null;
        const stopY = stopCoord !== null ? stopCoord : (isLong ? entryY + 45 : entryY - 45);
        const targetY = targetCoord !== null ? targetCoord : (isLong ? entryY - 90 : entryY + 90);

        const topY = Math.min(entryY, stopY, targetY);
        const botY = Math.max(entryY, stopY, targetY);

        if (x >= leftX - 10 && x <= rightX + 10 && y >= topY - 10 && y <= botY + 10) return d;
      }

      // Text & Stickers
      else if (d.type === 'text' || d.type === 'stickers') {
        if (Math.hypot(x - p1.x, y - p1.y) < 35) return d;
      } else if (d.type === 'patterns') {
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2 - 40;
        if (distToSegment({ x, y }, p1, { x: midX, y: midY }) < 15 || distToSegment({ x, y }, { x: midX, y: midY }, p2) < 15) return d;
      }
    }
    return null;
  }

  function distToSegment(p, v, w) {
    const l2 = Math.pow(v.x - w.x, 2) + Math.pow(v.y - w.y, 2);
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
  }

  function redraw() {
    if (!ctx || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    if (isHidden) return;

    // Draw all confirmed drawings
    drawings.forEach(d => {
      const isSelected = d === selectedDrawing;
      const isHovered = d === hoverDrawing;
      renderDrawingItem(d, isSelected, isHovered);
    });

    // Draw current active drawing in progress
    if (currentDrawing) {
      renderDrawingItem(currentDrawing, true, false);
    }
  }

  function applyLineStyle(d, isSelected, isHovered) {
    ctx.lineWidth = isSelected ? (d.lineWidth || 2) + 0.5 : (d.lineWidth || 2);
    ctx.strokeStyle = isSelected ? '#ffffff' : (d.color || '#2962ff');

    if (d.lineStyle === 'dashed') {
      ctx.setLineDash([6, 6]);
    } else if (d.lineStyle === 'dotted') {
      ctx.setLineDash([2, 4]);
    } else {
      ctx.setLineDash([]);
    }
  }

  function renderDrawingItem(d, isSelected, isHovered) {
    const p1 = priceTimeToCoordinate(d.p1.time, d.p1.price);
    const p2 = priceTimeToCoordinate(d.p2.time, d.p2.price);
    if (!p1 || !p2) return;

    ctx.save();
    applyLineStyle(d, isSelected, isHovered);

    // 1. Line Tools
    if (d.type === 'trendline') {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      const angle = Math.round((Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI);
      const priceDiff = (d.p2.price - d.p1.price).toFixed(2);
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = '#787b86';
      ctx.fillText(`${priceDiff} (${-angle}°)`, (p1.x + p2.x) / 2 + 5, (p1.y + p2.y) / 2 - 5);

      drawHandle(p1.x, p1.y, isSelected);
      drawHandle(p2.x, p2.y, isSelected);
    } else if (d.type === 'ray') {
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const farX = p1.x + Math.cos(angle) * 4000;
      const farY = p1.y + Math.sin(angle) * 4000;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(farX, farY);
      ctx.stroke();
      drawHandle(p1.x, p1.y, isSelected);
      drawHandle(p2.x, p2.y, isSelected);
    } else if (d.type === 'info_line') {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      const angle = Math.round((Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI);
      const diff = d.p2.price - d.p1.price;
      const pct = d.p1.price ? ((diff / d.p1.price) * 100).toFixed(2) : '0.00';
      const infoText = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${diff >= 0 ? '+' : ''}${pct}%)  ${-angle}°`;

      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2 + 18;
      ctx.font = '10px JetBrains Mono, monospace';
      const textW = ctx.measureText(infoText).width;
      ctx.fillStyle = '#1e222d';
      ctx.fillRect(midX - textW / 2 - 6, midY - 10, textW + 12, 20);
      ctx.strokeStyle = '#2962ff';
      ctx.lineWidth = 1;
      ctx.strokeRect(midX - textW / 2 - 6, midY - 10, textW + 12, 20);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(infoText, midX - textW / 2, midY + 4);

      drawHandle(p1.x, p1.y, isSelected);
      drawHandle(p2.x, p2.y, isSelected);
    } else if (d.type === 'extended_line') {
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const x1 = p1.x - Math.cos(angle) * 4000;
      const y1 = p1.y - Math.sin(angle) * 4000;
      const x2 = p1.x + Math.cos(angle) * 4000;
      const y2 = p1.y + Math.sin(angle) * 4000;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      drawHandle(p1.x, p1.y, isSelected);
      drawHandle(p2.x, p2.y, isSelected);
    } else if (d.type === 'trend_angle') {
      const angleRad = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const angleDeg = Math.round((-angleRad * 180) / Math.PI);
      const baseLen = Math.max(70, Math.abs(p2.x - p1.x));
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p1.x + (p2.x >= p1.x ? baseLen : -baseLen), p1.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p1.x, p1.y, 28, 0, angleRad, angleRad < 0);
      ctx.stroke();

      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillStyle = '#f7a600';
      ctx.fillText(`${angleDeg}°`, p1.x + (p2.x >= p1.x ? 34 : -44), p1.y + (angleRad < 0 ? -8 : 16));
      drawHandle(p1.x, p1.y, isSelected);
      drawHandle(p2.x, p2.y, isSelected);
    } else if (d.type === 'hray') {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(canvas.width, p1.y);
      ctx.stroke();
      drawHandle(p1.x, p1.y, isSelected);
      drawPriceTag(p1.y, d.p1.price, d.color);
    } else if (d.type === 'hline') {
      ctx.beginPath();
      ctx.moveTo(0, p1.y);
      ctx.lineTo(canvas.width, p1.y);
      ctx.stroke();
      drawHandle(p1.x, p1.y, isSelected);
      drawPriceTag(p1.y, d.p1.price, d.color);
    } else if (d.type === 'vline') {
      ctx.beginPath();
      ctx.moveTo(p1.x, 0);
      ctx.lineTo(p1.x, canvas.height);
      ctx.stroke();
      drawHandle(p1.x, p1.y, isSelected);
      drawTimeTag(p1.x, d.p1.time);
    } else if (d.type === 'crossline') {
      ctx.beginPath();
      ctx.moveTo(0, p1.y);
      ctx.lineTo(canvas.width, p1.y);
      ctx.moveTo(p1.x, 0);
      ctx.lineTo(p1.x, canvas.height);
      ctx.stroke();
      drawHandle(p1.x, p1.y, isSelected);
      drawPriceTag(p1.y, d.p1.price, d.color);
      drawTimeTag(p1.x, d.p1.time);
    }

    // 2. FIBONACCI & GANN SUITE (15 tools)
    else if (d.type === 'fib') {
      renderFibRetracement(d, p1, p2, isSelected);
    } else if (d.type === 'fib_ext') {
      renderFibExtension(d, p1, p2, isSelected);
    } else if (d.type === 'fib_channel') {
      renderFibChannel(d, p1, p2, isSelected);
    } else if (d.type === 'fib_time') {
      renderFibTimeZone(d, p1, p2, isSelected);
    } else if (d.type === 'fib_fan') {
      renderFibFan(d, p1, p2, isSelected);
    } else if (d.type === 'fib_trend_time') {
      renderFibTrendTime(d, p1, p2, isSelected);
    } else if (d.type === 'fib_circles') {
      renderFibCircles(d, p1, p2, isSelected);
    } else if (d.type === 'fib_spiral') {
      renderFibSpiral(d, p1, p2, isSelected);
    } else if (d.type === 'fib_arcs') {
      renderFibArcs(d, p1, p2, isSelected);
    } else if (d.type === 'fib_wedge') {
      renderFibWedge(d, p1, p2, isSelected);
    } else if (d.type === 'pitchfan') {
      renderPitchfan(d, p1, p2, isSelected);
    } else if (d.type === 'gann_box') {
      renderGannBox(d, p1, p2, isSelected);
    } else if (d.type === 'gann_sq_fixed') {
      renderGannSquareFixed(d, p1, p2, isSelected);
    } else if (d.type === 'gann_square') {
      renderGannSquare(d, p1, p2, isSelected);
    } else if (d.type === 'gann_fan') {
      renderGannFan(d, p1, p2, isSelected);
    }

    // 3. Shapes & Trading Tools
    else if (d.type === 'rectangle') {
      renderRectangle(d, p1, p2, isSelected);
    } else if (d.type === 'long_pos' || d.type === 'short_pos') {
      renderPositionTool(d, p1, p2, isSelected);
    } else if (d.type === 'text') {
      renderText(d, p1, isSelected);
    } else if (d.type === 'patterns') {
      renderPatterns(d, p1, p2, isSelected);
    } else if (d.type === 'stickers') {
      ctx.font = '28px sans-serif';
      ctx.fillText('⚡', p1.x - 14, p1.y + 10);
      drawHandle(p1.x, p1.y, isSelected);
    } else if (d.type === 'measure') {
      renderMeasure(d, p1, p2, isSelected);
    }

    ctx.restore();
  }

  // --- FIBONACCI & GANN RENDERERS ---

  function renderFibRetracement(d, p1, p2, isSelected) {
    const chartWidth = canvas ? (canvas.width / (window.devicePixelRatio || 1)) : 2000;
    const leftX = Math.min(p1.x, p2.x);
    const rightX = Math.max(p1.x, p2.x);

    // Determine horizontal line bounds based on extendMode ('none' | 'left' | 'right' | 'both')
    let lineStartX = leftX;
    let lineEndX = rightX;
    const extendMode = d.extendMode || 'none';
    if (extendMode === 'right') {
      lineEndX = chartWidth;
    } else if (extendMode === 'left') {
      lineStartX = 0;
    } else if (extendMode === 'both') {
      lineStartX = 0;
      lineEndX = chartWidth;
    }

    // Reverse handling
    const isRev = d.reverse === true;
    const basePrice = isRev ? d.p2.price : d.p1.price;
    const priceRange = isRev ? (d.p1.price - d.p2.price) : (d.p2.price - d.p1.price);
    const levels = (d.fibLevels && d.fibLevels.length) ? d.fibLevels : TV_DEFAULT_24_FIB_LEVELS;

    ctx.save();

    // 1. TradingView diagonal trendline between Swing points P1 and P2
    if (d.showTrendLine !== false) {
      ctx.save();
      if (d.trendLineStyle === 'dotted') {
        ctx.setLineDash([2, 2]);
      } else if (d.trendLineStyle === 'solid') {
        ctx.setLineDash([]);
      } else {
        ctx.setLineDash([4, 4]); // default dashed
      }
      ctx.strokeStyle = d.trendLineColor || 'rgba(209, 212, 220, 0.65)';
      ctx.lineWidth = d.trendLineWidth || 1.2;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Calculate coordinates for active levels
    const activeLevels = [];
    levels.forEach(level => {
      if (level.visible === false) return;
      const ratio = parseFloat(level.ratio);
      if (isNaN(ratio)) return;
      const lvlPrice = basePrice + (priceRange * ratio);
      const coord = candleSeries ? candleSeries.priceToCoordinate(lvlPrice) : null;
      const y = coord !== null ? coord : (p1.y + (p2.y - p1.y) * ratio);
      const color = d.useOneColor ? (d.oneColor || '#00897b') : (level.color || '#787b86');
      activeLevels.push({
        ratio: ratio,
        price: lvlPrice,
        y: y,
        color: color
      });
    });

    // 3. Shaded background bands between consecutive active levels
    if (d.fillEnabled !== false && activeLevels.length > 1) {
      const sortedByY = [...activeLevels].sort((a, b) => a.y - b.y);
      const fillOpacity = (d.fillOpacity !== undefined ? d.fillOpacity : 20) / 100;
      for (let i = 0; i < sortedByY.length - 1; i++) {
        const lvlA = sortedByY[i];
        const lvlB = sortedByY[i + 1];
        const topY = Math.min(lvlA.y, lvlB.y);
        const zoneH = Math.abs(lvlB.y - lvlA.y);
        if (zoneH > 0.5) {
          ctx.fillStyle = hexToRgba(lvlA.color, fillOpacity);
          ctx.fillRect(lineStartX, topY, lineEndX - lineStartX, zoneH);
        }
      }
    }

    // 4. Render Level Lines
    ctx.save();
    if (d.levelLineStyle === 'dashed') {
      ctx.setLineDash([4, 4]);
    } else if (d.levelLineStyle === 'dotted') {
      ctx.setLineDash([2, 2]);
    } else {
      ctx.setLineDash([]);
    }
    const lineW = d.levelLineWidth || 1;
    activeLevels.forEach(lvl => {
      ctx.strokeStyle = lvl.color;
      ctx.lineWidth = lineW;
      ctx.beginPath();
      ctx.moveTo(lineStartX, lvl.y);
      ctx.lineTo(lineEndX, lvl.y);
      ctx.stroke();
    });
    ctx.restore();

    // 5. Render Labels (Levels & Prices with alignment and font size)
    if (d.showLevels !== false || d.showPrices !== false) {
      const fontSize = d.fontSize || 12;
      ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif`;

      const horz = d.labelHorz || 'left';
      const vert = d.labelVert || 'middle';

      activeLevels.forEach(lvl => {
        let parts = [];
        if (d.showLevels !== false) {
          if (d.levelsFormat === 'percents') {
            parts.push(`${(lvl.ratio * 100).toFixed(1)}%`);
          } else {
            parts.push(`${lvl.ratio}`);
          }
        }
        if (d.showPrices !== false) {
          parts.push(`(${lvl.price.toFixed(2)})`);
        }
        const text = parts.join(' ');
        if (!text) return;

        ctx.fillStyle = lvl.color;

        let tx;
        if (horz === 'center') {
          tx = (lineStartX + lineEndX) / 2;
          ctx.textAlign = 'center';
        } else if (horz === 'right') {
          tx = lineEndX - 8;
          ctx.textAlign = 'right';
        } else {
          tx = lineStartX + 8;
          ctx.textAlign = 'left';
        }

        let ty;
        if (vert === 'top') {
          ty = lvl.y - 4;
          ctx.textBaseline = 'bottom';
        } else if (vert === 'bottom') {
          ty = lvl.y + 4;
          ctx.textBaseline = 'top';
        } else {
          ty = lvl.y;
          ctx.textBaseline = 'middle';
        }

        ctx.fillText(text, tx, ty);
      });
    }

    // 6. Anchor handles at P1 and P2
    drawCustomHandle(p1.x, p1.y, '#2962ff');
    drawCustomHandle(p2.x, p2.y, '#2962ff');

    ctx.restore();
  }

  function renderFibExtension(d, p1, p2, isSelected) {
    const p3 = d.p3 ? priceTimeToCoordinate(d.p3.time, d.p3.price) : p2;
    // Primary move line
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.stroke();

    const originPrice = d.p3 ? d.p3.price : d.p2.price;
    const delta = d.p2.price - d.p1.price;
    const levels = d.fibLevels || FIB_LEVELS;
    const rightX = Math.max(p3.x + 200, canvas.width - 80);

    levels.forEach((lvl, idx) => {
      const extPrice = originPrice + (delta * lvl.ratio);
      const coord = priceTimeToCoordinate(d.p1.time, extPrice);
      const y = coord ? coord.y : p3.y;

      ctx.strokeStyle = lvl.color;
      ctx.beginPath();
      ctx.moveTo(p3.x, y);
      ctx.lineTo(rightX, y);
      ctx.stroke();

      ctx.fillStyle = lvl.color;
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText(`Ext ${lvl.ratio} - ${extPrice.toFixed(2)}`, rightX + 6, y + 3);
    });

    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
    if (d.p3) drawHandle(p3.x, p3.y, isSelected);
  }

  function renderFibChannel(d, p1, p2, isSelected) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const normX = -dy / len;
    const normY = dx / len;
    const channelWidth = 60;
    const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.618];

    ratios.forEach((ratio, idx) => {
      const off = ratio * channelWidth;
      const x1 = p1.x + normX * off;
      const y1 = p1.y + normY * off;
      const x2 = p2.x + normX * off;
      const y2 = p2.y + normY * off;

      ctx.strokeStyle = d.color || '#2962ff';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillStyle = d.color || '#2962ff';
      ctx.fillText(ratio.toString(), x2 + 5, y2 + 3);
    });

    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
  }

  function renderFibTimeZone(d, p1, p2, isSelected) {
    const baseW = Math.max(15, Math.abs(p2.x - p1.x));
    const fibNums = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
    const dir = p2.x >= p1.x ? 1 : -1;

    fibNums.forEach(num => {
      const lineX = p1.x + (num * baseW * dir);
      if (lineX >= -20 && lineX <= canvas.width + 20) {
        ctx.strokeStyle = '#2962ff';
        ctx.beginPath();
        ctx.moveTo(lineX, 0);
        ctx.lineTo(lineX, canvas.height);
        ctx.stroke();

        ctx.fillStyle = '#2962ff';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillText(num.toString(), lineX + 3, 20);
      }
    });

    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
  }

  function renderFibFan(d, p1, p2, isSelected) {
    const ratios = [0.236, 0.382, 0.5, 0.618, 0.786];
    const dy = p2.y - p1.y;

    // Center baseline
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    ratios.forEach(r => {
      const targetY = p1.y + dy * r;
      const angle = Math.atan2(targetY - p1.y, p2.x - p1.x);
      const farX = p1.x + Math.cos(angle) * 3000;
      const farY = p1.y + Math.sin(angle) * 3000;

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(farX, farY);
      ctx.stroke();

      ctx.fillStyle = d.color || '#2962ff';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText(r.toString(), p2.x + 4, targetY + 3);
    });

    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
  }

  function renderFibTrendTime(d, p1, p2, isSelected) {
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    const interval = Math.abs(p2.x - p1.x);
    const ratios = [0.382, 0.5, 0.618, 1.0, 1.618, 2.618];
    const dir = p2.x >= p1.x ? 1 : -1;

    ratios.forEach(r => {
      const lineX = p2.x + (interval * r * dir);
      if (lineX >= -20 && lineX <= canvas.width + 20) {
        ctx.strokeStyle = '#ab47bc';
        ctx.beginPath();
        ctx.moveTo(lineX, 0);
        ctx.lineTo(lineX, canvas.height);
        ctx.stroke();

        ctx.fillStyle = '#ab47bc';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillText(r.toString(), lineX + 3, 30);
      }
    });

    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
  }

  function renderFibCircles(d, p1, p2, isSelected) {
    const baseR = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const ratios = [0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.618, 2.618];

    ratios.forEach((r, idx) => {
      const radius = baseR * r;
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = d.color || '#2962ff';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText(r.toString(), p1.x + radius + 3, p1.y - 3);
    });

    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
  }

  function renderFibSpiral(d, p1, p2, isSelected) {
    const targetR = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 100;
    const baseAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const b = 0.30635; // golden spiral growth factor

    ctx.beginPath();
    const maxTheta = 4 * Math.PI;
    const a = targetR / Math.exp(b * maxTheta);

    for (let theta = 0; theta <= maxTheta; theta += 0.08) {
      const r = a * Math.exp(b * theta);
      const x = p1.x + r * Math.cos(theta + baseAngle);
      const y = p1.y + r * Math.sin(theta + baseAngle);
      if (theta === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
  }

  function renderFibArcs(d, p1, p2, isSelected) {
    const baseR = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const ratios = [0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

    // Connecting baseline
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    ratios.forEach(r => {
      const rad = baseR * r;
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, rad, angle - Math.PI / 2.5, angle + Math.PI / 2.5);
      ctx.stroke();

      const labelX = p1.x + rad * Math.cos(angle);
      const labelY = p1.y + rad * Math.sin(angle);
      ctx.fillStyle = d.color || '#2962ff';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText(r.toString(), labelX + 4, labelY);
    });

    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
  }

  function renderFibWedge(d, p1, p2, isSelected) {
    const angle1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const angle2 = angle1 - 0.5;
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const ratios = [0.236, 0.382, 0.5, 0.618, 0.786];

    // Primary ray 1
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    // Primary ray 2
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p1.x + Math.cos(angle2) * len, p1.y + Math.sin(angle2) * len);
    ctx.stroke();

    ratios.forEach(r => {
      const ang = angle2 + (angle1 - angle2) * r;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p1.x + Math.cos(ang) * len, p1.y + Math.sin(ang) * len);
      ctx.stroke();
    });

    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
  }

  function renderPitchfan(d, p1, p2, isSelected) {
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 120;
    const fanOffsets = [-0.35, -0.2, 0, 0.2, 0.35];

    fanOffsets.forEach(off => {
      const ang = angle + off;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p1.x + Math.cos(ang) * (len * 2), p1.y + Math.sin(ang) * (len * 2));
      ctx.stroke();
    });

    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
  }

  function renderGannBox(d, p1, p2, isSelected) {
    if (!p1 || !p2) return;

    const boxLeft = Math.min(p1.x, p2.x);
    const boxRight = Math.max(p1.x, p2.x);
    const boxTop = Math.min(p1.y, p2.y);
    const boxBottom = Math.max(p1.y, p2.y);
    const boxWidth = Math.max(1, boxRight - boxLeft);
    const boxHeight = Math.max(1, boxBottom - boxTop);

    const priceLevels = (d.priceLevels && d.priceLevels.length) ? d.priceLevels : TV_DEFAULT_GANN_PRICE_LEVELS;
    const timeLevels = (d.timeLevels && d.timeLevels.length) ? d.timeLevels : TV_DEFAULT_GANN_TIME_LEVELS;

    const isRev = d.reverse === true;
    const pStart = isRev ? d.p2.price : d.p1.price;
    const pEnd = isRev ? d.p1.price : d.p2.price;
    const pDiff = pEnd - pStart;

    // 1. Calculate active Price Levels
    const activePriceLevels = [];
    priceLevels.forEach(lvl => {
      if (lvl.visible === false) return;
      const ratio = parseFloat(lvl.ratio);
      if (isNaN(ratio)) return;
      const lvlPrice = pStart + (pDiff * ratio);
      const coord = candleSeries ? candleSeries.priceToCoordinate(lvlPrice) : null;
      const y = (coord !== null && !isNaN(coord)) ? coord : (p1.y + (p2.y - p1.y) * (isRev ? (1 - ratio) : ratio));
      const col = d.useOneColor ? (d.oneColor || '#00bcd4') : (lvl.color || '#787b86');
      activePriceLevels.push({
        ratio: ratio,
        price: lvlPrice,
        y: y,
        color: col
      });
    });

    // 2. Calculate active Time Levels
    const tMin = Math.min(d.p1.time, d.p2.time);
    const tMax = Math.max(d.p1.time, d.p2.time);
    const tDiff = tMax - tMin;

    const activeTimeLevels = [];
    timeLevels.forEach(lvl => {
      if (lvl.visible === false) return;
      const ratio = parseFloat(lvl.ratio);
      if (isNaN(ratio)) return;
      const lvlTime = Math.round(tMin + (tDiff * ratio));
      const ptCoord = priceTimeToCoordinate(lvlTime, d.p1.price);
      let x = ptCoord ? ptCoord.x : (boxLeft + boxWidth * ratio);
      const col = d.useOneColor ? (d.oneColor || '#00bcd4') : (lvl.color || '#787b86');
      activeTimeLevels.push({
        ratio: ratio,
        time: lvlTime,
        x: x,
        color: col
      });
    });

    ctx.save();

    // 3. Shaded Background Bands for Price Levels
    if (d.priceBgEnabled !== false && activePriceLevels.length > 1) {
      const sortedP = [...activePriceLevels].sort((a, b) => a.y - b.y);
      const fillOpacity = (d.priceBgOpacity !== undefined ? d.priceBgOpacity : 20) / 100;
      for (let i = 0; i < sortedP.length - 1; i++) {
        const lvlA = sortedP[i];
        const lvlB = sortedP[i + 1];
        const topY = Math.min(lvlA.y, lvlB.y);
        const zoneH = Math.abs(lvlB.y - lvlA.y);
        if (zoneH > 0.5) {
          ctx.fillStyle = hexToRgba(lvlA.color, fillOpacity);
          ctx.fillRect(boxLeft, topY, boxWidth, zoneH);
        }
      }
    }

    // 4. Shaded Background Bands for Time Levels
    if (d.timeBgEnabled !== false && activeTimeLevels.length > 1) {
      const sortedT = [...activeTimeLevels].sort((a, b) => a.x - b.x);
      const fillOpacity = (d.timeBgOpacity !== undefined ? d.timeBgOpacity : 20) / 100;
      for (let i = 0; i < sortedT.length - 1; i++) {
        const lvlA = sortedT[i];
        const lvlB = sortedT[i + 1];
        const leftX = Math.min(lvlA.x, lvlB.x);
        const zoneW = Math.abs(lvlB.x - lvlA.x);
        if (zoneW > 0.5) {
          ctx.fillStyle = hexToRgba(lvlA.color, fillOpacity);
          ctx.fillRect(leftX, boxTop, zoneW, boxHeight);
        }
      }
    }

    // 5. Gann Angles (diagonals & midpoint angles)
    if (d.angles === true) {
      const angleCol = d.useOneColor ? (d.oneColor || '#00bcd4') : (d.anglesColor || '#787b86');
      ctx.save();
      ctx.strokeStyle = angleCol;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      // Main X diagonals
      ctx.moveTo(boxLeft, boxTop); ctx.lineTo(boxRight, boxBottom);
      ctx.moveTo(boxLeft, boxBottom); ctx.lineTo(boxRight, boxTop);
      // Midpoint diamonds / angles
      const midX = (boxLeft + boxRight) / 2;
      const midY = (boxTop + boxBottom) / 2;
      ctx.moveTo(boxLeft, midY); ctx.lineTo(midX, boxTop);
      ctx.moveTo(midX, boxTop); ctx.lineTo(boxRight, midY);
      ctx.moveTo(boxRight, midY); ctx.lineTo(midX, boxBottom);
      ctx.moveTo(midX, boxBottom); ctx.lineTo(boxLeft, midY);
      ctx.stroke();
      ctx.restore();
    }

    // 6. Horizontal Price Level Lines
    ctx.save();
    activePriceLevels.forEach(lvl => {
      ctx.strokeStyle = lvl.color;
      ctx.lineWidth = 1;
      const isBoundary = Math.abs(lvl.ratio) < 0.001 || Math.abs(lvl.ratio - 1.0) < 0.001;
      ctx.setLineDash(isBoundary ? [] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(boxLeft, lvl.y);
      ctx.lineTo(boxRight, lvl.y);
      ctx.stroke();
    });
    ctx.restore();

    // 7. Vertical Time Level Lines
    ctx.save();
    activeTimeLevels.forEach(lvl => {
      ctx.strokeStyle = lvl.color;
      ctx.lineWidth = 1;
      const isBoundary = Math.abs(lvl.ratio) < 0.001 || Math.abs(lvl.ratio - 1.0) < 0.001;
      ctx.setLineDash(isBoundary ? [] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(lvl.x, boxTop);
      ctx.lineTo(lvl.x, boxBottom);
      ctx.stroke();
    });
    ctx.restore();

    // 8. Outer Box Perimeter
    ctx.save();
    ctx.strokeStyle = d.useOneColor ? (d.oneColor || '#00bcd4') : (d.color || '#787b86');
    ctx.lineWidth = isSelected ? 1.5 : 1;
    ctx.setLineDash([]);
    ctx.strokeRect(boxLeft, boxTop, boxWidth, boxHeight);
    ctx.restore();

    // 9. Text Labels (Price levels & Time levels)
    ctx.font = '10px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif';

    // Left labels
    if (d.leftLabels !== false) {
      activePriceLevels.forEach(lvl => {
        ctx.fillStyle = lvl.color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const txt = `${lvl.ratio} (${lvl.price.toFixed(2)})`;
        ctx.fillText(txt, boxLeft + 4, lvl.y - 2);
      });
    }

    // Right labels
    if (d.rightLabels !== false) {
      activePriceLevels.forEach(lvl => {
        ctx.fillStyle = lvl.color;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        const txt = `${lvl.ratio} (${lvl.price.toFixed(2)})`;
        ctx.fillText(txt, boxRight - 4, lvl.y - 2);
      });
    }

    // Top labels
    if (d.topLabels === true) {
      activeTimeLevels.forEach(lvl => {
        ctx.fillStyle = lvl.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`${lvl.ratio}`, lvl.x, boxTop + 3);
      });
    }

    // Bottom labels
    if (d.bottomLabels !== false) {
      activeTimeLevels.forEach(lvl => {
        ctx.fillStyle = lvl.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${lvl.ratio}`, lvl.x, boxBottom - 3);
      });
    }

    ctx.restore();

    // 10. Draw handles when selected
    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
    if (isSelected) {
      drawHandle(p1.x, p2.y, true);
      drawHandle(p2.x, p1.y, true);
    }
  }

  function renderGannSquareFixed(d, p1, p2, isSelected) {
    const side = Math.max(40, Math.abs(p2.x - p1.x));
    const x = Math.min(p1.x, p2.x);
    const y = p1.y;

    ctx.strokeStyle = d.color || '#ff9800';
    ctx.strokeRect(x, y, side, side);

    // Diagonals & inner diamond
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + side, y + side);
    ctx.moveTo(x + side, y);
    ctx.lineTo(x, y + side);

    ctx.moveTo(x + side / 2, y);
    ctx.lineTo(x + side, y + side / 2);
    ctx.lineTo(x + side / 2, y + side);
    ctx.lineTo(x, y + side / 2);
    ctx.closePath();
    ctx.stroke();

    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
  }

  function renderGannSquare(d, p1, p2, isSelected) {
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w = Math.abs(p2.x - p1.x);
    const h = Math.abs(p2.y - p1.y);

    ctx.strokeStyle = d.color || '#ab47bc';
    ctx.strokeRect(x, y, w, h);

    // 8x8 Grid lines
    for (let i = 1; i < 4; i++) {
      const qx = x + (w * i) / 4;
      const qy = y + (h * i) / 4;
      ctx.beginPath();
      ctx.moveTo(qx, y);
      ctx.lineTo(qx, y + h);
      ctx.moveTo(x, qy);
      ctx.lineTo(x + w, qy);
      ctx.stroke();
    }

    // Corner crosses
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y + h);
    ctx.moveTo(x + w, y);
    ctx.lineTo(x, y + h);
    ctx.stroke();

    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
  }

  function renderGannFan(d, p1, p2, isSelected) {
    const angles = [
      { name: '1x8', mult: 8 },
      { name: '1x4', mult: 4 },
      { name: '1x3', mult: 3 },
      { name: '1x2', mult: 2 },
      { name: '1x1', mult: 1 },
      { name: '2x1', mult: 0.5 },
      { name: '3x1', mult: 0.33 },
      { name: '4x1', mult: 0.25 },
      { name: '8x1', mult: 0.125 }
    ];

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const unitX = Math.abs(dx) || 100;
    const unitY = Math.abs(dy) || 100;
    const dirX = dx >= 0 ? 1 : -1;
    const dirY = dy >= 0 ? 1 : -1;

    angles.forEach(ang => {
      const endX = p1.x + dirX * 3000;
      const endY = p1.y + dirY * (3000 * (unitY / (unitX * ang.mult)));

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      const labelDist = 200;
      const lx = p1.x + dirX * labelDist;
      const ly = p1.y + dirY * (labelDist * (unitY / (unitX * ang.mult)));
      ctx.fillStyle = d.color || '#2962ff';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText(ang.name, lx + 5, ly);
    });

    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
  }

  function renderRectangle(d, p1, p2, isSelected) {
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w = Math.abs(p2.x - p1.x);
    const h = Math.abs(p2.y - p1.y);

    if (d.fillEnabled !== false) {
      ctx.fillStyle = (d.color || '#089981') + '20';
      ctx.fillRect(x, y, w, h);
    }

    ctx.strokeStyle = d.color || '#089981';
    ctx.strokeRect(x, y, w, h);

    // Mean Threshold (50% dashed line)
    ctx.beginPath();
    ctx.setLineDash([3, 3]);
    ctx.moveTo(x, y + h / 2);
    ctx.lineTo(x + w, y + h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = d.color || '#089981';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText(d.label || 'Order Block (OB)', x + 6, y + 14);

    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
  }

  function renderPositionTool(d, p1, p2, isSelected) {
    const isLong = d.type === 'long_pos';
    const entryPrice = d.p1.price;
    const defaultDelta = entryPrice * 0.0015;
    const stopPrice = d.stopPrice !== undefined ? d.stopPrice : (isLong ? entryPrice - defaultDelta : entryPrice + defaultDelta);
    const targetPrice = d.targetPrice !== undefined ? d.targetPrice : (isLong ? entryPrice + defaultDelta * 2 : entryPrice - defaultDelta * 2);

    const entryY = p1.y;
    const stopCoord = candleSeries ? candleSeries.priceToCoordinate(stopPrice) : null;
    const targetCoord = candleSeries ? candleSeries.priceToCoordinate(targetPrice) : null;
    const stopY = stopCoord !== null ? stopCoord : (isLong ? entryY + 45 : entryY - 45);
    const targetY = targetCoord !== null ? targetCoord : (isLong ? entryY - 90 : entryY + 90);

    const leftX = Math.min(p1.x, p2.x);
    const width = Math.max(90, Math.abs(p2.x - p1.x));
    const rightX = leftX + width;
    const midX = (leftX + rightX) / 2;

    const risk = Math.abs(entryPrice - stopPrice);
    const reward = Math.abs(targetPrice - entryPrice);
    const rr = risk > 0 ? (reward / risk).toFixed(2) : '1.00';
    const riskPct = ((risk / entryPrice) * 100).toFixed(2);
    const rewardPct = ((reward / entryPrice) * 100).toFixed(2);
    const prec = entryPrice >= 100 ? 2 : (entryPrice >= 1 ? 3 : 5);

    ctx.save();

    // 1. Target (Profit) Box - Green
    const targetBoxTop = Math.min(entryY, targetY);
    const targetBoxH = Math.max(2, Math.abs(entryY - targetY));
    ctx.fillStyle = 'rgba(8, 153, 129, 0.14)';
    ctx.fillRect(leftX, targetBoxTop, width, targetBoxH);
    ctx.strokeStyle = '#089981';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(leftX, targetBoxTop, width, targetBoxH);

    // Target Label (Top/inner or nicely positioned)
    ctx.fillStyle = '#089981';
    ctx.font = '10px Inter, -apple-system, sans-serif';
    const targetLabelY = isLong 
      ? (targetBoxH > 18 ? targetBoxTop + 13 : targetBoxTop - 4)
      : (targetBoxH > 18 ? targetBoxTop + targetBoxH - 5 : targetBoxTop + targetBoxH + 13);
    ctx.fillText(`Target: ${targetPrice.toFixed(prec)} (+${reward.toFixed(prec)}, +${rewardPct}%)`, leftX + 8, targetLabelY);

    // 2. Stop Loss Box - Red
    const stopBoxTop = Math.min(entryY, stopY);
    const stopBoxH = Math.max(2, Math.abs(entryY - stopY));
    ctx.fillStyle = 'rgba(242, 54, 69, 0.14)';
    ctx.fillRect(leftX, stopBoxTop, width, stopBoxH);
    ctx.strokeStyle = '#f23645';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(leftX, stopBoxTop, width, stopBoxH);

    // Stop Label (Bottom/inner or nicely positioned)
    ctx.fillStyle = '#f23645';
    ctx.font = '10px Inter, -apple-system, sans-serif';
    const stopLabelY = isLong 
      ? (stopBoxH > 18 ? stopBoxTop + stopBoxH - 5 : stopBoxTop + stopBoxH + 13)
      : (stopBoxH > 18 ? stopBoxTop + 13 : stopBoxTop - 4);
    ctx.fillText(`Stop: ${stopPrice.toFixed(prec)} (-${risk.toFixed(prec)}, -${riskPct}%)`, leftX + 8, stopLabelY);

    // 3. Center Entry Line - White
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.60)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(leftX, entryY);
    ctx.lineTo(rightX, entryY);
    ctx.stroke();

    // Center Risk / Reward Badge (TradingView Style - Compact & Candle-Friendly)
    const isNarrow = width < 150;
    const badgeText = isNarrow 
      ? `R:R: ${rr}` 
      : `Risk/Reward: ${rr} (Entry: ${entryPrice.toFixed(prec)})`;

    ctx.font = '9.5px Inter, -apple-system, sans-serif';
    const textW = ctx.measureText(badgeText).width;
    const badgeW = textW + 10;
    const badgeH = 16;
    
    // Position toward the right side of the box so the entry candles on the left are completely unobstructed
    let badgeX = rightX - badgeW - 8;
    if (badgeX < leftX + 10) {
      badgeX = Math.max(leftX + 4, midX - badgeW / 2);
    }
    const badgeY = entryY - 8;

    // Semi-transparent glass pill so underlying candles remain clearly visible
    ctx.fillStyle = 'rgba(18, 22, 34, 0.65)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
    ctx.fillText(badgeText, badgeX + 5, badgeY + 11.5);

    // 4. Handles when selected or hovered (5px crisp TradingView style pucks)
    if (isSelected || hoverDrawing === d) {
      // Target handle (Green circle)
      drawCustomHandle(midX, targetY, '#089981');
      // Stop handle (Red circle)
      drawCustomHandle(midX, stopY, '#f23645');
      // Width / Duration handle (Right edge)
      drawCustomHandle(rightX, entryY, '#2962ff');
      // Entry / Move handle (Left edge)
      drawCustomHandle(leftX, entryY, '#2962ff');
    }

    ctx.restore();
  }

  function renderText(d, p1, isSelected) {
    ctx.font = '12px Inter, sans-serif';
    const textWidth = ctx.measureText(d.text || 'Note').width;

    ctx.fillStyle = '#1e222d';
    ctx.strokeStyle = '#2962ff';
    ctx.beginPath();
    ctx.roundRect(p1.x - 4, p1.y - 14, textWidth + 14, 22, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#d1d4dc';
    ctx.fillText(d.text || 'Note', p1.x + 3, p1.y + 1);
    drawHandle(p1.x, p1.y, isSelected);
  }

  function renderPatterns(d, p1, p2, isSelected) {
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2 - 40;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(midX, midY);
    ctx.lineTo(p2.x, p2.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(156, 39, 176, 0.2)';
    ctx.fill();
    ctx.strokeStyle = '#ab47bc';
    ctx.stroke();
    drawHandle(p1.x, p1.y, isSelected);
    drawHandle(midX, midY, isSelected);
    drawHandle(p2.x, p2.y, isSelected);
  }

  function renderMeasure(d, p1, p2, isSelected) {
    const leftX = Math.min(p1.x, p2.x);
    const topY = Math.min(p1.y, p2.y);
    const w = Math.abs(p2.x - p1.x);
    const h = Math.abs(p2.y - p1.y);

    const isGain = d.p2.price >= d.p1.price;
    const boxColor = isGain ? '#089981' : '#f23645';

    ctx.fillStyle = isGain ? 'rgba(8, 153, 129, 0.16)' : 'rgba(242, 54, 69, 0.16)';
    ctx.fillRect(leftX, topY, w, h);
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(leftX, topY, w, h);

    const diff = (d.p2.price - d.p1.price);
    const pct = d.p1.price ? ((diff / d.p1.price) * 100).toFixed(2) : '0.00';
    const diffStr = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${diff >= 0 ? '+' : ''}${pct}%)`;

    // Calculate bars count & time span
    const candles = window.DataFeed ? window.DataFeed.getLiveCandles() : [];
    const minT = Math.min(d.p1.time, d.p2.time);
    const maxT = Math.max(d.p1.time, d.p2.time);
    let barCount = 0;
    if (candles && candles.length > 0) {
      barCount = candles.filter(c => c.time >= minT && c.time <= maxT).length;
    }
    const timeSecs = maxT - minT;
    const hrs = Math.floor(timeSecs / 3600);
    const mins = Math.floor((timeSecs % 3600) / 60);
    const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    const badgeText = `${diffStr}   ${barCount} bars, ${timeStr}`;

    ctx.font = '10px JetBrains Mono, monospace';
    const textW = ctx.measureText(badgeText).width;
    const badgeW = textW + 16;
    const badgeH = 22;
    const badgeX = Math.max(10, Math.min(canvas.width - badgeW - 10, leftX + (w - badgeW) / 2));
    const badgeY = topY - 26 < 10 ? topY + h + 6 : topY - 26;

    ctx.fillStyle = '#1e222d';
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(badgeText, badgeX + 8, badgeY + 15);

    drawHandle(p1.x, p1.y, true);
    drawHandle(p2.x, p2.y, true);
  }

  function drawHandle(x, y, isSelected) {
    if (!isSelected) return;
    ctx.save();
    ctx.fillStyle = '#2962ff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawPriceTag(y, price, color) {
    const text = price.toFixed(2);
    ctx.font = '10px JetBrains Mono, monospace';
    const textWidth = ctx.measureText(text).width;
    const tagW = textWidth + 12;
    const tagH = 18;

    ctx.fillStyle = color || '#2962ff';
    ctx.fillRect(canvas.width - tagW - 4, y - tagH / 2, tagW, tagH);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, canvas.width - tagW + 2, y + 3.5);
  }

  function drawTimeTag(x, time) {
    if (!time) return;
    const date = new Date(time * 1000);
    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    ctx.font = '10px JetBrains Mono, monospace';
    const textW = ctx.measureText(dateStr).width;
    const tagW = textW + 10;
    const tagH = 18;
    ctx.fillStyle = '#2962ff';
    ctx.fillRect(x - tagW / 2, canvas.height - tagH - 2, tagW, tagH);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(dateStr, x - textW / 2, canvas.height - 7);
  }

  function updateCloudStatus(status) {
    const el = document.getElementById('cloud-status') || document.getElementById('tv-cloud-status');
    const txt = document.getElementById('cloud-status-text') || document.getElementById('tv-cloud-text');
    const pill = document.getElementById('sync-status-pill');
    const pillTxt = document.getElementById('sync-status-text');

    if (pill && pillTxt) {
      if (status === 'saving') {
        pill.className = 'tv-sync-pill saving';
        pillTxt.textContent = 'Saving...';
      } else if (status === 'saved') {
        pill.className = 'tv-sync-pill';
        pillTxt.textContent = 'Cloud Synced';
      } else if (status === 'error') {
        pill.className = 'tv-sync-pill offline';
        pillTxt.textContent = 'Local IndexedDB';
      }
    }

    if (el && txt) {
      if (status === 'saving') {
        el.className = 'tv-cloud-status saving';
        txt.textContent = 'Saving...';
      } else if (status === 'saved') {
        el.className = 'tv-cloud-status saved';
        txt.textContent = 'Saved';
      } else if (status === 'error') {
        el.className = 'tv-cloud-status error';
        txt.textContent = 'Offline';
      }
    }
  }

  function flushSaveDrawings(uid, sym, drawList) {
    const targetUid = uid || (window.TVAuth ? window.TVAuth.getUserId() : currentUserId);
    const targetSym = sym || currentSymbol;
    const targetDrawings = drawList || drawings;

    // 1. Instant 0ms local save to IndexedDB (MB/GB storage capacity)
    if (window.TVStorage && window.TVStorage.saveDrawings) {
      window.TVStorage.saveDrawings(targetUid, targetSym, targetDrawings);
    }

    // 2. Fallback to LocalStorage
    const cacheKey = `tv_user_drawings_${targetUid}_${targetSym}`;
    try {
      localStorage.setItem(cacheKey, JSON.stringify(targetDrawings));
      if (targetSym === 'XAUUSD' && (targetUid === 'default' || targetUid.startsWith('guest_'))) {
        localStorage.setItem('tv_user_drawings', JSON.stringify(targetDrawings));
      }
    } catch (e) {}

    updateCloudStatus('saving');

    // 3. Asynchronous cloud backup with Token + JSON in request header
    const fetchFn = (window.TVAuth && window.TVAuth.fetchWithAuth) ? window.TVAuth.fetchWithAuth : fetch;
    return fetchFn('/api/drawings/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: targetUid,
        symbol: targetSym,
        drawings: targetDrawings
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data && data.status === 'ok') {
        updateCloudStatus('saved');
        return true;
      } else {
        updateCloudStatus('error');
        return false;
      }
    })
    .catch(() => {
      updateCloudStatus('error');
      return false;
    });
  }

  function saveDrawings(immediate = false) {
    const activeUid = (window.TVAuth ? window.TVAuth.getUserId() : currentUserId);
    const cacheKey = `tv_user_drawings_${activeUid}_${currentSymbol}`;

    // Instant save to IndexedDB & LocalStorage
    if (window.TVStorage && window.TVStorage.saveDrawings) {
      window.TVStorage.saveDrawings(activeUid, currentSymbol, drawings);
    }
    try {
      localStorage.setItem(cacheKey, JSON.stringify(drawings));
      if (currentSymbol === 'XAUUSD' && (activeUid === 'default' || activeUid.startsWith('guest_'))) {
        localStorage.setItem('tv_user_drawings', JSON.stringify(drawings));
      }
    } catch (e) {}

    // Protect against saving empty array before initial load from database is complete
    if (!isInitialLoaded && (!drawings || drawings.length === 0)) {
      return Promise.resolve(false);
    }

    if (immediate) {
      clearTimeout(saveDebounceTimer);
      return flushSaveDrawings(activeUid, currentSymbol, drawings);
    }

    updateCloudStatus('saving');
    clearTimeout(saveDebounceTimer);
    const targetUid = activeUid;
    const targetSym = currentSymbol;
    const targetDrawings = [...drawings];

    saveDebounceTimer = setTimeout(() => {
      flushSaveDrawings(targetUid, targetSym, targetDrawings);
    }, 300);
  }

  function sanitizeDrawings(list) {
    if (!Array.isArray(list)) return [];
    list.forEach(d => {
      if (d && (d.type === 'long_pos' || d.type === 'short_pos') && d.p1) {
        const isLong = d.type === 'long_pos';
        const entryPrice = d.p1.price;
        // Auto-heal legacy oversized position tools (old 1.5% stop or 3.0% target on high-value assets)
        if (d.stopPrice && entryPrice > 50) {
          const stopPct = Math.abs(d.stopPrice - entryPrice) / entryPrice;
          if (stopPct > 0.012 && stopPct < 0.018) {
            const delta = entryPrice * 0.0015;
            d.stopPrice = Number((isLong ? entryPrice - delta : entryPrice + delta).toFixed(2));
            d.targetPrice = Number((isLong ? entryPrice + delta * 2 : entryPrice - delta * 2).toFixed(2));
          }
        }
      }
    });
    return list;
  }

  async function loadDrawings(newUserId, newSymbol) {
    if (newUserId) currentUserId = newUserId;
    if (newSymbol) currentSymbol = newSymbol;

    const targetUserId = (window.TVAuth ? window.TVAuth.getUserId() : currentUserId);
    const targetSymbol = currentSymbol;
    const cacheKey = `tv_user_drawings_${targetUserId}_${targetSymbol}`;
    
    // 1. Instant local load: Try IndexedDB first (0ms), fallback to LocalStorage
    let localLoaded = false;
    if (window.TVStorage && window.TVStorage.getDrawings) {
      try {
        const idbData = await window.TVStorage.getDrawings(targetUserId, targetSymbol);
        if (Array.isArray(idbData) && idbData.length > 0) {
          drawings = sanitizeDrawings(idbData);
          redraw();
          localLoaded = true;
        }
      } catch (e) {}
    }

    if (!localLoaded) {
      try {
        let localData = localStorage.getItem(cacheKey);
        if (!localData && targetSymbol === 'XAUUSD' && (targetUserId === 'default' || targetUserId.startsWith('guest_'))) {
          localData = localStorage.getItem('tv_user_drawings');
        }
        if (localData) {
          drawings = sanitizeDrawings(JSON.parse(localData));
          redraw();
          localLoaded = true;
        } else {
          drawings = [];
          redraw();
        }
      } catch (e) {
        drawings = [];
      }
    }

    // 2. Load from cloud server SQLite database using Session Token
    try {
      updateCloudStatus('saving');
      const fetchFn = (window.TVAuth && window.TVAuth.fetchWithAuth) ? window.TVAuth.fetchWithAuth : fetch;
      const res = await fetchFn(`/api/drawings?user_id=${encodeURIComponent(targetUserId)}&symbol=${encodeURIComponent(targetSymbol)}`);
      if (res.ok) {
        const data = await res.json();
        // Guard against race if user or symbol changed while request was in-flight
        if (currentSymbol === targetSymbol) {
          if (data.status === 'ok' && Array.isArray(data.drawings)) {
            if (data.drawings.length > 0) {
              drawings = sanitizeDrawings(data.drawings);
              if (window.TVStorage && window.TVStorage.saveDrawings) {
                window.TVStorage.saveDrawings(targetUserId, targetSymbol, drawings);
              }
              try {
                localStorage.setItem(cacheKey, JSON.stringify(drawings));
              } catch (e) {}
              redraw();
            } else if (drawings.length > 0) {
              // Local has drawings but server returned empty. Auto-heal server by flushing local drawings!
              flushSaveDrawings(targetUserId, targetSymbol, drawings);
            } else {
              drawings = [];
              redraw();
            }
            updateCloudStatus('saved');
          }
        }
      }
    } catch (e) {
      updateCloudStatus('error');
    } finally {
      if (currentSymbol === targetSymbol) {
        isInitialLoaded = true;
      }
    }
  }

  function setSymbol(symbolId) {
    if (!symbolId || symbolId === currentSymbol) return;
    clearTimeout(saveDebounceTimer);
    if (isInitialLoaded && drawings && drawings.length > 0) {
      flushSaveDrawings(currentUserId, currentSymbol, drawings);
    }
    currentSymbol = symbolId;
    isInitialLoaded = false;
    loadDrawings(currentUserId, symbolId);
  }

  function setUserId(userId) {
    if (!userId || userId === currentUserId) return;
    clearTimeout(saveDebounceTimer);
    if (isInitialLoaded && drawings && drawings.length > 0) {
      flushSaveDrawings(currentUserId, currentSymbol, drawings);
    }
    currentUserId = userId;
    localStorage.setItem('tv_active_user_id', userId);
    isInitialLoaded = false;
    loadDrawings(userId, currentSymbol);
  }

  // Guaranteed save on browser close or tab refresh
  window.addEventListener('beforeunload', () => {
    if (isInitialLoaded && drawings && drawings.length > 0) {
      try {
        const payload = JSON.stringify({
          user_id: currentUserId,
          symbol: currentSymbol,
          drawings: drawings
        });
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/drawings/save', blob);
      } catch (e) {}
    }
  });

  return {
    init,
    setTool,
    getTool: () => activeTool,
    setMagnetMode,
    getMagnetMode: () => magnetMode,
    setStayInDrawingMode: (enabled) => { stayInDrawingMode = enabled; },
    getStayInDrawingMode: () => stayInDrawingMode,
    toggleLock,
    toggleHide,
    clearAllDrawings,
    deleteSelectedDrawing,
    getSelectedDrawing: () => selectedDrawing,
    setSelectedDrawing: (d) => { selectedDrawing = d; redraw(); updateFloatingToolbar(); },
    getDrawings: () => drawings,
    getDrawingsCount: () => drawings.length,
    setDrawingColor,
    setDrawingWidth,
    setDrawingStyle,
    toggleDrawingLock,
    openDrawingSettings,
    redraw,
    setSymbol,
    getSymbol: () => currentSymbol,
    setUserId,
    getUserId: () => currentUserId,
    loadDrawings,
    saveDrawings,
    flushSaveDrawings,
    undo,
    redo,
    pushUndoState,
    duplicateSelectedDrawing,
    canUndo: () => undoHistory.length > 0,
    canRedo: () => redoHistory.length > 0
  };
})();

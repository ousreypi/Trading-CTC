/**
 * TradingView Pro - Master Orchestrator Application
 * Connects Lightweight Charts, Real-time Data Feeds, ICT/SMC Engine,
 * Drawings Layer, Paper Trading Simulator, UI Panels, and Modals.
 */

(function () {
  'use strict';

  // Core Chart references
  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  let ema20Series = null;
  let ema50Series = null;
  let ema200Series = null;
  let bbUpperSeries = null;
  let bbLowerSeries = null;

  // Active indicator configuration - Default all disabled for clean chart
  const indConfig = {
    ema: false,
    ema20: false,
    ema50: false,
    bb: false,
    rsi: false,
    volume: false,
    ob: false,
    fvg: false,
    liquidity: false,
    bos: false,
    priceLines: false
  };

  let currentCandles = [];
  let alertPrice = null;
  let alertPriceLine = null;
  let positionPriceLines = [];
  let executionMarksHistory = [];
  let isReplayMode = false;
  let replayIndex = 0;
  let replayTimer = null;
  let replaySpeedInterval = 100;
  let replayFullCandles = [];
  let isCuttingBarMode = false;
  let currentStartMode = 'bar';
  let replayCutTimestamp = null;
  let replayCutPrice = null;
  let replayEffectiveTimestamp = null;

  document.addEventListener('DOMContentLoaded', initApp);

  function initApp() {
    if (window.TVStorage) {
      window.TVStorage.init();
    }
    if (window.TVAuth) {
      window.TVAuth.init();
    }
    if (window.I18N) {
      window.I18N.init();
    }
    initChart();
    loadChartSettings();
    PaperTrading.init();
    setupDataFeed();
    setupToolbar();
    setupTimeframes();
    setupReplayEngine();
    setupWatchlist();
    setupQuickTrade();
    setupModals();
    setupIndicatorLegendActions();
    setupChartContextMenu();
    setupBottomDock();
    setupSidebarTabs();
    setupAudioAlerts();
    setupLanguageToggle();
    initTradingViewColorPicker();
    renderScreenerTable();
    setInterval(updateCountdownUI, 1000);
    clearPriceScaleLines();

    // Re-render dynamic components on language change
    window.addEventListener('languageChanged', () => {
      renderScreenerTable();
      updatePaperTradingUI(PaperTrading.getAccountSummary());
      updateHeaderSymbolInfo(DataFeed.getCurrentSymbol());
      if (currentCandles.length > 0) {
        updateLegendWithCandle(currentCandles[currentCandles.length - 1]);
      }
    });

    // Resize observer & window listener to keep chart 100% full viewport
    const handleResize = () => {
      if (window.MultiChartEngine && window.MultiChartEngine.resizeAllPanes) {
        window.MultiChartEngine.resizeAllPanes();
      } else if (chart) {
        const container = document.getElementById('chart-pane-0-canvas') || document.getElementById('chart-container');
        if (container && container.clientWidth > 0 && container.clientHeight > 0) {
          chart.resize(container.clientWidth, container.clientHeight);
        }
      }
    };

    if (window.ResizeObserver) {
      const resizeObserver = new ResizeObserver(handleResize);
      const viewport = document.getElementById('chart-viewport');
      if (viewport) resizeObserver.observe(viewport);
    }
    window.addEventListener('resize', handleResize);
    setTimeout(handleResize, 100);
  }

  function setupLanguageToggle() {
    const btn = document.getElementById('btn-lang-toggle');
    if (btn && window.I18N) {
      btn.addEventListener('click', () => {
        window.I18N.toggleLanguage();
      });
    }
  }

  /**
   * Initializes TradingView's Lightweight Charts instance
   */
  function initChart() {
    const container = document.getElementById('chart-pane-0-canvas') || document.getElementById('chart-container');

    chart = LightweightCharts.createChart(container, {
      layout: {
        background: { type: 'solid', color: '#131722' },
        textColor: '#d1d4dc',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        fontSize: 12
      },
      grid: {
        vertLines: { color: '#1e222d', style: 1 },
        horzLines: { color: '#1e222d', style: 1 }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: '#787b86', width: 1, style: 2 },
        horzLine: { color: '#787b86', width: 1, style: 2 }
      },
      rightPriceScale: {
        borderColor: '#2a2e39',
        autoScale: true,
        scaleMargins: { top: 0.1, bottom: 0.22 }
      },
      timeScale: {
        borderColor: '#2a2e39',
        timeVisible: true,
        secondsVisible: true
      }
    });

    // Main Candlestick Series
    candleSeries = chart.addCandlestickSeries({
      upColor: '#089981',
      downColor: '#f23645',
      borderUpColor: '#089981',
      borderDownColor: '#f23645',
      wickUpColor: '#089981',
      wickDownColor: '#f23645',
      priceLineVisible: true,
      lastValueVisible: true,
      priceLineColor: '#089981',
      priceLineWidth: 1,
      priceLineStyle: LightweightCharts.LineStyle.Dotted
    });

    // Volume Series (rendered as bottom histogram without interfering with price scale)
    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume_scale',
      lastValueVisible: false,
      priceLineVisible: false
    });
    chart.priceScale('volume_scale').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false
    });

    // Moving Average Series
    ema20Series = chart.addLineSeries({
      color: '#2962ff',
      lineWidth: 2,
      crosshairMarkerVisible: false,
      title: 'EMA 20'
    });

    ema50Series = chart.addLineSeries({
      color: '#ff9800',
      lineWidth: 2,
      crosshairMarkerVisible: false,
      title: 'EMA 50'
    });

    ema200Series = chart.addLineSeries({
      color: '#ab47bc',
      lineWidth: 2,
      crosshairMarkerVisible: false,
      title: 'EMA 200'
    });

    // Bollinger Bands Series
    bbUpperSeries = chart.addLineSeries({
      color: 'rgba(41, 98, 255, 0.4)',
      lineWidth: 1,
      lineStyle: 2,
      crosshairMarkerVisible: false
    });

    bbLowerSeries = chart.addLineSeries({
      color: 'rgba(41, 98, 255, 0.4)',
      lineWidth: 1,
      lineStyle: 2,
      crosshairMarkerVisible: false
    });

    // Initialize Interactive Drawing Canvas Overlay
    DrawingEngine.init(chart, candleSeries, document.getElementById('chart-viewport'));

    // Subscribe to Crosshair moves for OHLC Legend
    chart.subscribeCrosshairMove(param => {
      if (!param || !param.time || !param.seriesPrices) {
        if (currentCandles.length > 0) {
          updateLegendWithCandle(currentCandles[currentCandles.length - 1]);
        }
        return;
      }
      const data = param.seriesPrices.get(candleSeries);
      if (data) {
        updateLegendWithCandle(data);
      }
    });

    // Persist visible logical range (zoom & pan) so chart NEVER changes on refresh
    let rangeSaveTimer = null;
    chart.timeScale().subscribeVisibleLogicalRangeChange(newRange => {
      if (newRange && !isReplayMode && newRange.from !== null && newRange.to !== null) {
        clearTimeout(rangeSaveTimer);
        rangeSaveTimer = setTimeout(() => {
          try {
            const symId = DataFeed.getCurrentSymbol().id;
            const tf = DataFeed.getCurrentResolution();
            localStorage.setItem(`tv_range_${symId}_${tf}`, JSON.stringify({
              from: Math.round(newRange.from),
              to: Math.round(newRange.to)
            }));
          } catch (e) {}
        }, 250);
      }
    });

    // Initialize TradingView Multi-Chart Split Screen Engine
    if (window.MultiChartEngine && window.MultiChartEngine.init) {
      window.MultiChartEngine.init(chart, candleSeries, volumeSeries);
    }
  }

  let highPriceLine = null;
  let lowPriceLine = null;
  let smcEqPriceLine = null;

  function clearPriceScaleLines() {
    if (highPriceLine && candleSeries) {
      try { candleSeries.removePriceLine(highPriceLine); } catch (e) {}
      highPriceLine = null;
    }
    if (lowPriceLine && candleSeries) {
      try { candleSeries.removePriceLine(lowPriceLine); } catch (e) {}
      lowPriceLine = null;
    }
    if (smcEqPriceLine && candleSeries) {
      try { candleSeries.removePriceLine(smcEqPriceLine); } catch (e) {}
      smcEqPriceLine = null;
    }
  }
  const removePriceScaleLines = clearPriceScaleLines;

  function updatePriceScaleLines(candles, currentPrice, symbolObj) {
    if (!indConfig.priceLines) {
      clearPriceScaleLines();
      return;
    }
    if (!candles || candles.length === 0 || !candleSeries) return;
    const recent = candles.slice(-50);
    let high = -Infinity;
    let low = Infinity;
    recent.forEach(c => {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
    });

    if (high === -Infinity || low === Infinity) return;
    const eq = (high + low) / 2;

    if (!highPriceLine) {
      highPriceLine = candleSeries.createPriceLine({
        price: high,
        color: '#089981',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'High'
      });
    } else {
      highPriceLine.applyOptions({ price: high });
    }

    if (!lowPriceLine) {
      lowPriceLine = candleSeries.createPriceLine({
        price: low,
        color: '#f23645',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Low'
      });
    } else {
      lowPriceLine.applyOptions({ price: low });
    }

    if (!smcEqPriceLine) {
      smcEqPriceLine = candleSeries.createPriceLine({
        price: eq,
        color: '#787b86',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dotted,
        axisLabelVisible: true,
        title: '50% EQ'
      });
    } else {
      smcEqPriceLine.applyOptions({ price: eq });
    }
  }

  function updateCountdownUI() {
    const cdInfo = DataFeed.getCountdownInfo();
    const timerEl = document.getElementById('countdown-timer-val');
    const priceEl = document.getElementById('countdown-price-val');
    const badgeEl = document.getElementById('tv-price-countdown');
    const sym = DataFeed.getCurrentSymbol();

    if (timerEl) timerEl.textContent = cdInfo.formatted;

    if (currentCandles.length > 0 && sym) {
      const lastCandle = currentCandles[currentCandles.length - 1];
      const curPrice = lastCandle.close;
      if (priceEl) {
        priceEl.textContent = curPrice.toFixed(sym.digits);
        priceEl.style.color = (lastCandle.close >= lastCandle.open) ? '#089981' : '#f23645';
      }

      // Position badge vertically beside the price scale
      if (badgeEl && candleSeries) {
        const y = candleSeries.priceToCoordinate(curPrice);
        if (y !== null && !isNaN(y) && y > 0) {
          badgeEl.style.top = y + 'px';
          badgeEl.style.display = 'flex';
        }
      }
    }
  }

  /**
   * Updates floating OHLC legend, percent change, and indicators
   */
  function updateLegendWithCandle(candle) {
    if (!candle) return;
    const sym = DataFeed.getCurrentSymbol();
    const digits = sym ? sym.digits : 2;

    const symEl = document.getElementById('legend-symbol');
    const tfEl = document.getElementById('legend-tf');
    const exEl = document.getElementById('legend-exchange');
    if (symEl && sym) symEl.textContent = sym.name;
    if (tfEl) tfEl.textContent = DataFeed.getCurrentResolution();
    if (exEl && sym) exEl.textContent = sym.exchange;

    const oEl = document.getElementById('legend-open');
    const hEl = document.getElementById('legend-high');
    const lEl = document.getElementById('legend-low');
    const cEl = document.getElementById('legend-close');
    const chgEl = document.getElementById('legend-chg');
    const volEl = document.getElementById('legend-vol');

    if (candle.open !== undefined && oEl) oEl.textContent = candle.open.toFixed(digits);
    if (candle.high !== undefined && hEl) hEl.textContent = candle.high.toFixed(digits);
    if (candle.low !== undefined && lEl) lEl.textContent = candle.low.toFixed(digits);
    if (candle.close !== undefined && cEl) cEl.textContent = candle.close.toFixed(digits);

    if (candle.open !== undefined && candle.close !== undefined && chgEl) {
      const diff = candle.close - candle.open;
      const pct = (diff / candle.open) * 100;
      chgEl.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(digits)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
      chgEl.style.color = diff >= 0 ? 'var(--tv-green)' : 'var(--tv-red)';
    }

    if (candle.volume !== undefined && volEl) {
      volEl.textContent = Number(candle.volume).toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    // Dynamic EMA legend values
    const ema20El = document.getElementById('leg-ema20');
    const ema50El = document.getElementById('leg-ema50');
    if (indConfig.ema && indConfig.ema20 !== false && ema20El && currentCandles && currentCandles.length >= 20) {
      const ema20Arr = IndicatorEngine.calculateEMA(currentCandles, 20);
      if (ema20Arr.length > 0) ema20El.textContent = ema20Arr[ema20Arr.length - 1].value.toFixed(digits);
    }
    if (indConfig.ema && indConfig.ema50 !== false && ema50El && currentCandles && currentCandles.length >= 50) {
      const ema50Arr = IndicatorEngine.calculateEMA(currentCandles, 50);
      if (ema50Arr.length > 0) ema50El.textContent = ema50Arr[ema50Arr.length - 1].value.toFixed(digits);
    }

    // Status translations
    const legObs = document.getElementById('leg-obs');
    const legFvgs = document.getElementById('leg-fvgs');
    if (legObs && window.I18N) legObs.textContent = window.I18N.t('active');
    if (legFvgs && window.I18N) legFvgs.textContent = window.I18N.t('tracking');
  }

  /**
   * Sets up real-time market data feed & listeners
   */
  function setupDataFeed() {
    const initial = DataFeed.loadInitialData();
    currentCandles = initial.candles;
    updateChartData(initial.candles);
    updateHeaderSymbolInfo(initial.symbol);
    if (initial.candles && initial.candles.length > 0) {
      updateLegendWithCandle(initial.candles[initial.candles.length - 1]);
    }

    // Set immediate initial values for quick order bar & header
    const initPrice = initial.symbol.basePrice;
    const initDigits = initial.symbol.digits;
    const initStats = DataFeed.getStats(initial.symbol.id);
    const initPct = initStats ? initStats.changePercent.toFixed(2) : '+0.70';
    const hPriceEl = document.getElementById('header-symbol-price');
    const qSellEl = document.getElementById('quick-sell-price');
    const qBuyEl = document.getElementById('quick-buy-price');
    const chgPill = document.getElementById('header-symbol-change');
    if (hPriceEl) hPriceEl.textContent = initPrice.toFixed(initDigits);
    if (qSellEl) qSellEl.textContent = (initPrice - initial.symbol.tickSize).toFixed(initDigits);
    if (qBuyEl) qBuyEl.textContent = (initPrice + initial.symbol.tickSize).toFixed(initDigits);
    if (chgPill) {
      chgPill.textContent = (initPct >= 0 ? '+' : '') + initPct + '%';
      chgPill.className = 'tv-symbol-change ' + (initPct >= 0 ? 'positive' : 'negative');
    }

    // Live History Updates from server
    DataFeed.onHistoryUpdate(candles => {
      if (!isReplayMode && candles && candles.length > 0) {
        if (currentCandles && currentCandles.length === candles.length &&
            currentCandles[currentCandles.length - 1].time === candles[candles.length - 1].time &&
            currentCandles[currentCandles.length - 1].close === candles[candles.length - 1].close) {
          return;
        }
        // Save candles immediately into IndexedDB for 0ms refresh!
        if (window.TVStorage && window.TVStorage.saveCandles) {
          window.TVStorage.saveCandles(DataFeed.getCurrentSymbol().id, DataFeed.getCurrentResolution(), candles);
        }
        updateChartData(candles);
      }
    });

    // Real-time quotes updates from server
    DataFeed.onQuotes(statsMap => {
      const wlItems = document.querySelectorAll('.tv-watchlist-item');
      wlItems.forEach(item => {
        const symEl = item.querySelector('.tv-wl-symbol');
        if (!symEl) return;
        const symName = symEl.textContent.trim();
        const sym = DataFeed.getSymbols().find(s => s.name === symName);
        if (sym && statsMap[sym.id]) {
          const st = statsMap[sym.id];
          const prEl = item.querySelector('.tv-wl-price');
          const pctEl = item.querySelector('.tv-wl-pct');
          if (prEl) prEl.textContent = st.price.toFixed(sym.digits);
          if (pctEl) {
            const pct = st.changePercent.toFixed(2);
            const isPos = st.changePercent >= 0;
            pctEl.textContent = (isPos ? '+' : '') + pct + '%';
            pctEl.className = 'tv-wl-pct ' + (isPos ? 'pos' : 'neg');
          }
        }
      });
    });

    // Live Tick Updates
    DataFeed.onTick(tickData => {
      if (isReplayMode) return;
      if (candleSeries) {
        candleSeries.update(tickData.bar);
        const isUp = tickData.bar.close >= tickData.bar.open;
        const upCol = document.getElementById('cs-candle-up')?.value || '#089981';
        const downCol = document.getElementById('cs-candle-down')?.value || '#f23645';
        candleSeries.applyOptions({ priceLineColor: isUp ? upCol : downCol });
      }
      updateLegendWithCandle(tickData.bar);

      // Keep current candle bar updated or append new candle when period rolls over
      if (currentCandles.length > 0) {
        const last = currentCandles[currentCandles.length - 1];
        if (tickData.bar.time > last.time) {
          currentCandles.push(tickData.bar);
          if (currentCandles.length > 2500) currentCandles.shift();
        } else {
          currentCandles[currentCandles.length - 1] = tickData.bar;
        }
      }
      
      // Update Volume
      if (volumeSeries && indConfig.volume) {
        volumeSeries.update({
          time: tickData.bar.time,
          value: tickData.bar.volume,
          color: tickData.bar.close >= tickData.bar.open ? 'rgba(8, 153, 129, 0.35)' : 'rgba(242, 54, 69, 0.35)'
        });
      }

      // Update Quick Buy/Sell & Header Prices
      const currentPrice = tickData.price;
      const digits = tickData.symbol.digits;
      const formatted = currentPrice.toFixed(digits);

      const hPrice = document.getElementById('header-symbol-price');
      if (hPrice) hPrice.textContent = formatted;
      const qSell = document.getElementById('quick-sell-price');
      if (qSell) qSell.textContent = (currentPrice - tickData.symbol.tickSize).toFixed(digits);
      const qBuy = document.getElementById('quick-buy-price');
      if (qBuy) qBuy.textContent = (currentPrice + tickData.symbol.tickSize).toFixed(digits);

      // Update % change
      const chgPill = document.getElementById('header-symbol-change');
      const pct = tickData.stats.changePercent.toFixed(2);
      chgPill.textContent = (pct >= 0 ? '+' : '') + pct + '%';
      chgPill.className = 'tv-symbol-change ' + (pct >= 0 ? 'positive' : 'negative');

      // Update High/Low/50% EQ price scale lines & countdown badge
      updatePriceScaleLines(currentCandles, currentPrice, tickData.symbol);
      updateCountdownUI();

      // Dynamically update matching watchlist item price
      const wlItems = document.querySelectorAll('.tv-watchlist-item');
      wlItems.forEach(item => {
        const symEl = item.querySelector('.tv-wl-symbol');
        if (symEl && symEl.textContent.trim() === tickData.symbol.name) {
          const prEl = item.querySelector('.tv-wl-price');
          const pctEl = item.querySelector('.tv-wl-pct');
          if (prEl) prEl.textContent = currentPrice.toFixed(digits);
          if (pctEl) {
            const isPos = tickData.stats.changePercent >= 0;
            pctEl.textContent = (isPos ? '+' : '') + pct + '%';
            pctEl.className = 'tv-wl-pct ' + (isPos ? 'pos' : 'neg');
          }
        }
      });

      // Update Paper Trading positions marking
      PaperTrading.onPriceUpdate(tickData.symbol.id, currentPrice);

      // Check Price Alert
      if (alertPrice !== null && Math.abs(currentPrice - alertPrice) < (tickData.symbol.tickSize * 2)) {
        triggerPriceAlert(currentPrice);
      }
    });

    // Connection Status
    DataFeed.onConnectionStatus(status => {
      const label = document.getElementById('connection-label');
      label.textContent = status.label;
      const dot = document.querySelector('.tv-connection-status .pulse-dot');
      if (status.isLive) {
        dot.style.background = '#089981';
      } else {
        dot.style.background = '#2962ff';
      }
    });

    // Order Book Stream
    DataFeed.onOrderBook(renderOrderBook);

    // Time & Sales Stream
    DataFeed.onTrade(renderRecentTrade);
  }

  function updateChartData(candles) {
    if (!candles || candles.length === 0) return;
    currentCandles = candles;

    candleSeries.setData(candles);

    // Volume
    if (indConfig.volume) {
      const volData = candles.map(c => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(8, 153, 129, 0.35)' : 'rgba(242, 54, 69, 0.35)'
      }));
      volumeSeries.setData(volData);
    } else {
      volumeSeries.setData([]);
    }

    // Moving Averages
    if (indConfig.ema) {
      ema20Series.setData(indConfig.ema20 !== false ? IndicatorEngine.calculateEMA(candles, 20) : []);
      ema50Series.setData(indConfig.ema50 !== false ? IndicatorEngine.calculateEMA(candles, 50) : []);
      ema200Series.setData(IndicatorEngine.calculateEMA(candles, 200));
    } else {
      ema20Series.setData([]);
      ema50Series.setData([]);
      ema200Series.setData([]);
    }

    // Bollinger Bands
    if (indConfig.bb) {
      const bb = IndicatorEngine.calculateBollingerBands(candles, 20, 2);
      bbUpperSeries.setData(bb.upper);
      bbLowerSeries.setData(bb.lower);
    } else {
      bbUpperSeries.setData([]);
      bbLowerSeries.setData([]);
    }

    // ICT Smart Money Concepts: Order Blocks, FVGs, Sweeps, BOS
    renderICTMarkers(candles);

    // Update price scale lines & countdown
    const lastBar = candles[candles.length - 1];
    updatePriceScaleLines(candles, lastBar.close, DataFeed.getCurrentSymbol());
    updateCountdownUI();

    // Restore saved zoom / range so chart NEVER changes or jumps on refresh
    let appliedRange = false;
    try {
      const symId = DataFeed.getCurrentSymbol().id;
      const tf = DataFeed.getCurrentResolution();
      const savedRangeStr = localStorage.getItem(`tv_range_${symId}_${tf}`);
      if (savedRangeStr) {
        const r = JSON.parse(savedRangeStr);
        if (r && typeof r.from === 'number' && typeof r.to === 'number' && r.to > r.from) {
          chart.timeScale().setVisibleLogicalRange(r);
          appliedRange = true;
        }
      }
    } catch (e) {}

    if (!appliedRange) {
      if (candles.length > 150) {
        chart.timeScale().setVisibleLogicalRange({
          from: candles.length - 120,
          to: candles.length + 8
        });
      } else {
        chart.timeScale().fitContent();
      }
    }
    updateLegendWithCandle(candles[candles.length - 1]);
  }

  /**
   * Identifies & plots ICT Smart Money Concepts, Trade Executions, Economic Events, and Session Breaks
   */
  function updateChartMarkers(candles = currentCandles) {
    if (!candleSeries || !candles || candles.length === 0) return;

    const allMarkers = [];

    // 1. ICT Smart Money Concepts
    if (indConfig.ob || indConfig.liquidity || indConfig.bos) {
      const concepts = IndicatorEngine.detectICTConcepts(candles);
      if (indConfig.ob) {
        concepts.orderBlocks.forEach(ob => {
          allMarkers.push({
            time: ob.time,
            position: ob.type === 'bullish' ? 'belowBar' : 'aboveBar',
            color: ob.type === 'bullish' ? '#089981' : '#f23645',
            shape: ob.type === 'bullish' ? 'arrowUp' : 'arrowDown',
            text: (ob.type === 'bullish' ? '+OB' : '-OB') + ` (${ob.meanThreshold.toFixed(1)})`
          });
        });
        const statOb = document.getElementById('pine-stat-ob');
        if (statOb) statOb.textContent = `${concepts.orderBlocks.length} Identified`;
      }
      if (indConfig.liquidity) {
        concepts.liquiditySweeps.forEach(swp => {
          allMarkers.push({
            time: swp.time,
            position: swp.type === 'BSL_SWEEP' ? 'aboveBar' : 'belowBar',
            color: '#ff9800',
            shape: 'circle',
            text: swp.label
          });
        });
      }
      if (indConfig.bos) {
        concepts.structureBreaks.forEach(sb => {
          allMarkers.push({
            time: sb.time,
            position: sb.type === 'BOS_BULL' ? 'aboveBar' : 'belowBar',
            color: '#2962ff',
            shape: 'square',
            text: sb.label
          });
        });
      }
      if (indConfig.fvg) {
        const statFvg = document.getElementById('pine-stat-fvg');
        if (statFvg) statFvg.textContent = `${concepts.fvgs.length} Active`;
      }
    }

    // 2. Execution marks (Trading tab: cs-tr-exec-marks, cs-tr-exec-labels)
    const showExecMarks = document.getElementById('cs-tr-exec-marks')?.checked ?? true;
    const showExecLabels = document.getElementById('cs-tr-exec-labels')?.checked ?? false;
    if (showExecMarks && executionMarksHistory.length > 0) {
      executionMarksHistory.forEach(em => {
        allMarkers.push({
          time: em.time,
          position: em.position,
          color: em.color,
          shape: em.shape,
          text: showExecLabels ? em.text : ''
        });
      });
    }

    // Sort markers by time ascending (mandatory for Lightweight Charts)
    allMarkers.sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(allMarkers);
  }

  function renderICTMarkers(candles) {
    updateChartMarkers(candles);
  }


  function updateHeaderSymbolInfo(symbol) {
    const iconEl = document.getElementById('header-symbol-icon');
    if (iconEl) iconEl.textContent = symbol.icon;
    const nameEl = document.getElementById('header-symbol-name');
    if (nameEl) nameEl.textContent = symbol.name.replace('/', '');
    const wmEl = document.getElementById('chart-watermark');
    if (wmEl) wmEl.textContent = symbol.name;
    const obEl = document.getElementById('ob-symbol-tag');
    if (obEl) obEl.textContent = symbol.name;
  }

  const DRAWING_TOOLS_CONFIG = {
    trendline: {
      id: 'trendline',
      name: 'Trendline',
      shortcut: 'Alt + T',
      icon: '<circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="5" r="2.5"/><line x1="7" y1="17" x2="17" y2="7"/>'
    },
    ray: {
      id: 'ray',
      name: 'Ray',
      shortcut: '',
      icon: '<circle cx="5" cy="19" r="2.5"/><circle cx="13" cy="11" r="2"/><line x1="7" y1="17" x2="21" y2="3"/>'
    },
    info_line: {
      id: 'info_line',
      name: 'Info line',
      shortcut: '',
      icon: '<circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><line x1="7" y1="17" x2="17" y2="7"/><rect x="7" y="10" width="8" height="5" rx="2.5" fill="none" stroke="currentColor"/>'
    },
    extended_line: {
      id: 'extended_line',
      name: 'Extended line',
      shortcut: '',
      icon: '<circle cx="8" cy="16" r="2"/><circle cx="16" cy="8" r="2"/><line x1="2" y1="22" x2="22" y2="2"/>'
    },
    trend_angle: {
      id: 'trend_angle',
      name: 'Trend angle',
      shortcut: '',
      icon: '<line x1="4" y1="19" x2="20" y2="19"/><line x1="4" y1="19" x2="18" y2="5"/><path d="M10 19a6 6 0 0 0-1-4"/><circle cx="4" cy="19" r="2"/>'
    },
    hline: {
      id: 'hline',
      name: 'Horizontal line',
      shortcut: 'Alt + H',
      icon: '<line x1="2" y1="12" x2="22" y2="12"/><circle cx="7" cy="12" r="2"/><circle cx="17" cy="12" r="2"/>'
    },
    hray: {
      id: 'hray',
      name: 'Horizontal ray',
      shortcut: 'Alt + J',
      icon: '<circle cx="5" cy="12" r="2"/><line x1="7" y1="12" x2="22" y2="12"/>'
    },
    vline: {
      id: 'vline',
      name: 'Vertical line',
      shortcut: 'Alt + V',
      icon: '<line x1="12" y1="2" x2="12" y2="22"/><circle cx="12" cy="7" r="2"/><circle cx="12" cy="17" r="2"/>'
    },
    crossline: {
      id: 'crossline',
      name: 'Crossline',
      shortcut: 'Alt + C',
      icon: '<line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="2.5"/>'
    },
    fib: {
      id: 'fib',
      name: 'Fib retracement',
      shortcut: 'Alt + F',
      icon: '<line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/><circle cx="5" cy="7" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="17" r="1.5"/>'
    },
    fib_ext: {
      id: 'fib_ext',
      name: 'Trend-based fib extension',
      shortcut: '',
      icon: '<polyline points="3,17 9,7 15,13"/><line x1="15" y1="7" x2="21" y2="7"/><line x1="15" y1="11" x2="21" y2="11"/><line x1="15" y1="15" x2="21" y2="15"/>'
    },
    fib_channel: {
      id: 'fib_channel',
      name: 'Fib channel',
      shortcut: '',
      icon: '<line x1="4" y1="18" x2="18" y2="4"/><line x1="7" y1="21" x2="21" y2="7"/><line x1="2" y1="15" x2="15" y2="2"/><circle cx="4" cy="18" r="1.5"/><circle cx="18" cy="4" r="1.5"/>'
    },
    fib_time: {
      id: 'fib_time',
      name: 'Fib time zone',
      shortcut: '',
      icon: '<line x1="4" y1="4" x2="4" y2="20"/><line x1="8" y1="4" x2="8" y2="20"/><line x1="13" y1="4" x2="13" y2="20"/><line x1="20" y1="4" x2="20" y2="20"/><circle cx="4" cy="8" r="1.2"/><circle cx="8" cy="14" r="1.2"/>'
    },
    fib_fan: {
      id: 'fib_fan',
      name: 'Fib speed resistance fan',
      shortcut: '',
      icon: '<line x1="4" y1="20" x2="20" y2="4"/><line x1="4" y1="20" x2="20" y2="10"/><line x1="4" y1="20" x2="20" y2="16"/><line x1="4" y1="20" x2="20" y2="20"/><circle cx="4" cy="20" r="1.5"/><circle cx="20" cy="4" r="1.5"/>'
    },
    fib_trend_time: {
      id: 'fib_trend_time',
      name: 'Trend-based fib time',
      shortcut: '',
      icon: '<polyline points="3,18 8,6 13,12"/><line x1="8" y1="3" x2="8" y2="21"/><line x1="13" y1="3" x2="13" y2="21"/><line x1="18" y1="3" x2="18" y2="21"/>'
    },
    fib_circles: {
      id: 'fib_circles',
      name: 'Fib circles',
      shortcut: '',
      icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="2"/>'
    },
    fib_spiral: {
      id: 'fib_spiral',
      name: 'Fib spiral',
      shortcut: '',
      icon: '<path d="M12 12a2 2 0 0 1 2 2 4 4 0 0 1-4 4 6 6 0 0 1-6-6 8 8 0 0 1 8-8 10 10 0 0 1 10 10"/>'
    },
    fib_arcs: {
      id: 'fib_arcs',
      name: 'Fib speed resistance arcs',
      shortcut: '',
      icon: '<path d="M4 20a16 16 0 0 1 16-16"/><path d="M4 20a11 11 0 0 1 11-11"/><path d="M4 20a7 7 0 0 1 7-7"/><line x1="4" y1="20" x2="20" y2="4"/>'
    },
    fib_wedge: {
      id: 'fib_wedge',
      name: 'Fib wedge',
      shortcut: '',
      icon: '<line x1="3" y1="20" x2="21" y2="4"/><line x1="3" y1="20" x2="21" y2="10"/><line x1="3" y1="20" x2="21" y2="16"/><path d="M14 16a8 8 0 0 0 4-4"/>'
    },
    pitchfan: {
      id: 'pitchfan',
      name: 'Pitchfan',
      shortcut: '',
      icon: '<line x1="4" y1="12" x2="20" y2="4"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="12" x2="20" y2="20"/><line x1="4" y1="8" x2="4" y2="16"/>'
    },
    gann_box: {
      id: 'gann_box',
      name: 'Gann box',
      shortcut: '',
      icon: '<rect x="4" y="4" width="16" height="16"/><line x1="4" y1="4" x2="20" y2="20"/><line x1="4" y1="20" x2="20" y2="4"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="12" y1="4" x2="12" y2="20"/><circle cx="4" cy="4" r="1.5"/><circle cx="20" cy="20" r="1.5"/>'
    },
    gann_sq_fixed: {
      id: 'gann_sq_fixed',
      name: 'Gann square fixed',
      shortcut: '',
      icon: '<rect x="4" y="4" width="16" height="16"/><line x1="4" y1="4" x2="20" y2="20"/><line x1="4" y1="20" x2="20" y2="4"/><circle cx="12" cy="12" r="1.5"/>'
    },
    gann_square: {
      id: 'gann_square',
      name: 'Gann square',
      shortcut: '',
      icon: '<rect x="4" y="4" width="16" height="16"/><line x1="4" y1="12" x2="12" y2="4"/><line x1="12" y1="4" x2="20" y2="12"/><line x1="20" y1="12" x2="12" y2="20"/><line x1="12" y1="20" x2="4" y2="12"/><circle cx="4" cy="20" r="1.5"/>'
    },
    gann_fan: {
      id: 'gann_fan',
      name: 'Gann fan',
      shortcut: '',
      icon: '<line x1="4" y1="20" x2="20" y2="4"/><line x1="4" y1="20" x2="20" y2="8"/><line x1="4" y1="20" x2="20" y2="12"/><line x1="4" y1="20" x2="20" y2="16"/><line x1="4" y1="20" x2="16" y2="4"/><line x1="4" y1="20" x2="12" y2="4"/><line x1="4" y1="20" x2="8" y2="4"/>'
    },
    rectangle: {
      id: 'rectangle',
      name: 'Rectangle (Order Block)',
      shortcut: '',
      icon: '<rect x="5" y="5" width="14" height="14" rx="1"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>'
    },
    text: {
      id: 'text',
      name: 'Text Annotation',
      shortcut: '',
      icon: '<path d="M4 6V4h16v2h-1v1H13v12h2.5v2h-7v-2H11V7H5V6H4z" fill="currentColor"/>'
    },
    long_pos: {
      id: 'long_pos',
      name: 'Long Position (Buy)',
      shortcut: '',
      icon: '<rect x="4" y="4" width="16" height="7" fill="#089981" rx="1.5"/><rect x="4" y="13" width="16" height="7" fill="#f23645" rx="1.5"/><line x1="3" y1="12" x2="21" y2="12" stroke="#ffffff" stroke-width="1.6"/>'
    },
    short_pos: {
      id: 'short_pos',
      name: 'Short Position (Sell)',
      shortcut: '',
      icon: '<rect x="4" y="4" width="16" height="7" fill="#f23645" rx="1.5"/><rect x="4" y="13" width="16" height="7" fill="#089981" rx="1.5"/><line x1="3" y1="12" x2="21" y2="12" stroke="#ffffff" stroke-width="1.6"/>'
    },
    patterns: {
      id: 'patterns',
      name: 'Patterns',
      shortcut: '',
      icon: '<polyline points="4,19 12,6 20,19 12,14 4,19"/><circle cx="4" cy="19" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="20" cy="19" r="2"/>'
    },
    measure: {
      id: 'measure',
      name: 'Measure',
      shortcut: 'Shift + Drag',
      icon: '<path d="M6 18L18 6l2 2-12 12zM8.5 15.5l1.5-1.5M11.5 12.5l2-2M14.5 9.5l1.5-1.5"/>'
    },
    stickers: {
      id: 'stickers',
      name: 'Stickers & Icons',
      shortcut: '',
      icon: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/><path d="M8 14.5c1.2 1.8 2.8 2.5 4 2.5s2.8-.7 4-2.5"/>'
    }
  };

  let favoriteTools = ['trendline', 'hray', 'fib', 'long_pos', 'gann_box'];

  function selectDrawingTool(tool, isShortcut = false) {
    if (!tool) return;
    if (window.DrawingEngine) {
      window.DrawingEngine.setTool(tool);
    }

    // Update active button on left toolbar
    document.querySelectorAll('.tv-toolbar-left .tv-tool-btn').forEach(b => b.classList.remove('active'));

    const lineTools = ['trendline', 'ray', 'info_line', 'extended_line', 'trend_angle', 'hline', 'hray', 'vline', 'crossline'];
    const linesGroupBtn = document.getElementById('btn-group-lines');
    const fibTools = ['fib', 'fib_ext', 'fib_channel', 'fib_time', 'fib_fan', 'fib_trend_time', 'fib_circles', 'fib_spiral', 'fib_arcs', 'fib_wedge', 'pitchfan', 'gann_box', 'gann_sq_fixed', 'gann_square', 'gann_fan'];
    const fibGroupBtn = document.getElementById('btn-group-fib');
    const predictionTools = ['long_pos', 'short_pos'];
    const predictionGroupBtn = document.getElementById('btn-group-prediction');

    if (lineTools.includes(tool) && linesGroupBtn) {
      linesGroupBtn.classList.add('active');
      linesGroupBtn.setAttribute('data-tool', tool);
      const iconEl = document.getElementById('lines-current-icon');
      if (iconEl && DRAWING_TOOLS_CONFIG[tool]) {
        iconEl.innerHTML = `<svg viewBox="0 0 24 24">${DRAWING_TOOLS_CONFIG[tool].icon}</svg>`;
      }
    } else if (fibTools.includes(tool) && fibGroupBtn) {
      fibGroupBtn.classList.add('active');
      fibGroupBtn.setAttribute('data-tool', tool);
      const iconEl = document.getElementById('fib-current-icon');
      if (iconEl && DRAWING_TOOLS_CONFIG[tool]) {
        iconEl.innerHTML = `<svg viewBox="0 0 24 24">${DRAWING_TOOLS_CONFIG[tool].icon}</svg>`;
      }
    } else if (predictionTools.includes(tool) && predictionGroupBtn) {
      predictionGroupBtn.classList.add('active');
      predictionGroupBtn.setAttribute('data-tool', tool);
      const iconEl = document.getElementById('prediction-current-icon');
      if (iconEl && DRAWING_TOOLS_CONFIG[tool]) {
        iconEl.innerHTML = `<svg viewBox="0 0 24 24">${DRAWING_TOOLS_CONFIG[tool].icon}</svg>`;
      }
    } else {
      const directBtn = document.querySelector(`.tv-toolbar-left .tv-tool-btn[data-tool="${tool}"]`);
      if (directBtn) directBtn.classList.add('active');
    }

    // Mark flyout item active
    document.querySelectorAll('.tv-flyout-item').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-tool') === tool);
    });

    // Update favorite toolbar active item
    document.querySelectorAll('.tv-fav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tool') === tool);
    });

    if (isShortcut && DRAWING_TOOLS_CONFIG[tool]) {
      const cfg = DRAWING_TOOLS_CONFIG[tool];
      showToast(`${cfg.name} (${cfg.shortcut}) selected`);
    }
  }

  window.selectDrawingTool = selectDrawingTool;

  function toggleFavorite(toolId) {
    if (!toolId || !DRAWING_TOOLS_CONFIG[toolId]) return;
    const idx = favoriteTools.indexOf(toolId);
    if (idx > -1) {
      favoriteTools.splice(idx, 1);
      showToast(`${DRAWING_TOOLS_CONFIG[toolId].name} removed from favorites`);
    } else {
      favoriteTools.push(toolId);
      showToast(`${DRAWING_TOOLS_CONFIG[toolId].name} added to favorites`);
    }
    try {
      localStorage.setItem('tv_favorite_tools', JSON.stringify(favoriteTools));
    } catch (e) {}
    renderFavoriteToolbar();
  }

  function renderFavoriteToolbar() {
    const favToolbar = document.getElementById('tv-fav-toolbar');
    const container = document.getElementById('fav-items-container');
    if (!favToolbar || !container) return;

    // 1. Update star buttons in flyout
    document.querySelectorAll('.tv-fav-star-btn[data-fav-tool]').forEach(starBtn => {
      const tId = starBtn.getAttribute('data-fav-tool');
      const isFav = favoriteTools.includes(tId);
      starBtn.classList.toggle('active', isFav);
      starBtn.setAttribute('title', isFav ? 'Remove from favorites' : 'Add to favorites');
    });

    // 2. If no favorites, hide toolbar
    if (favoriteTools.length === 0) {
      favToolbar.style.display = 'none';
      return;
    }

    favToolbar.style.display = 'flex';
    container.innerHTML = '';

    const curTool = window.DrawingEngine ? window.DrawingEngine.getTool() : null;

    favoriteTools.forEach(toolId => {
      const cfg = DRAWING_TOOLS_CONFIG[toolId];
      if (!cfg) return;

      const btn = document.createElement('button');
      btn.className = `tv-fav-btn ${curTool === toolId ? 'active' : ''}`;
      btn.setAttribute('data-tool', toolId);
      btn.setAttribute('title', `${cfg.name}${cfg.shortcut ? ' (' + cfg.shortcut + ')' : ''}`);
      btn.innerHTML = `<svg viewBox="0 0 24 24">${cfg.icon}</svg>`;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectDrawingTool(toolId);
      });

      container.appendChild(btn);
    });
  }

  function setupFavoritesEngine() {
    const savedFavs = localStorage.getItem('tv_favorite_tools');
    if (savedFavs) {
      try {
        const parsed = JSON.parse(savedFavs);
        if (Array.isArray(parsed)) favoriteTools = parsed;
      } catch (e) {
        favoriteTools = ['trendline', 'hray', 'fib', 'gann_box'];
      }
    } else {
      // Defaults matching Photo 1 & Photo 2 (Trendline, Horizontal ray, Fib, Gann Box)
      favoriteTools = ['trendline', 'hray', 'fib', 'gann_box'];
    }

    // Star clicks
    document.addEventListener('click', (e) => {
      const starBtn = e.target.closest('.tv-fav-star-btn');
      if (starBtn) {
        e.stopPropagation();
        e.preventDefault();
        const toolId = starBtn.getAttribute('data-fav-tool');
        toggleFavorite(toolId);
      }
    });

    renderFavoriteToolbar();
  }

  function setupFavoriteToolbarDrag() {
    const favToolbar = document.getElementById('tv-fav-toolbar');
    const dragHandle = document.getElementById('fav-drag-handle');
    const viewport = document.getElementById('chart-viewport') || (favToolbar ? favToolbar.parentElement : null);
    if (!favToolbar || !dragHandle || !viewport) return;

    // Restore saved position
    const savedPos = localStorage.getItem('tv_fav_toolbar_pos');
    if (savedPos) {
      try {
        const pos = JSON.parse(savedPos);
        if (typeof pos.left === 'number' && typeof pos.top === 'number') {
          favToolbar.style.left = `${pos.left}px`;
          favToolbar.style.top = `${pos.top}px`;
        }
      } catch (e) {}
    }

    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    function onStart(e) {
      if (e.target.closest('.tv-fav-btn')) return;

      isDragging = true;
      favToolbar.classList.add('is-dragging');

      const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

      startX = clientX;
      startY = clientY;

      const rect = favToolbar.getBoundingClientRect();
      const vRect = viewport.getBoundingClientRect();

      initialLeft = rect.left - vRect.left;
      initialTop = rect.top - vRect.top;

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onEnd);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onEnd);
      e.preventDefault();
    }

    function onMove(e) {
      if (!isDragging) return;
      const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

      const dx = clientX - startX;
      const dy = clientY - startY;

      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      const vRect = viewport.getBoundingClientRect();
      const tRect = favToolbar.getBoundingClientRect();

      const maxLeft = Math.max(0, vRect.width - tRect.width);
      const maxTop = Math.max(0, vRect.height - tRect.height);

      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      favToolbar.style.left = `${newLeft}px`;
      favToolbar.style.top = `${newTop}px`;
      if (e.cancelable) e.preventDefault();
    }

    function onEnd() {
      if (!isDragging) return;
      isDragging = false;
      favToolbar.classList.remove('is-dragging');

      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);

      const left = parseInt(favToolbar.style.left, 10);
      const top = parseInt(favToolbar.style.top, 10);
      if (!isNaN(left) && !isNaN(top)) {
        try {
          localStorage.setItem('tv_fav_toolbar_pos', JSON.stringify({ left, top }));
        } catch (e) {}
      }
    }

    dragHandle.addEventListener('mousedown', onStart);
    dragHandle.addEventListener('touchstart', onStart, { passive: false });

    favToolbar.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.tv-fav-btn')) {
        onStart(e);
      }
    });
    favToolbar.addEventListener('touchstart', (e) => {
      if (!e.target.closest('.tv-fav-btn')) {
        onStart(e);
      }
    }, { passive: false });
  }

  function setupDrawingShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const code = e.code;
        let targetTool = null;
        if (code === 'KeyT') targetTool = 'trendline';
        else if (code === 'KeyH') targetTool = 'hline';
        else if (code === 'KeyJ') targetTool = 'hray';
        else if (code === 'KeyV') targetTool = 'vline';
        else if (code === 'KeyC') targetTool = 'crossline';
        else if (code === 'KeyF') targetTool = 'fib';

        if (targetTool) {
          e.preventDefault();
          selectDrawingTool(targetTool, true);
        }
      }
    });
  }

  /**
   * Toolbar & Drawing tools setup
   */
  function setupToolbar() {
    // 1. Click on small flyout arrow › to toggle flyout open/closed
    document.querySelectorAll('.tv-tool-btn .tv-flyout-arrow').forEach(arrow => {
      arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const parentBtn = arrow.closest('.tv-tool-btn');
        const flyout = parentBtn?.querySelector('.tv-tool-flyout');
        if (!flyout) return;

        const isCurrentlyOpen = flyout.classList.contains('is-open');

        // Close any other open flyouts
        document.querySelectorAll('.tv-tool-flyout.is-open').forEach(f => f.classList.remove('is-open'));
        document.querySelectorAll('.tv-tool-btn.flyout-open').forEach(b => b.classList.remove('flyout-open'));

        if (!isCurrentlyOpen) {
          flyout.classList.add('is-open');
          parentBtn.classList.add('flyout-open');
        }
      });
    });

    // 2. Right-click on any group button also opens its flyout (TradingView standard)
    document.querySelectorAll('.tv-tool-btn.tv-has-flyout').forEach(btn => {
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const flyout = btn.querySelector('.tv-tool-flyout');
        if (flyout) {
          document.querySelectorAll('.tv-tool-flyout.is-open').forEach(f => f.classList.remove('is-open'));
          document.querySelectorAll('.tv-tool-btn.flyout-open').forEach(b => b.classList.remove('flyout-open'));
          flyout.classList.add('is-open');
          btn.classList.add('flyout-open');
        }
      });
    });

    // 3. Click on main toolbar buttons
    document.querySelectorAll('.tv-toolbar-left .tv-tool-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        // If arrow was clicked, handled above
        if (e.target.closest('.tv-flyout-arrow')) return;
        // If clicking inside flyout menu, handled by item listener
        if (e.target.closest('.tv-tool-flyout')) return;

        const tool = btn.getAttribute('data-tool');
        if (!tool) return;

        // If button has flyout and is ALREADY active, clicking it again toggles flyout open so user can pick other options!
        const flyout = btn.querySelector('.tv-tool-flyout');
        if (flyout && btn.classList.contains('active') && !flyout.classList.contains('is-open')) {
          document.querySelectorAll('.tv-tool-flyout.is-open').forEach(f => f.classList.remove('is-open'));
          document.querySelectorAll('.tv-tool-btn.flyout-open').forEach(b => b.classList.remove('flyout-open'));
          flyout.classList.add('is-open');
          btn.classList.add('flyout-open');
          return;
        }

        // Close any open flyout
        document.querySelectorAll('.tv-tool-flyout.is-open').forEach(f => f.classList.remove('is-open'));
        document.querySelectorAll('.tv-tool-btn.flyout-open').forEach(b => b.classList.remove('flyout-open'));

        // Toggle back to cursor if clicking currently active tool without flyout
        if (tool !== 'cursor' && window.DrawingEngine && window.DrawingEngine.getTool() === tool && !btn.classList.contains('tv-has-flyout')) {
          selectDrawingTool('cursor');
          return;
        }

        selectDrawingTool(tool);
      });
    });

    // 4. Click on an option INSIDE the flyout menu
    document.querySelectorAll('.tv-flyout-item[data-tool]').forEach(item => {
      item.addEventListener('click', (e) => {
        // Star button handled separately
        if (e.target.closest('.tv-fav-star-btn')) return;
        e.stopPropagation();
        e.preventDefault();

        const tool = item.getAttribute('data-tool');
        if (!tool) return;

        // Close flyout
        document.querySelectorAll('.tv-tool-flyout.is-open').forEach(f => f.classList.remove('is-open'));
        document.querySelectorAll('.tv-tool-btn.flyout-open').forEach(b => b.classList.remove('flyout-open'));

        // Always activate the selected tool immediately
        selectDrawingTool(tool);
      });
    });

    // 5. Close flyouts when clicking anywhere outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.tv-has-flyout')) {
        document.querySelectorAll('.tv-tool-flyout.is-open').forEach(f => f.classList.remove('is-open'));
        document.querySelectorAll('.tv-tool-btn.flyout-open').forEach(b => b.classList.remove('flyout-open'));
      }
    });

    setupFavoritesEngine();
    setupFavoriteToolbarDrag();
    setupDrawingShortcuts();

    // Shift + Click / Drag to measure anywhere on chart (TradingView shortcut)
    const viewport = document.getElementById('chart-viewport');
    if (viewport) {
      viewport.addEventListener('mousedown', (e) => {
        if (e.shiftKey && e.button === 0) {
          selectDrawingTool('measure');
        }
      });
    }

    // Compare / Add Symbol button
    const compareBtn = document.getElementById('btn-compare');
    if (compareBtn) {
      compareBtn.addEventListener('click', () => {
        const symModal = document.getElementById('modal-symbol-search');
        if (symModal) symModal.classList.add('active');
      });
    }

    // Indicator Templates button
    const templatesBtn = document.getElementById('btn-templates');
    if (templatesBtn) {
      templatesBtn.addEventListener('click', () => {
        const indModal = document.getElementById('modal-indicators');
        if (indModal) indModal.classList.add('active');
      });
    }

    // Chart Line Mode button
    const lineBtn = document.getElementById('btn-chart-line');
    if (lineBtn) {
      lineBtn.addEventListener('click', () => {
        if (chart) setChartType('line');
      });
    }

    // Magnet mode
    let magnet = false;
    document.getElementById('btn-magnet').addEventListener('click', function () {
      magnet = !magnet;
      this.classList.toggle('active', magnet);
      if (window.DrawingEngine) DrawingEngine.setMagnetMode(magnet);
    });

    // Stay in Drawing mode (Pencil with lock)
    const stayDrawBtn = document.getElementById('btn-stay-draw');
    if (stayDrawBtn) {
      stayDrawBtn.addEventListener('click', function () {
        this.classList.toggle('active');
        if (window.DrawingEngine && window.DrawingEngine.setStayInDrawingMode) {
          window.DrawingEngine.setStayInDrawingMode(this.classList.contains('active'));
        }
      });
    }

    // Lock drawings
    let locked = false;
    document.getElementById('btn-lock').addEventListener('click', function () {
      locked = !locked;
      this.classList.toggle('active', locked);
      if (window.DrawingEngine) DrawingEngine.toggleLock(locked);
    });

    // Hide drawings
    let hidden = false;
    document.getElementById('btn-hide').addEventListener('click', function () {
      hidden = !hidden;
      this.classList.toggle('active', hidden);
      if (window.DrawingEngine) DrawingEngine.toggleHide(hidden);
    });

    // Sync in Layout
    const syncDrawBtn = document.getElementById('btn-sync-draw');
    if (syncDrawBtn) {
      syncDrawBtn.addEventListener('click', function () {
        this.classList.toggle('active');
      });
    }

    // Measure tool
    const measureBtn = document.getElementById('btn-tool-measure');
    if (measureBtn) {
      measureBtn.addEventListener('click', function () {
        selectDrawingTool('measure');
      });
    }

    // Zoom In tool
    const zoomBtn = document.getElementById('btn-tool-zoom');
    if (zoomBtn) {
      zoomBtn.addEventListener('click', function () {
        if (chart) chart.timeScale().zoomIn(1.5);
      });
    }

    // Clear drawings
    document.getElementById('btn-clear-drawings').addEventListener('click', () => {
      if (window.DrawingEngine && window.DrawingEngine.clearAllDrawings) {
        window.DrawingEngine.clearAllDrawings();
      }
    });

    // Fullscreen toggle
    document.getElementById('btn-fullscreen').addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // Screenshot export (TradingView Style Copy / Save)
    setupScreenshotDropdown();

    // Chart style switch
    const chartTypeBtn = document.getElementById('btn-chart-type');
    const chartTypes = ['Candles', 'Line', 'Area'];
    let currentTypeIdx = 0;
    chartTypeBtn.addEventListener('click', () => {
      currentTypeIdx = (currentTypeIdx + 1) % chartTypes.length;
      const type = chartTypes[currentTypeIdx];
      const lbl = document.getElementById('chart-type-label');
      if (lbl) lbl.textContent = type;
      showToast(`Chart Type: ${type}`);
    });
  }

  /**
   * ========================================================
   * TradingView Pro - Bar Replay Engine & Interactive Popups
   * ========================================================
   */
  function setupReplayEngine() {
    const replayBar = document.getElementById('tv-replay-bar');
    const btnReplay = document.getElementById('btn-replay');
    const startModeBtn = document.getElementById('btn-replay-start-mode');
    const startChevronBtn = document.getElementById('btn-replay-start-chevron');
    const popupStart = document.getElementById('popup-starting-point');
    const playBtn = document.getElementById('btn-replay-play');
    const stepBtn = document.getElementById('btn-replay-step');
    const speedBtn = document.getElementById('btn-replay-speed');
    const popupSpeed = document.getElementById('popup-replay-speed');
    const jumpRealtimeBtn = document.getElementById('btn-replay-jump-realtime');
    const closeBtn = document.getElementById('btn-replay-close');

    if (!replayBar || !btnReplay) return;

    // Toggle Replay Bar from header
    btnReplay.addEventListener('click', (e) => {
      e.stopPropagation();
      if (replayBar.style.display === 'none' || !isReplayMode) {
        enterReplayMode();
      } else {
        exitReplayMode();
      }
    });

    // Start mode button click (triggers current action)
    if (startModeBtn) {
      startModeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllReplayPopups();
        executeStartMode(currentStartMode);
      });
    }

    // Start chevron button click (toggles popup 1: SELECT STARTING POINT)
    if (startChevronBtn) {
      startChevronBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (popupSpeed) popupSpeed.style.display = 'none';
        if (popupStart) {
          popupStart.style.display = (popupStart.style.display === 'none' || !popupStart.style.display) ? 'block' : 'none';
        }
      });
    }

    // Popup 1: Starting point items
    if (popupStart) {
      const items = popupStart.querySelectorAll('.tv-replay-popup-item');
      items.forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const mode = item.getAttribute('data-start-mode');
          setStartMode(mode);
          popupStart.style.display = 'none';
          executeStartMode(mode);
        });
      });
    }

    // Play / Pause toggle
    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePlayPause();
      });
    }

    // Step forward 1 bar
    if (stepBtn) {
      stepBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        stepForward();
      });
    }

    // Speed selector button (toggles popup 2: REPLAY SPEED)
    if (speedBtn) {
      speedBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (popupStart) popupStart.style.display = 'none';
        if (popupSpeed) {
          popupSpeed.style.display = (popupSpeed.style.display === 'none' || !popupSpeed.style.display) ? 'block' : 'none';
        }
      });
    }

    // Popup 2: Replay speed items
    if (popupSpeed) {
      const items = popupSpeed.querySelectorAll('.tv-replay-popup-item');
      items.forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          items.forEach(el => el.classList.remove('active'));
          item.classList.add('active');

          const speedVal = item.getAttribute('data-speed');
          const interval = parseInt(item.getAttribute('data-interval'), 10) || 100;
          replaySpeedInterval = interval;

          const speedLabel = document.getElementById('replay-speed-val');
          if (speedLabel) speedLabel.textContent = `${speedVal}x`;

          // If currently playing, restart interval with new speed
          if (replayTimer) {
            clearInterval(replayTimer);
            replayTimer = setInterval(stepForward, replaySpeedInterval);
          }

          popupSpeed.style.display = 'none';
        });
      });
    }

    // Jump to real-time
    if (jumpRealtimeBtn) {
      jumpRealtimeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        jumpToRealtime();
      });
    }

    // Close Replay
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        exitReplayMode();
      });
    }

    // Close popups on click outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#replay-start-group') && popupStart) {
        popupStart.style.display = 'none';
      }
      if (!e.target.closest('#replay-speed-group') && popupSpeed) {
        popupSpeed.style.display = 'none';
      }
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (replayBar.style.display === 'none' || !isReplayMode) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        stepForward();
      } else if (e.code === 'Escape') {
        closeAllReplayPopups();
        if (isCuttingBarMode) {
          isCuttingBarMode = false;
          hideReplayCutPreview();
          const container = document.getElementById('chart-container');
          if (container) container.style.cursor = 'default';
        }
      }
    });

    // Wire MultiChart click cut handler across all visible panes
    if (window.MultiChartEngine && window.MultiChartEngine.setReplayCutHandler) {
      window.MultiChartEngine.setReplayCutHandler((clickedTime, tfKey) => {
        handleReplayBarCut(clickedTime, tfKey);
      });
    }

    // Chart container mousemove for red vertical cut line preview
    const container = document.getElementById('chart-container');
    if (container) {
      container.addEventListener('mousemove', (e) => {
        if (!isCuttingBarMode) {
          hideReplayCutPreview();
          return;
        }
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        let previewTime = null;
        let previewPrice = null;
        if (chart && typeof chart.timeScale().coordinateToTime === 'function') {
          previewTime = chart.timeScale().coordinateToTime(x);
        }
        if (previewTime && replayFullCandles && replayFullCandles.length > 0) {
          const b = replayFullCandles.find(c => c.time === previewTime);
          if (b) previewPrice = b.close.toFixed(2);
        }
        const dtStr = previewTime ? new Date(previewTime * 1000).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        }) : '';
        showReplayCutPreview(x, dtStr, previewPrice);
      });

      container.addEventListener('mouseleave', () => {
        hideReplayCutPreview();
      });
    }

    // Primary Chart click listener for Bar cutting
    if (chart) {
      chart.subscribeClick((param) => {
        if (!isCuttingBarMode || !param) return;
        let clickedTime = param.time;
        if (!clickedTime && param.point && typeof chart.timeScale().coordinateToTime === 'function') {
          clickedTime = chart.timeScale().coordinateToTime(param.point.x);
        }
        if (!clickedTime && param.point && typeof chart.timeScale().coordinateToLogical === 'function') {
          const logical = Math.round(chart.timeScale().coordinateToLogical(param.point.x));
          if (logical >= 0 && logical < replayFullCandles.length) {
            clickedTime = replayFullCandles[logical].time;
          }
        }
        if (clickedTime) {
          handleReplayBarCut(clickedTime);
        }
      });
    }
  }

  function showReplayCutPreview(x, dateStr, priceStr) {
    let line = document.getElementById('tv-replay-cut-line');
    if (!line) {
      line = document.createElement('div');
      line.id = 'tv-replay-cut-line';
      line.innerHTML = `<div id="tv-replay-cut-tag"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg><span id="replay-cut-tag-text">Jump here</span></div>`;
      const container = document.getElementById('chart-container');
      if (container) container.appendChild(line);
    }
    line.style.display = 'block';
    line.style.transform = `translateX(${x}px)`;
    const tagText = document.getElementById('replay-cut-tag-text');
    if (tagText) {
      tagText.textContent = dateStr ? `Cut here: ${dateStr}${priceStr ? ' @ ' + priceStr : ''}` : 'Jump here (Click to cut)';
    }
  }

  function hideReplayCutPreview() {
    const line = document.getElementById('tv-replay-cut-line');
    if (line) line.style.display = 'none';
  }

  function handleReplayBarCut(clickedTime, tfKey) {
    if (!isCuttingBarMode) return;
    isCuttingBarMode = false;
    const container = document.getElementById('chart-container');
    if (container) container.style.cursor = 'default';
    hideReplayCutPreview();

    const tf = tfKey || document.querySelector('.tv-tf-btn.active')?.getAttribute('data-tf') || DataFeed.getCurrentResolution() || '5m';
    const tfDef = (DataFeed.getTimeframes && DataFeed.getTimeframes()[tf]) || { seconds: 300 };
    replayEffectiveTimestamp = clickedTime + tfDef.seconds - 1;

    // Use mathematically unified getSlicedReplayData for current active timeframe
    const currentActiveTf = document.querySelector('.tv-tf-btn.active')?.getAttribute('data-tf') || tf;
    const sliced = DataFeed.getSlicedReplayData(currentActiveTf, replayEffectiveTimestamp);

    // Load full dataset for stepping forward
    const fullRes = DataFeed.getReplayCandles(currentActiveTf);
    replayFullCandles = (fullRes && fullRes.candles) ? fullRes.candles : sliced;
    replayIndex = Math.max(0, sliced.length - 1);

    const cutBar = sliced[sliced.length - 1];
    replayCutTimestamp = cutBar ? cutBar.time : clickedTime;
    replayCutPrice = cutBar ? cutBar.close : null;

    currentCandles = sliced;
    candleSeries.setData(sliced);

    if (cutBar) {
      if (window.MultiChartEngine && window.MultiChartEngine.syncReplay) {
        window.MultiChartEngine.syncReplay(replayEffectiveTimestamp, false);
      }

      if (volumeSeries && indConfig.volume) {
        const volData = sliced.map(c => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(8, 153, 129, 0.35)' : 'rgba(242, 54, 69, 0.35)'
        }));
        volumeSeries.setData(volData);
      } else if (volumeSeries) {
        volumeSeries.setData([]);
      }

      renderIndicatorsOnly(sliced);
      updateLegendWithCandle(cutBar);
      const sym = DataFeed.getCurrentSymbol();
      updatePriceScaleLines(sliced, cutBar.close, sym);

      const hPriceEl = document.getElementById('header-symbol-price');
      const qSellEl = document.getElementById('quick-sell-price');
      const qBuyEl = document.getElementById('quick-buy-price');
      if (hPriceEl) hPriceEl.textContent = cutBar.close.toFixed(sym.digits);
      if (qSellEl) qSellEl.textContent = (cutBar.close - sym.tickSize).toFixed(sym.digits);
      if (qBuyEl) qBuyEl.textContent = (cutBar.close + sym.tickSize).toFixed(sym.digits);
    }

    chart.timeScale().applyOptions({ barSpacing: 9, minBarSpacing: 3, rightOffset: 12 });
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(-50, sliced.length - 96),
      to: sliced.length + 15
    });

    const dtStr = new Date(clickedTime * 1000).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    showToast(`Cut replay to: ${dtStr} @ ${cutBar ? cutBar.close.toFixed(2) : ''} / បានកាត់ត្រឹម ${dtStr}`);
  }

  function closeAllReplayPopups() {
    const p1 = document.getElementById('popup-starting-point');
    const p2 = document.getElementById('popup-replay-speed');
    if (p1) p1.style.display = 'none';
    if (p2) p2.style.display = 'none';
  }

  function setStartMode(mode) {
    currentStartMode = mode;
    const popupStart = document.getElementById('popup-starting-point');
    if (popupStart) {
      popupStart.querySelectorAll('.tv-replay-popup-item').forEach(item => {
        if (item.getAttribute('data-start-mode') === mode) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
    }

    const modeLabel = document.getElementById('replay-mode-label');
    const modeIcon = document.getElementById('replay-mode-icon');
    if (!modeLabel || !modeIcon) return;

    if (mode === 'bar') {
      modeLabel.textContent = 'Jump to bar';
      modeIcon.innerHTML = `<svg viewBox="0 0 24 24"><line x1="5" y1="4" x2="5" y2="20" stroke-width="2.5"/><path d="M19 12H8M12 8l-4 4 4 4" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    } else if (mode === 'date') {
      modeLabel.textContent = 'Date...';
      modeIcon.innerHTML = `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="3"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="16" y1="2" x2="16" y2="5"/><path d="M14 14H9M11 12l-2 2 2 2"/></svg>`;
    } else if (mode === 'first') {
      modeLabel.textContent = 'First available date';
      modeIcon.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="5" cy="19" r="2"/><line x1="5" y1="4" x2="5" y2="17"/><path d="M5 4h12l-3 4 3 4H5"/><line x1="3" y1="19" x2="21" y2="19"/></svg>`;
    } else {
      modeLabel.textContent = 'Select random bar';
      modeIcon.innerHTML = `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><circle cx="16" cy="8" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="8" cy="16" r="1.5"/><circle cx="16" cy="16" r="1.5"/><path d="M19 2l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" fill="currentColor"/></svg>`;
    }
  }

  function executeStartMode(mode) {
    if (mode === 'bar') {
      enableBarCutMode();
    } else if (mode === 'random') {
      selectRandomBar();
    } else if (mode === 'first') {
      jumpFirstAvailableDate();
    } else if (mode === 'date') {
      promptJumpDate();
    } else {
      enableBarCutMode();
    }
  }

  function jumpFirstAvailableDate() {
    if (!replayFullCandles || replayFullCandles.length < 50) return;
    const targetIdx = Math.min(80, Math.floor(replayFullCandles.length * 0.08));
    const cutBar = replayFullCandles[targetIdx];
    replayCutTimestamp = cutBar.time;
    replayCutPrice = cutBar.close;
    const candleDate = new Date(cutBar.time * 1000).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    sliceReplayTo(targetIdx, `Jumped to first available date (${candleDate}) / ចាក់ពីថ្ងៃដំបូងបង្អស់`);
  }

  function enableBarCutMode() {
    isCuttingBarMode = true;
    const container = document.getElementById('chart-container');
    if (container) container.style.cursor = 'crosshair';
    showToast('Click any candle on the chart to cut replay back to that point / ចុចលើ bar ដើម្បីកាត់');
  }

  function promptJumpDate() {
    if (!replayFullCandles || replayFullCandles.length === 0) return;
    const firstDate = new Date(replayFullCandles[0].time * 1000).toISOString().split('T')[0];
    const input = prompt('Enter starting date (YYYY-MM-DD):', firstDate);
    if (!input) return;
    const targetTime = Math.floor(new Date(input).getTime() / 1000);
    let targetIdx = replayFullCandles.findIndex(c => c.time >= targetTime);
    if (targetIdx === -1) targetIdx = replayFullCandles.length - 1;
    targetIdx = Math.max(10, Math.min(targetIdx, replayFullCandles.length - 5));
    const cutBar = replayFullCandles[targetIdx];
    replayCutTimestamp = cutBar.time;
    replayCutPrice = cutBar.close;
    sliceReplayTo(targetIdx, `Jumped to date: ${input}`);
  }

  function selectRandomBar() {
    if (!replayFullCandles || replayFullCandles.length < 50) return;
    const minIdx = Math.min(150, Math.floor(replayFullCandles.length * 0.25));
    const maxIdx = Math.max(minIdx + 20, replayFullCandles.length - 50);
    const rnd = Math.floor(minIdx + Math.random() * (maxIdx - minIdx));
    const cutBar = replayFullCandles[rnd];
    replayCutTimestamp = cutBar.time;
    replayCutPrice = cutBar.close;
    sliceReplayTo(rnd, 'Random bar selected! Press Play (▶) or Space to start');
  }

  function enterReplayMode() {
    isReplayMode = true;
    if (DataFeed && DataFeed.stopRealtimeTickLoop) {
      DataFeed.stopRealtimeTickLoop();
    }
    const replayBar = document.getElementById('tv-replay-bar');
    const btnReplay = document.getElementById('btn-replay');
    if (replayBar) replayBar.style.display = 'flex';
    if (btnReplay) btnReplay.classList.add('active');

    // Get active timeframe
    const activeTf = document.querySelector('.tv-tf-btn.active');
    const tf = activeTf ? (activeTf.getAttribute('data-tf') || '5m') : (DataFeed.getCurrentResolution() || '5m');

    // Update timeframe badge
    const replayTfBadge = document.getElementById('replay-tf-badge');
    if (replayTfBadge) replayTfBadge.textContent = tf;

    // Load full replay candles from DataFeed for this tf
    const res = (DataFeed && DataFeed.getReplayCandles) ? DataFeed.getReplayCandles(tf) : null;
    replayFullCandles = (res && res.candles && res.candles.length > 0) ? res.candles : [...currentCandles];

    setStartMode('bar');
    enableBarCutMode();
  }

  function exitReplayMode() {
    if (replayTimer) {
      clearInterval(replayTimer);
      replayTimer = null;
    }
    updatePlayPauseButton(false);
    isReplayMode = false;
    isCuttingBarMode = false;
    replayCutTimestamp = null;
    replayCutPrice = null;
    replayEffectiveTimestamp = null;
    hideReplayCutPreview();

    if (DataFeed && DataFeed.startRealtimeTickLoop) {
      DataFeed.startRealtimeTickLoop();
    }

    const container = document.getElementById('chart-container');
    if (container) container.style.cursor = 'default';

    const replayBar = document.getElementById('tv-replay-bar');
    const btnReplay = document.getElementById('btn-replay');
    if (replayBar) replayBar.style.display = 'none';
    if (btnReplay) btnReplay.classList.remove('active');

    closeAllReplayPopups();

    if (replayFullCandles && replayFullCandles.length > 0) {
      updateChartData(replayFullCandles);
    } else {
      updateChartData(currentCandles);
    }
    if (window.MultiChartEngine && window.MultiChartEngine.exitReplay) {
      window.MultiChartEngine.exitReplay();
    }
    showToast('Exited Replay Mode / បានចាកចេញពី Replay');
  }

  function sliceReplayTo(idx, toastMsg) {
    if (replayTimer) {
      clearInterval(replayTimer);
      replayTimer = null;
      updatePlayPauseButton(false);
    }
    if (!replayFullCandles || replayFullCandles.length === 0) return;

    replayIndex = Math.max(0, Math.min(idx, replayFullCandles.length - 1));
    const sliced = replayFullCandles.slice(0, replayIndex + 1);
    currentCandles = sliced;
    candleSeries.setData(sliced);

    const lastBar = sliced[sliced.length - 1];
    if (lastBar) {
      const activeTf = document.querySelector('.tv-tf-btn.active')?.getAttribute('data-tf') || DataFeed.getCurrentResolution() || '5m';
      const tfDef = (DataFeed.getTimeframes && DataFeed.getTimeframes()[activeTf]) || { seconds: 300 };
      replayEffectiveTimestamp = lastBar.time + tfDef.seconds - 1;
      replayCutTimestamp = lastBar.time;
      replayCutPrice = lastBar.close;

      if (window.MultiChartEngine && window.MultiChartEngine.syncReplay) {
        window.MultiChartEngine.syncReplay(replayEffectiveTimestamp, false);
      }

      if (volumeSeries && indConfig.volume) {
        const volData = sliced.map(c => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(8, 153, 129, 0.35)' : 'rgba(242, 54, 69, 0.35)'
        }));
        volumeSeries.setData(volData);
      } else if (volumeSeries) {
        volumeSeries.setData([]);
      }

      renderIndicatorsOnly(sliced);
      updateLegendWithCandle(lastBar);
      const sym = DataFeed.getCurrentSymbol();
      updatePriceScaleLines(sliced, lastBar.close, sym);

      const hPriceEl = document.getElementById('header-symbol-price');
      const qSellEl = document.getElementById('quick-sell-price');
      const qBuyEl = document.getElementById('quick-buy-price');
      if (hPriceEl) hPriceEl.textContent = lastBar.close.toFixed(sym.digits);
      if (qSellEl) qSellEl.textContent = (lastBar.close - sym.tickSize).toFixed(sym.digits);
      if (qBuyEl) qBuyEl.textContent = (lastBar.close + sym.tickSize).toFixed(sym.digits);
    }

    // Standard professional TradingView bar zoom and framing
    chart.timeScale().applyOptions({
      barSpacing: 9,
      minBarSpacing: 3,
      rightOffset: 12
    });
    const targetIdx = sliced.length - 1;
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(-50, targetIdx - 95),
      to: targetIdx + 15
    });
    if (toastMsg) showToast(toastMsg);
  }

  function togglePlayPause() {
    if (replayTimer) {
      // Pause
      clearInterval(replayTimer);
      replayTimer = null;
      updatePlayPauseButton(false);
    } else {
      // Play
      if (replayIndex >= replayFullCandles.length - 1) {
        sliceReplayTo(Math.max(10, replayFullCandles.length - 80), 'Restarting replay...');
      }
      updatePlayPauseButton(true);
      replayTimer = setInterval(stepForward, replaySpeedInterval);
    }
  }

  function updatePlayPauseButton(isPlaying) {
    const playBtn = document.getElementById('btn-replay-play');
    const playIcon = document.getElementById('replay-play-icon');
    if (!playBtn || !playIcon) return;
    if (isPlaying) {
      playBtn.title = 'Pause (Space)';
      playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>';
    } else {
      playBtn.title = 'Play (Space)';
      playIcon.innerHTML = '<polygon points="6,4 20,12 6,20" fill="none" stroke="currentColor" stroke-width="2"/>';
    }
  }

  function stepForward() {
    if (replayIndex < replayFullCandles.length - 1) {
      replayIndex++;
      const nextBar = replayFullCandles[replayIndex];
      candleSeries.update(nextBar);
      currentCandles.push(nextBar);
      replayCutTimestamp = nextBar.time;
      replayCutPrice = nextBar.close;

      const activeTf = document.querySelector('.tv-tf-btn.active')?.getAttribute('data-tf') || DataFeed.getCurrentResolution() || '5m';
      const tfSec = (DataFeed.getTimeframes && DataFeed.getTimeframes()[activeTf] ? DataFeed.getTimeframes()[activeTf].seconds : 300);
      replayEffectiveTimestamp = nextBar.time + tfSec - 1;

      if (window.MultiChartEngine && window.MultiChartEngine.syncReplay) {
        window.MultiChartEngine.syncReplay(replayEffectiveTimestamp, true);
      }

      if (volumeSeries && indConfig.volume) {
        volumeSeries.update({
          time: nextBar.time,
          value: nextBar.volume,
          color: nextBar.close >= nextBar.open ? 'rgba(8, 153, 129, 0.35)' : 'rgba(242, 54, 69, 0.35)'
        });
      }

      updateLegendWithCandle(nextBar);
      const sym = DataFeed.getCurrentSymbol();
      updatePriceScaleLines(currentCandles, nextBar.close, sym);

      const hPriceEl = document.getElementById('header-symbol-price');
      const qSellEl = document.getElementById('quick-sell-price');
      const qBuyEl = document.getElementById('quick-buy-price');
      if (hPriceEl) hPriceEl.textContent = nextBar.close.toFixed(sym.digits);
      if (qSellEl) qSellEl.textContent = (nextBar.close - sym.tickSize).toFixed(sym.digits);
      if (qBuyEl) qBuyEl.textContent = (nextBar.close + sym.tickSize).toFixed(sym.digits);

      // Smoothly advance viewport so current candle stays in view
      const range = chart.timeScale().getVisibleLogicalRange();
      if (range && range.to <= replayIndex + 4) {
        chart.timeScale().setVisibleLogicalRange({
          from: range.from + 1,
          to: range.to + 1
        });
      }

      // Periodically update indicators (or on manual step)
      if (replayIndex % 5 === 0 || !replayTimer) {
        renderIndicatorsOnly(currentCandles);
      }
    } else {
      // Reached the end
      if (replayTimer) {
        clearInterval(replayTimer);
        replayTimer = null;
        updatePlayPauseButton(false);
      }
      showToast('Replay reached real-time / បានបញ្ចប់ការចាក់ឡើងវិញ');
    }
  }

  function switchReplayTimeframe(newTf) {
    if (!isReplayMode) return;

    if (replayTimer) {
      clearInterval(replayTimer);
      replayTimer = null;
      updatePlayPauseButton(false);
    }

    const tfBtns = document.querySelectorAll('.tv-tf-btn');
    tfBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-tf') === newTf));
    const replayTfBadge = document.getElementById('replay-tf-badge');
    if (replayTfBadge) replayTfBadge.textContent = newTf;

    // Effective timestamp represents exact current moment in replay history
    if (!replayEffectiveTimestamp) {
      const curBar = (currentCandles && currentCandles.length > 0) ? currentCandles[currentCandles.length - 1] : null;
      if (curBar) {
        const curTf = DataFeed.getCurrentResolution() || '5m';
        const curTfSec = (DataFeed.getTimeframes && DataFeed.getTimeframes()[curTf] ? DataFeed.getTimeframes()[curTf].seconds : 300);
        replayEffectiveTimestamp = curBar.time + curTfSec - 1;
      }
    }

    // Get mathematically unified slices with dynamic in-progress sub-bar aggregation
    const sliced = (DataFeed && DataFeed.getSlicedReplayData) 
      ? DataFeed.getSlicedReplayData(newTf, replayEffectiveTimestamp)
      : [];

    if (!sliced || sliced.length === 0) {
      showToast(`Cannot switch to ${newTf} replay`, 'error');
      return;
    }

    // Load full candles for stepping forward
    const fullRes = DataFeed.getReplayCandles(newTf);
    replayFullCandles = (fullRes && fullRes.candles) ? fullRes.candles : sliced;
    replayIndex = Math.max(0, sliced.length - 1);

    currentCandles = sliced;
    candleSeries.setData(sliced);

    const lastBar = sliced[sliced.length - 1];
    if (lastBar) {
      replayCutTimestamp = lastBar.time;
      replayCutPrice = lastBar.close;

      if (volumeSeries && indConfig.volume) {
        const volData = sliced.map(c => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(8, 153, 129, 0.35)' : 'rgba(242, 54, 69, 0.35)'
        }));
        volumeSeries.setData(volData);
      }

      renderIndicatorsOnly(sliced);
      updateLegendWithCandle(lastBar);
      const sym = DataFeed.getCurrentSymbol();
      updatePriceScaleLines(sliced, lastBar.close, sym);

      const hPriceEl = document.getElementById('header-symbol-price');
      const qSellEl = document.getElementById('quick-sell-price');
      const qBuyEl = document.getElementById('quick-buy-price');
      if (hPriceEl) hPriceEl.textContent = lastBar.close.toFixed(sym.digits);
      if (qSellEl) qSellEl.textContent = (lastBar.close - sym.tickSize).toFixed(sym.digits);
      if (qBuyEl) qBuyEl.textContent = (lastBar.close + sym.tickSize).toFixed(sym.digits);
    }

    chart.timeScale().applyOptions({ barSpacing: 9, minBarSpacing: 3, rightOffset: 12 });
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(-50, sliced.length - 96),
      to: sliced.length + 15
    });

    const priceDisplay = lastBar ? ` (${lastBar.close.toFixed(2)})` : '';
    showToast(`Switched to ${newTf} Replay${priceDisplay}`);
  }

  function jumpToRealtime() {
    if (replayTimer) {
      clearInterval(replayTimer);
      replayTimer = null;
      updatePlayPauseButton(false);
    }
    sliceReplayTo(replayFullCandles.length - 1, 'Jumped to real-time / ទៅកាន់ទិន្នន័យបច្ចុប្បន្ន');
  }

  function renderIndicatorsOnly(candles) {
    if (indConfig.ema) {
      ema20Series.setData(indConfig.ema20 !== false ? IndicatorEngine.calculateEMA(candles, 20) : []);
      ema50Series.setData(indConfig.ema50 !== false ? IndicatorEngine.calculateEMA(candles, 50) : []);
      ema200Series.setData(IndicatorEngine.calculateEMA(candles, 200));
    }
    if (indConfig.bb) {
      const bb = IndicatorEngine.calculateBollingerBands(candles, 20, 2);
      bbUpperSeries.setData(bb.upper);
      bbLowerSeries.setData(bb.lower);
    }
    renderICTMarkers(candles);
  }

  async function generateChartCompositeCanvas() {
    if (!chart) return null;
    const container = document.getElementById('chart-container');
    if (!container) return null;

    let chartCanvas = null;
    try {
      if (typeof chart.takeScreenshot === 'function') {
        chartCanvas = chart.takeScreenshot();
      }
    } catch (e) {}

    if (!chartCanvas) {
      chartCanvas = container.querySelector('canvas');
    }
    if (!chartCanvas) return null;

    const w = chartCanvas.width;
    const h = chartCanvas.height;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const ctx = outCanvas.getContext('2d');

    // 1. Draw chart base
    ctx.drawImage(chartCanvas, 0, 0);

    // 2. Draw user drawings overlay (scaled to match chartCanvas pixel dimensions)
    const drawCanvas = document.querySelector('.tv-drawing-canvas');
    if (drawCanvas) {
      ctx.drawImage(drawCanvas, 0, 0, w, h);
    }

    // 3. Watermark
    const curSym = (DataFeed && DataFeed.getCurrentSymbol) ? DataFeed.getCurrentSymbol().id : 'XAUUSD';
    const curTf = document.querySelector('.tv-tf-btn.active')?.textContent || '5m';
    const timeStr = new Date().toLocaleString();

    ctx.save();
    ctx.font = 'bold 13px Inter, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fillText(`TradingView Pro • ${curSym} (${curTf})`, 16, h - 28);

    ctx.font = '11px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.30)';
    ctx.fillText(timeStr, 16, h - 12);
    ctx.restore();

    return outCanvas;
  }

  async function copyChartImageToClipboard() {
    try {
      const canvas = await generateChartCompositeCanvas();
      if (!canvas) {
        showToast('Error capturing chart', 'error');
        return;
      }

      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          if (navigator.clipboard && navigator.clipboard.write) {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob })
            ]);
            showToast('📸 រូបភាពក្រាហ្វត្រូវបានចម្លង (Copied to Clipboard) — ចុច Ctrl+V ដើម្បីបិទភ្ជាប់ក្នុង Telegram ឬ Discord!');
          } else {
            downloadChartImage(canvas);
          }
        } catch (clipErr) {
          // Fallback to downloading if clipboard write is blocked by browser permissions
          downloadChartImage(canvas);
        }
      }, 'image/png');
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  }

  async function downloadChartImage(existingCanvas) {
    const canvas = existingCanvas || await generateChartCompositeCanvas();
    if (!canvas) return;

    const curSym = (DataFeed && DataFeed.getCurrentSymbol) ? DataFeed.getCurrentSymbol().id : 'CHART';
    const curTf = document.querySelector('.tv-tf-btn.active')?.textContent || '5m';
    const filename = `${curSym}_${curTf}_${Date.now()}.png`;

    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast(`💾 បានទាញយករូបភាពក្រាហ្វ (${filename})`);
  }

  function setupScreenshotDropdown() {
    const btnScreenshot = document.getElementById('btn-screenshot');
    const dropdown = document.getElementById('screenshot-dropdown');
    const btnCopy = document.getElementById('btn-copy-chart-image');
    const btnDownload = document.getElementById('btn-download-chart-image');

    if (btnScreenshot && dropdown) {
      btnScreenshot.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = dropdown.style.display === 'flex';
        dropdown.style.display = isOpen ? 'none' : 'flex';
      });

      document.addEventListener('click', () => {
        if (dropdown.style.display === 'flex') {
          dropdown.style.display = 'none';
        }
      });

      dropdown.addEventListener('click', (e) => e.stopPropagation());
    }

    if (btnCopy) {
      btnCopy.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dropdown) dropdown.style.display = 'none';
        copyChartImageToClipboard();
      });
    }

    if (btnDownload) {
      btnDownload.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dropdown) dropdown.style.display = 'none';
        downloadChartImage();
      });
    }
  }

  window.copyChartImageToClipboard = copyChartImageToClipboard;
  window.downloadChartImage = downloadChartImage;

  /**
   * Timeframe Pills
   */
  function setupTimeframes() {
    const curTf = DataFeed.getCurrentResolution();
    const tfBtns = document.querySelectorAll('.tv-tf-btn');
    tfBtns.forEach(btn => {
      const tf = btn.getAttribute('data-tf');
      btn.classList.toggle('active', tf === curTf);
      btn.addEventListener('click', () => {
        const tf = btn.getAttribute('data-tf');
        if (window.MultiChartEngine && window.MultiChartEngine.applyActivePaneTimeframe) {
          const handled = window.MultiChartEngine.applyActivePaneTimeframe(tf);
          if (handled) return;
        }
        if (isReplayMode) {
          switchReplayTimeframe(tf);
          return;
        }
        tfBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const replayTfBadge = document.getElementById('replay-tf-badge');
        if (replayTfBadge) replayTfBadge.textContent = tf;
        const updated = DataFeed.setTimeframe(tf);
        if (updated) {
          updateChartData(updated.candles);
        }
      });
    });
  }

  /**
   * Watchlist Rendering & Filter
   */
  function setupWatchlist() {
    const container = document.getElementById('watchlist-items-container');
    const symbols = DataFeed.getSymbols();

    function renderList(filter = 'all', query = '') {
      container.innerHTML = '';
      const filtered = symbols.filter(s => {
        const matchesCat = filter === 'all' || s.category === filter;
        const matchesQuery = !query || s.name.toLowerCase().includes(query.toLowerCase()) || s.id.toLowerCase().includes(query.toLowerCase());
        return matchesCat && matchesQuery;
      });

      filtered.forEach(s => {
        const stats = DataFeed.getStats(s.id);
        const item = document.createElement('div');
        const isCurrent = s.id === DataFeed.getCurrentSymbol().id;
        item.className = 'tv-watchlist-item' + (isCurrent ? ' active' : '');
        
        const pct = stats ? stats.changePercent.toFixed(2) : '0.00';
        const isPos = pct >= 0;

        item.innerHTML = `
          <div class="tv-wl-left">
            <span style="font-size: 16px;">${s.icon}</span>
            <div>
              <div class="tv-wl-symbol">${s.name}</div>
              <div class="tv-wl-name">${s.exchange}</div>
            </div>
          </div>
          <div class="tv-wl-right">
            <div class="tv-wl-price">${stats ? stats.price.toFixed(s.digits) : s.basePrice}</div>
            <div class="tv-wl-pct ${isPos ? 'pos' : 'neg'}">${isPos ? '+' : ''}${pct}%</div>
          </div>
        `;

        item.addEventListener('click', () => {
          document.querySelectorAll('.tv-watchlist-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          switchSymbol(s.id);
        });

        container.appendChild(item);
      });
    }

    renderList();

    // Category chips
    const catChips = document.querySelectorAll('.tv-cat-chip');
    catChips.forEach(chip => {
      chip.addEventListener('click', () => {
        catChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const cat = chip.getAttribute('data-cat');
        renderList(cat, document.getElementById('input-search-watchlist').value);
      });
    });

    // Search filter
    document.getElementById('input-search-watchlist').addEventListener('input', (e) => {
      const activeCat = document.querySelector('.tv-cat-chip.active').getAttribute('data-cat');
      renderList(activeCat, e.target.value);
    });
  }

  function switchSymbol(symbolId) {
    if (isReplayMode) {
      exitReplayMode();
    }
    clearPriceScaleLines();
    if (window.DrawingEngine && window.DrawingEngine.setSymbol) {
      window.DrawingEngine.setSymbol(symbolId);
    }
    const updated = DataFeed.setSymbol(symbolId);
    if (updated) {
      updateChartData(updated.candles);
      updateHeaderSymbolInfo(updated.symbol);
      if (window.MultiChartEngine && window.MultiChartEngine.setSymbol) {
        window.MultiChartEngine.setSymbol(updated.symbol);
      }

      // Synchronize active item in watchlist
      document.querySelectorAll('.tv-watchlist-item').forEach(el => {
        const symEl = el.querySelector('.tv-wl-symbol');
        if (symEl && symEl.textContent.trim() === updated.symbol.name) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      });
    }
  }

  // Expose switchSymbol for interactive tables & modals
  window.switchSymbol = switchSymbol;
  window.TradingApp = { switchSymbol };

  /**
   * Order Book Rendering
   */
  function renderOrderBook(data) {
    const asksContainer = document.getElementById('orderbook-asks');
    const bidsContainer = document.getElementById('orderbook-bids');
    if (!asksContainer || !bidsContainer) return;

    let asksHtml = '';
    data.asks.forEach(ask => {
      const barPct = Math.min(100, (ask.size / 40) * 100);
      asksHtml += `
        <div class="tv-ob-row ask">
          <div class="tv-ob-bar ask" style="width: ${barPct}%;"></div>
          <span class="price">${ask.price}</span>
          <span>${ask.size}</span>
          <span>${ask.total}</span>
        </div>
      `;
    });
    asksContainer.innerHTML = asksHtml;

    let bidsHtml = '';
    data.bids.forEach(bid => {
      const barPct = Math.min(100, (bid.size / 40) * 100);
      bidsHtml += `
        <div class="tv-ob-row bid">
          <div class="tv-ob-bar bid" style="width: ${barPct}%;"></div>
          <span class="price">${bid.price}</span>
          <span>${bid.size}</span>
          <span>${bid.total}</span>
        </div>
      `;
    });
    bidsContainer.innerHTML = bidsHtml;

    document.getElementById('ob-mid-price').textContent = DataFeed.getStats(DataFeed.getCurrentSymbol().id).price;
    document.getElementById('ob-spread-val').textContent = `Spread ${data.spread} (${data.spreadPercent}%)`;
  }

  /**
   * Time & Sales (Trades)
   */
  function renderRecentTrade(trade) {
    const container = document.getElementById('recent-trades-list');
    if (!container) return;

    const row = document.createElement('div');
    row.className = `tv-trade-row ${trade.side}`;
    row.innerHTML = `
      <span class="price">${trade.price}</span>
      <span>${trade.size}</span>
      <span style="color: var(--tv-text-secondary);">${trade.time}</span>
    `;

    container.insertBefore(row, container.firstChild);
    if (container.children.length > 25) {
      container.removeChild(container.lastChild);
    }
  }

  /**
   * Paper Trading & Execution Setup
   */
  function setupQuickTrade() {
    const qBuy = document.getElementById('quick-buy-btn');
    if (qBuy) {
      qBuy.addEventListener('click', () => {
        const qtyEl = document.getElementById('quick-trade-qty');
        const qty = qtyEl ? (parseFloat(qtyEl.value) || 0.1) : 0.1;
        executeTrade('buy', qty);
      });
    }

    const qSell = document.getElementById('quick-sell-btn');
    if (qSell) {
      qSell.addEventListener('click', () => {
        const qtyEl = document.getElementById('quick-trade-qty');
        const qty = qtyEl ? (parseFloat(qtyEl.value) || 0.1) : 0.1;
        executeTrade('sell', qty);
      });
    }

    const sBuy = document.getElementById('btn-sidebar-buy');
    if (sBuy) {
      sBuy.addEventListener('click', () => {
        const qty = parseFloat(document.getElementById('order-qty-input').value) || 1.0;
        const sl = parseFloat(document.getElementById('order-sl-input').value) || 0;
        const tp = parseFloat(document.getElementById('order-tp-input').value) || 0;
        executeTrade('buy', qty, sl, tp);
      });
    }

    const sSell = document.getElementById('btn-sidebar-sell');
    if (sSell) {
      sSell.addEventListener('click', () => {
        const qty = parseFloat(document.getElementById('order-qty-input').value) || 1.0;
        const sl = parseFloat(document.getElementById('order-sl-input').value) || 0;
        const tp = parseFloat(document.getElementById('order-tp-input').value) || 0;
        executeTrade('sell', qty, sl, tp);
      });
    }

    const dockReset = document.getElementById('btn-dock-reset');
    if (dockReset) {
      dockReset.addEventListener('click', () => {
        if (confirm('Reset paper trading account back to $100,000.00?')) {
          PaperTrading.resetAccount();
        }
      });
    }

    // Subscribe to PaperTrading updates
    PaperTrading.subscribe(updatePaperTradingUI);
    updatePaperTradingUI(PaperTrading.getAccountSummary());
  }

  function executeTrade(side, qty, sl = 0, tp = 0) {
    const sym = DataFeed.getCurrentSymbol();
    const oneClick = document.getElementById('cs-tr-one-click')?.checked;
    if (!oneClick) {
      const ok = confirm(`Confirm Order / បញ្ជាក់ការជួញដូរ:\n${side.toUpperCase()} ${qty} ${sym.name} @ ${sym.basePrice}?`);
      if (!ok) return;
    }

    const pos = PaperTrading.placeOrder(sym, side, qty, sl, tp);
    if (pos) {
      if (currentCandles.length > 0) {
        const lastCandle = currentCandles[currentCandles.length - 1];
        executionMarksHistory.push({
          time: lastCandle.time,
          position: side === 'buy' ? 'belowBar' : 'aboveBar',
          color: side === 'buy' ? '#089981' : '#f23645',
          shape: side === 'buy' ? 'arrowUp' : 'arrowDown',
          text: `${side.toUpperCase()} ${qty} @ ${pos.entryPrice.toFixed(sym.digits)}`
        });
        updateChartMarkers();
      }

      playTradeSound();
      const action = side === 'buy' ? (window.I18N ? window.I18N.t('quick_buy') : 'BUY') : (window.I18N ? window.I18N.t('quick_sell') : 'SELL');
      const msg = window.I18N ? `${window.I18N.t('order_placed')} ${action} ${qty} ${sym.name} @ ${pos.entryPrice}` : `Order Executed: ${side.toUpperCase()} ${qty} ${sym.name} @ ${pos.entryPrice}`;
      showToast(msg);
    }
  }

  function renderPositionLinesOnChart(positions) {
    if (!candleSeries) return;

    // Remove previous position lines
    positionPriceLines.forEach(line => {
      try { candleSeries.removePriceLine(line); } catch (e) {}
    });
    positionPriceLines = [];

    const showPosOrders = document.getElementById('cs-tr-positions-orders')?.checked ?? true;
    if (!showPosOrders || !positions || positions.length === 0) return;

    const sym = DataFeed.getCurrentSymbol();
    const pnlMode = document.getElementById('cs-tr-pnl-pos-mode')?.value || 'money';
    const showRev = document.getElementById('cs-tr-reverse-btn')?.checked ?? true;

    positions.forEach(p => {
      if (p.symbolId !== sym.id && p.symbolId.replace('/', '') !== sym.id.replace('/', '')) return;

      let pnlStr = '';
      if (pnlMode === 'percent') {
        pnlStr = (p.pnlPercent >= 0 ? '+' : '') + p.pnlPercent.toFixed(2) + '%';
      } else if (pnlMode === 'ticks') {
        const ticks = Math.round((p.pnl / (p.quantity || 1)) * 10);
        pnlStr = (ticks >= 0 ? '+' : '') + ticks + ' ticks';
      } else {
        pnlStr = (p.pnl >= 0 ? '+' : '') + '$' + p.pnl.toFixed(2);
      }

      const revIcon = showRev ? ' ⇄' : '';
      const posLine = candleSeries.createPriceLine({
        price: p.entryPrice,
        color: p.side === 'buy' ? '#089981' : '#f23645',
        lineWidth: 2,
        lineStyle: 0, // Solid
        axisLabelVisible: true,
        title: `${p.side.toUpperCase()} ${p.quantity} (${pnlStr})${revIcon}`
      });
      positionPriceLines.push(posLine);

      // SL line
      if (p.sl > 0) {
        const slLine = candleSeries.createPriceLine({
          price: p.sl,
          color: '#f23645',
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `SL: ${p.sl.toFixed(sym.digits)}`
        });
        positionPriceLines.push(slLine);
      }

      // TP line
      if (p.tp > 0) {
        const tpLine = candleSeries.createPriceLine({
          price: p.tp,
          color: '#089981',
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `TP: ${p.tp.toFixed(sym.digits)}`
        });
        positionPriceLines.push(tpLine);
      }
    });
  }

  function updatePaperTradingUI(summary) {
    // Sidebar card
    document.getElementById('paper-equity-val').textContent = `$${summary.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('paper-bal-val').textContent = `$${summary.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    const unEl = document.getElementById('paper-unrealized-val');
    unEl.textContent = (summary.unrealizedPnL >= 0 ? '+' : '') + `$${summary.unrealizedPnL.toFixed(2)}`;
    unEl.style.color = summary.unrealizedPnL >= 0 ? 'var(--tv-green)' : 'var(--tv-red)';

    document.getElementById('paper-margin-val').textContent = `$${summary.marginUsed.toFixed(2)}`;
    document.getElementById('paper-free-val').textContent = `$${summary.freeMargin.toFixed(2)}`;

    // Positions Table in Bottom Dock
    const posTableBody = document.getElementById('positions-table-body');
    const dockPosCount = document.getElementById('dock-pos-count');
    if (dockPosCount) dockPosCount.textContent = summary.positions.length;

    // Render Position Lines on Chart
    renderPositionLinesOnChart(summary.positions);

    if (posTableBody) {
      if (summary.positions.length === 0) {
        const emptyMsg = window.I18N ? window.I18N.t('no_positions') : 'No open positions. Use the Quick Order or Paper Trading panel to execute trades.';
        posTableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--tv-text-secondary); padding: 20px;">${emptyMsg}</td></tr>`;
      } else {
        let html = '';
        const closeTxt = window.I18N ? window.I18N.t('btn_close') : 'Close';
        const beTxt = window.I18N ? window.I18N.t('btn_be') : 'BE';
        const showRev = document.getElementById('cs-tr-reverse-btn')?.checked ?? true;

        summary.positions.forEach(p => {
          const isPos = p.pnl >= 0;
          const sideTxt = p.side.toUpperCase();
          html += `
            <tr>
              <td style="font-weight: 700;">${p.symbolName}</td>
              <td><span class="badge-pos ${p.side}">${sideTxt}</span></td>
              <td>${p.quantity}</td>
              <td>${p.entryPrice.toFixed(2)}</td>
              <td>${p.currentPrice.toFixed(2)}</td>
              <td>${p.sl > 0 ? p.sl.toFixed(2) : '-'}</td>
              <td>${p.tp > 0 ? p.tp.toFixed(2) : '-'}</td>
              <td style="color: ${isPos ? 'var(--tv-green)' : 'var(--tv-red)'}; font-weight: 700;">${isPos ? '+' : ''}$${p.pnl.toFixed(2)}</td>
              <td style="color: ${isPos ? 'var(--tv-green)' : 'var(--tv-red)'};">${isPos ? '+' : ''}${p.pnlPercent.toFixed(2)}%</td>
              <td>
                <button class="tv-btn" onclick="PaperTrading.closePosition('${p.id}')" style="padding: 2px 8px; font-size: 11px; background: var(--tv-bg-hover);">${closeTxt}</button>
                <button class="tv-btn" onclick="PaperTrading.setBreakEven('${p.id}')" style="padding: 2px 8px; font-size: 11px; background: var(--tv-bg-hover); margin-left: 4px;">${beTxt}</button>
                ${showRev ? `<button class="tv-btn" onclick="PaperTrading.reversePosition('${p.id}')" style="padding: 2px 8px; font-size: 11px; background: rgba(41,98,255,0.2); color: #2962ff; margin-left: 4px;" title="Reverse Position">⇄</button>` : ''}
              </td>
            </tr>
          `;
        });
        posTableBody.innerHTML = html;
      }
    }

    // Trade History Table
    const ordersTableBody = document.getElementById('orders-table-body');
    const dockOrderCount = document.getElementById('dock-order-count');
    if (dockOrderCount) dockOrderCount.textContent = summary.history.length;
    if (ordersTableBody) {
      if (summary.history.length === 0) {
        const noHistMsg = window.I18N ? window.I18N.t('no_history') : 'No orders in history yet.';
        ordersTableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--tv-text-secondary); padding: 20px;">${noHistMsg}</td></tr>`;
      } else {
      let html = '';
      summary.history.forEach(o => {
        const isProfit = o.pnl >= 0;
        html += `
          <tr>
            <td>${o.id}</td>
            <td>${o.symbol}</td>
            <td><span class="badge-pos ${o.side}">${o.side.toUpperCase()}</span></td>
            <td>${o.quantity}</td>
            <td>${o.entry.toFixed(2)}</td>
            <td>${o.exit.toFixed(2)}</td>
            <td style="color: ${isProfit ? 'var(--tv-green)' : 'var(--tv-red)'}; font-weight: 700;">${isProfit ? '+' : ''}$${o.pnl.toFixed(2)}</td>
            <td>${o.reason}</td>
            <td style="color: var(--tv-text-secondary);">${o.closeTime}</td>
          </tr>
        `;
      });
      ordersTableBody.innerHTML = html;
      }
    }
  }

  /**
   * Bottom Dock Panels
   */
  function setupBottomDock() {
    const dock = document.getElementById('bottom-dock');
    const tabs = document.querySelectorAll('.tv-dock-tab');
    const panels = document.querySelectorAll('.dock-panel');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const targetId = tab.getAttribute('data-tab');
        panels.forEach(p => {
          p.style.display = p.id === targetId ? 'block' : 'none';
        });

        // Ensure dock is expanded
        dock.classList.remove('collapsed');
      });
    });

    const dockToggle = document.getElementById('btn-dock-toggle');
    if (dockToggle) {
      dockToggle.addEventListener('click', () => {
        dock.classList.toggle('collapsed');
      });
    }

    const runPine = document.getElementById('btn-run-pine');
    if (runPine) {
      runPine.addEventListener('click', () => {
        showToast('ICT PD Array parameters updated on chart!');
        renderICTMarkers(currentCandles);
      });
    }
  }

  /**
   * Right Sidebar Tab Navigation
   */
  function setupSidebarTabs() {
    const tabs = document.querySelectorAll('.tv-sidebar-tab-btn');
    const panels = document.querySelectorAll('.tv-sidebar-panel');
    const sidebar = document.getElementById('sidebar-right');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const panelId = tab.getAttribute('data-panel');
        if (tab.classList.contains('active')) {
          // Toggle collapse
          sidebar.classList.toggle('collapsed');
        } else {
          sidebar.classList.remove('collapsed');
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');

          panels.forEach(p => {
            p.classList.toggle('active', p.id === panelId);
          });
        }
      });
    });
  }

  /**
   * Modals: Symbol Search, Indicators, Price Alert
   */
  function setupModals() {
    // Symbol Search Modal
    const symModal = document.getElementById('modal-symbol-search');
    const symInput = document.getElementById('symbol-search-input');
    const symResults = document.getElementById('symbol-search-results');

    document.getElementById('btn-symbol-search').addEventListener('click', () => {
      symModal.classList.add('active');
      symInput.value = '';
      symInput.focus();
      populateSymbolSearch('');
    });

    document.getElementById('btn-close-symbol-modal').addEventListener('click', () => {
      symModal.classList.remove('active');
    });

    symInput.addEventListener('input', (e) => {
      populateSymbolSearch(e.target.value);
    });

    function populateSymbolSearch(query) {
      const symbols = DataFeed.getSymbols();
      const filtered = symbols.filter(s => !query || s.name.toLowerCase().includes(query.toLowerCase()) || s.display.toLowerCase().includes(query.toLowerCase()));
      
      symResults.innerHTML = '';
      filtered.forEach(s => {
        const row = document.createElement('div');
        row.className = 'tv-ind-item';
        row.style.cursor = 'pointer';
        row.innerHTML = `
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 18px;">${s.icon}</span>
            <div>
              <h4 style="font-weight: 700;">${s.name}</h4>
              <p style="font-size: 11px; color: var(--tv-text-secondary);">${s.display} • ${s.exchange}</p>
            </div>
          </div>
          <span style="font-family: var(--tv-mono); font-weight: 600;">${s.basePrice}</span>
        `;
        row.addEventListener('click', () => {
          switchSymbol(s.id);
          symModal.classList.remove('active');
        });
        symResults.appendChild(row);
      });
    }

    // Indicators Modal
    const indModal = document.getElementById('modal-indicators');
    document.getElementById('btn-indicators-modal').addEventListener('click', () => {
      indModal.classList.add('active');
    });

    document.getElementById('btn-close-ind-modal').addEventListener('click', () => {
      indModal.classList.remove('active');
    });

    // Indicator Toggles
    const toggleMap = [
      { id: 'toggle-ind-ob', key: 'ob' },
      { id: 'toggle-ind-fvg', key: 'fvg' },
      { id: 'toggle-ind-liquidity', key: 'liquidity' },
      { id: 'toggle-ind-bos', key: 'bos' },
      { id: 'toggle-ind-ema', key: 'ema' },
      { id: 'toggle-ind-bb', key: 'bb' },
      { id: 'toggle-ind-rsi', key: 'rsi' },
      { id: 'toggle-ind-volume', key: 'volume' }
    ];

    toggleMap.forEach(item => {
      const el = document.getElementById(item.id);
      if (el) {
        el.checked = !!indConfig[item.key];
        el.addEventListener('change', () => {
          indConfig[item.key] = el.checked;
          if (item.key === 'ema') {
            indConfig.ema20 = el.checked;
            indConfig.ema50 = el.checked;
            const r20 = document.getElementById('legend-row-ema20');
            const r50 = document.getElementById('legend-row-ema50');
            if (r20) r20.style.display = el.checked ? 'flex' : 'none';
            if (r50) r50.style.display = el.checked ? 'flex' : 'none';
          } else if (item.key === 'ob') {
            const rob = document.getElementById('legend-row-ob');
            if (rob) rob.style.display = el.checked ? 'flex' : 'none';
          } else if (item.key === 'fvg') {
            const rfvg = document.getElementById('legend-row-fvg');
            if (rfvg) rfvg.style.display = el.checked ? 'flex' : 'none';
          }
          updateChartData(currentCandles);
          updateIndicatorBadge();
        });
      }
    });

    function updateIndicatorBadge() {
      let count = 0;
      ['ob', 'fvg', 'liquidity', 'bos', 'ema', 'bb', 'volume', 'rsi'].forEach(k => {
        if (indConfig[k]) {
          if (k === 'ema' && indConfig.ema20 === false && indConfig.ema50 === false) return;
          count++;
        }
      });
      const badge = document.getElementById('badge-active-indicators');
      if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-block' : 'none';
      }
    }
    updateIndicatorBadge();

    const clearIndBtn = document.getElementById('btn-clear-all-indicators');
    if (clearIndBtn) {
      clearIndBtn.addEventListener('click', () => {
        handleContextMenuAction('remove_indicators');
      });
    }

    // Alert Modal
    const alertModal = document.getElementById('modal-alert');
    document.getElementById('btn-alert-modal').addEventListener('click', () => {
      const stats = DataFeed.getStats(DataFeed.getCurrentSymbol().id);
      document.getElementById('alert-price-input').value = stats ? stats.price : 66000;
      alertModal.classList.add('active');
    });

    document.getElementById('btn-close-alert-modal').addEventListener('click', () => {
      alertModal.classList.remove('active');
    });

    document.getElementById('btn-save-alert').addEventListener('click', () => {
      alertPrice = parseFloat(document.getElementById('alert-price-input').value);
      updateAlertPriceLine();
      alertModal.classList.remove('active');
      showToast(`Price Alert Created for ${DataFeed.getCurrentSymbol().name} at ${alertPrice}`);
    });

    // Close on backdrop click
    window.addEventListener('click', (e) => {
      if (e.target.classList.contains('tv-modal-overlay')) {
        e.target.classList.remove('active');
      }
    });

    // Drawing Settings Modal
    setupDrawingSettingsModal();

    // TradingView Master Chart Settings Modal (Photos 2, 3, 4, 5)
    setupChartSettingsModal();

    // User Profile & Multi-User Chart Cloud Storage
    setupUserProfileModal();
  }

  function setupUserProfileModal() {
    const userModal = document.getElementById('modal-user-profile');
    const btnOpen = document.getElementById('btn-user-profile');
    const btnClose = document.getElementById('btn-close-user-modal');

    const userProfileName = document.getElementById('user-profile-name');
    const userAvatarCircle = document.getElementById('user-avatar-circle');

    // Tab buttons & panes
    const tabBtns = userModal ? userModal.querySelectorAll('.tv-modal-tab-btn') : [];
    const tabPanes = userModal ? userModal.querySelectorAll('.tv-tab-pane') : [];

    // Account tab elements
    const modalAvatar = document.getElementById('modal-user-avatar');
    const modalDisplayName = document.getElementById('modal-user-display-name');
    const modalEmailText = document.getElementById('modal-user-email-text');
    const badgeAccountType = document.getElementById('badge-account-type');
    const btnLogout = document.getElementById('btn-auth-logout');
    const authFormsContainer = document.getElementById('auth-forms-container');

    const btnSubtabLogin = document.getElementById('btn-subtab-login');
    const btnSubtabRegister = document.getElementById('btn-subtab-register');
    const formLoginWrap = document.getElementById('form-login-wrap');
    const formRegisterWrap = document.getElementById('form-register-wrap');

    const inputLoginEmail = document.getElementById('input-login-email');
    const inputLoginPassword = document.getElementById('input-login-password');
    const btnSubmitLogin = document.getElementById('btn-submit-login');
    const loginFeedback = document.getElementById('login-feedback-msg');

    const inputRegName = document.getElementById('input-reg-name');
    const inputRegEmail = document.getElementById('input-reg-email');
    const inputRegPassword = document.getElementById('input-reg-password');
    const btnSubmitRegister = document.getElementById('btn-submit-register');
    const regFeedback = document.getElementById('reg-feedback-msg');

    // Token tab elements
    const displayDeviceId = document.getElementById('display-device-id');
    const displaySessionToken = document.getElementById('display-session-token');

    // Storage tab elements
    const statCandlesCount = document.getElementById('stat-candles-count');
    const statDrawingsCount = document.getElementById('stat-drawings-count');
    const statLocalStorageSize = document.getElementById('stat-localstorage-size');
    const statSwStatus = document.getElementById('stat-sw-status');
    const btnSyncCloudNow = document.getElementById('btn-sync-cloud-now');
    const btnClearLocalCache = document.getElementById('btn-clear-local-cache');

    function refreshUserUI() {
      const authUser = (window.TVAuth && window.TVAuth.getCurrentUser) ? window.TVAuth.getCurrentUser() : null;
      const user = authUser || { id: 'guest', name: 'Guest Trader', email: '', is_guest: true };
      const initial = ((user && user.name) ? user.name : 'G').charAt(0).toUpperCase();

      if (userProfileName) userProfileName.textContent = user.name || 'Guest Trader';
      if (userAvatarCircle) userAvatarCircle.textContent = initial;

      if (modalAvatar) modalAvatar.textContent = initial;
      if (modalDisplayName) modalDisplayName.textContent = user.name || 'Guest Trader';
      if (modalEmailText) {
        modalEmailText.textContent = user.email ? user.email : (user.is_guest ? 'Guest Session (Auto-Tracked)' : 'Standard Account');
      }

      if (badgeAccountType) {
        badgeAccountType.textContent = user.is_guest ? 'Guest Mode' : 'Verified Member';
        badgeAccountType.style.background = user.is_guest ? 'rgba(41,98,255,0.2)' : 'rgba(38,166,154,0.2)';
        badgeAccountType.style.color = user.is_guest ? 'var(--tv-blue)' : '#26a69a';
      }

      if (btnLogout) {
        btnLogout.style.display = user.is_guest ? 'none' : 'block';
      }

      if (authFormsContainer) {
        authFormsContainer.style.display = user.is_guest ? 'block' : 'none';
      }

      if (displayDeviceId && window.TVAuth) {
        displayDeviceId.textContent = window.TVAuth.getDeviceId();
      }

      if (displaySessionToken && window.TVAuth) {
        const token = window.TVAuth.getSessionToken();
        displaySessionToken.textContent = token ? (token.substring(0, 16) + '...' + token.substring(token.length - 8)) : 'Active (Cookie Linked)';
      }
    }

    async function refreshStorageStats() {
      if (window.TVStorage && window.TVStorage.getStorageStats) {
        try {
          const stats = await window.TVStorage.getStorageStats();
          if (statCandlesCount) statCandlesCount.textContent = `${stats.candlesCount} bars (${stats.candlesSize})`;
          if (statDrawingsCount) statDrawingsCount.textContent = `${stats.drawingsCount} objects`;
          if (statLocalStorageSize) statLocalStorageSize.textContent = `${stats.localStorageSizeKB} KB`;
        } catch (e) {}
      }

      if (statSwStatus) {
        statSwStatus.textContent = ('serviceWorker' in navigator && navigator.serviceWorker.controller) ? 'Active (Cached)' : 'Enabled';
      }
    }

    // Tab Navigation
    if (tabBtns) {
      tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          tabBtns.forEach(b => {
            b.classList.remove('active');
            b.style.color = 'var(--tv-text-secondary)';
            b.style.borderBottomColor = 'transparent';
          });
          tabPanes.forEach(p => {
            p.classList.remove('active');
            p.style.display = 'none';
          });

          btn.classList.add('active');
          btn.style.color = '#fff';
          btn.style.borderBottomColor = 'var(--tv-blue)';

          const tabName = btn.getAttribute('data-tab');
          const targetPane = document.getElementById(`pane-tab-${tabName}`);
          if (targetPane) {
            targetPane.classList.add('active');
            targetPane.style.display = 'block';
          }

          if (tabName === 'storage') {
            refreshStorageStats();
          }
        });
      });
    }

    // Subtab: Login vs Register
    if (btnSubtabLogin && btnSubtabRegister) {
      btnSubtabLogin.addEventListener('click', () => {
        btnSubtabLogin.style.background = 'var(--tv-blue)';
        btnSubtabLogin.style.color = '#fff';
        btnSubtabRegister.style.background = 'transparent';
        btnSubtabRegister.style.color = 'var(--tv-text-secondary)';
        if (formLoginWrap) formLoginWrap.style.display = 'block';
        if (formRegisterWrap) formRegisterWrap.style.display = 'none';
      });

      btnSubtabRegister.addEventListener('click', () => {
        btnSubtabRegister.style.background = 'var(--tv-blue)';
        btnSubtabRegister.style.color = '#fff';
        btnSubtabLogin.style.background = 'transparent';
        btnSubtabLogin.style.color = 'var(--tv-text-secondary)';
        if (formRegisterWrap) formRegisterWrap.style.display = 'block';
        if (formLoginWrap) formLoginWrap.style.display = 'none';
      });
    }

    // Submit Login
    if (btnSubmitLogin) {
      btnSubmitLogin.addEventListener('click', async () => {
        const email = inputLoginEmail.value.trim();
        const password = inputLoginPassword.value.trim();

        if (!email || !password) {
          if (loginFeedback) {
            loginFeedback.style.display = 'block';
            loginFeedback.style.color = '#f23645';
            loginFeedback.textContent = 'Please enter both email and password.';
          }
          return;
        }

        btnSubmitLogin.disabled = true;
        btnSubmitLogin.textContent = 'Signing In...';
        if (loginFeedback) loginFeedback.style.display = 'none';

        try {
          const res = await window.TVAuth.login(email, password);
          if (res.status === 'ok') {
            if (loginFeedback) {
              loginFeedback.style.display = 'block';
              loginFeedback.style.color = '#26a69a';
              loginFeedback.textContent = '✓ Login successful!';
            }
            refreshUserUI();
            if (window.DrawingEngine && window.DrawingEngine.loadDrawings) {
              window.DrawingEngine.loadDrawings(res.user.id, DataFeed.getCurrentSymbol().id);
            }
            showToast(`Welcome back, ${res.user.name}!`);
            setTimeout(() => {
              if (userModal) userModal.classList.remove('active');
            }, 800);
          } else {
            if (loginFeedback) {
              loginFeedback.style.display = 'block';
              loginFeedback.style.color = '#f23645';
              loginFeedback.textContent = res.message || 'Login failed. Please check credentials.';
            }
          }
        } catch (err) {
          if (loginFeedback) {
            loginFeedback.style.display = 'block';
            loginFeedback.style.color = '#f23645';
            loginFeedback.textContent = 'Network or server error during sign in.';
          }
        } finally {
          btnSubmitLogin.disabled = false;
          btnSubmitLogin.textContent = 'Sign In & Sync (ចូលប្រើប្រព័ន្ធ)';
        }
      });
    }

    // Submit Register
    if (btnSubmitRegister) {
      btnSubmitRegister.addEventListener('click', async () => {
        const name = inputRegName.value.trim();
        const email = inputRegEmail.value.trim();
        const password = inputRegPassword.value.trim();

        if (!name || !email || !password) {
          if (regFeedback) {
            regFeedback.style.display = 'block';
            regFeedback.style.color = '#f23645';
            regFeedback.textContent = 'Please fill in all registration fields.';
          }
          return;
        }

        btnSubmitRegister.disabled = true;
        btnSubmitRegister.textContent = 'Creating Account...';
        if (regFeedback) regFeedback.style.display = 'none';

        try {
          const res = await window.TVAuth.register(name, email, password);
          if (res.status === 'ok') {
            if (regFeedback) {
              regFeedback.style.display = 'block';
              regFeedback.style.color = '#26a69a';
              regFeedback.textContent = '✓ Account created successfully!';
            }
            refreshUserUI();
            if (window.DrawingEngine && window.DrawingEngine.saveDrawings) {
              window.DrawingEngine.saveDrawings(true);
            }
            showToast(`Account created for ${res.user.name}!`);
            setTimeout(() => {
              if (userModal) userModal.classList.remove('active');
            }, 800);
          } else {
            if (regFeedback) {
              regFeedback.style.display = 'block';
              regFeedback.style.color = '#f23645';
              regFeedback.textContent = res.message || 'Failed to create account.';
            }
          }
        } catch (err) {
          if (regFeedback) {
            regFeedback.style.display = 'block';
            regFeedback.style.color = '#f23645';
            regFeedback.textContent = 'Network error during registration.';
          }
        } finally {
          btnSubmitRegister.disabled = false;
          btnSubmitRegister.textContent = 'ចុះឈ្មោះ & បង្កើតកាតសម្គាល់ (Create Account)';
        }
      });
    }

    // Submit Logout
    if (btnLogout) {
      btnLogout.addEventListener('click', async () => {
        await window.TVAuth.logout();
        refreshUserUI();
        if (window.DrawingEngine && window.DrawingEngine.loadDrawings) {
          window.DrawingEngine.loadDrawings('guest', DataFeed.getCurrentSymbol().id);
        }
        showToast('Logged out. Converted to Guest session.');
      });
    }

    // Storage Actions: Sync Now
    if (btnSyncCloudNow) {
      btnSyncCloudNow.addEventListener('click', async () => {
        btnSyncCloudNow.textContent = 'Syncing...';
        btnSyncCloudNow.disabled = true;
        try {
          if (window.DrawingEngine && window.DrawingEngine.flushSaveDrawings) {
            await window.DrawingEngine.flushSaveDrawings();
          }
          await refreshStorageStats();
          showToast('✓ IndexedDB & Cloud Synced Successfully!');
        } catch (e) {
          showToast('Sync error: ' + e.message);
        } finally {
          btnSyncCloudNow.textContent = '☁ Sync Now (ធ្វើសមកាលកម្ម Cloud)';
          btnSyncCloudNow.disabled = false;
        }
      });
    }

    // Storage Actions: Clear Cache
    if (btnClearLocalCache) {
      btnClearLocalCache.addEventListener('click', async () => {
        if (confirm('Clear local candlestick and drawing cache? Chart will reload from server.')) {
          if (window.TVStorage && window.TVStorage.clearAllCache) {
            await window.TVStorage.clearAllCache();
          }
          showToast('Local cache cleared.');
          await refreshStorageStats();
        }
      });
    }

    // Modal Open & Close Listeners
    const openButtons = document.querySelectorAll('#btn-user-profile-left, #btn-user-profile-right, .tv-user-profile-btn, .tv-user-profile-wrap');
    openButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (userModal) {
          userModal.classList.add('active');
          refreshUserUI();
          refreshStorageStats();
        }
      });
    });

    if (btnClose && userModal) {
      btnClose.addEventListener('click', (e) => {
        e.stopPropagation();
        userModal.classList.remove('active');
      });
    }

    if (userModal) {
      userModal.addEventListener('click', (e) => {
        if (e.target === userModal) userModal.classList.remove('active');
      });
    }

    // Global listener for auth changes
    window.addEventListener('tv_auth_changed', () => refreshUserUI());

    // Initial render
    refreshUserUI();
  }

  function setupDrawingSettingsModal() {
    const modal = document.getElementById('modal-drawing-settings');
    if (!modal) return;

    const closeBtn = document.getElementById('btn-close-drawing-settings');
    const cancelBtn = document.getElementById('btn-ds-cancel');
    const saveBtn = document.getElementById('btn-ds-save');
    const defaultsBtn = document.getElementById('btn-ds-defaults');

    let activeDrawing = null;
    let backupState = null;

    // Tabs switching (Style, Coordinates, Visibility)
    const tabBtns = modal.querySelectorAll('.tv-settings-tab-btn');
    const tabPanes = modal.querySelectorAll('.tv-settings-tab-pane');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabKey = btn.getAttribute('data-tab');
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        tabPanes.forEach(p => {
          p.classList.toggle('active', p.id === `ds-tab-${tabKey}`);
        });
      });
    });

    window.openDrawingSettingsModal = function (d) {
      if (!d) return;
      activeDrawing = d;
      backupState = JSON.parse(JSON.stringify(d));

      const titleEl = document.getElementById('ds-modal-title');
      if (titleEl) {
        if (d.type === 'fib') {
          titleEl.innerHTML = 'Fib retracement <span style="font-size: 13px; margin-left: 6px; color: var(--tv-text-secondary); cursor: pointer;" title="Rename">✎</span>';
        } else if (d.type === 'gann_box') {
          titleEl.innerHTML = 'Gann box Settings <span style="font-size: 13px; margin-left: 6px; color: var(--tv-text-secondary); cursor: pointer;" title="Rename">✎</span>';
        } else {
          const cfg = DRAWING_TOOLS_CONFIG[d.type];
          titleEl.textContent = `${cfg ? cfg.name : d.type.toUpperCase()} Settings`;
        }
      }

      // Inputs tab for Position tools (Long / Short Position - TradingView style)
      const isPos = d.type === 'long_pos' || d.type === 'short_pos';
      const inputsTabBtn = document.getElementById('ds-tab-btn-inputs');
      const styleTabBtn = document.getElementById('ds-tab-btn-style');
      const inputsPane = document.getElementById('ds-tab-inputs');
      const stylePane = document.getElementById('ds-tab-style');

      if (isPos) {
        if (inputsTabBtn) inputsTabBtn.style.display = 'block';
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        if (inputsTabBtn) inputsTabBtn.classList.add('active');
        if (inputsPane) inputsPane.classList.add('active');

        // Populate Inputs fields
        const entryInput = document.getElementById('ds-input-entry-price');
        const targetInput = document.getElementById('ds-input-target-price');
        const stopInput = document.getElementById('ds-input-stop-price');
        const targetPct = document.getElementById('ds-target-pct');
        const stopPct = document.getElementById('ds-stop-pct');
        const rrVal = document.getElementById('ds-input-rr-val');

        const updatePosInputsUI = () => {
          const ep = parseFloat(entryInput.value) || d.p1.price;
          const tp = parseFloat(targetInput.value) || d.targetPrice;
          const sl = parseFloat(stopInput.value) || d.stopPrice;
          const isL = d.type === 'long_pos';
          const rew = Math.abs(tp - ep);
          const rsk = Math.abs(ep - sl);
          const rPct = ep > 0 ? ((rsk / ep) * 100).toFixed(2) : '0.00';
          const tPct = ep > 0 ? ((rew / ep) * 100).toFixed(2) : '0.00';
          const rr = rsk > 0 ? (rew / rsk).toFixed(2) : '1.00';

          if (targetPct) targetPct.textContent = `+${tPct}%`;
          if (stopPct) stopPct.textContent = `-${rPct}%`;
          if (rrVal) rrVal.textContent = rr;

          d.p1.price = ep;
          d.targetPrice = tp;
          d.stopPrice = sl;
          window.DrawingEngine.redraw();
        };

        if (entryInput) {
          entryInput.value = d.p1.price.toFixed(2);
          entryInput.oninput = updatePosInputsUI;
        }
        const defaultDelta = d.p1.price * 0.0015;
        if (targetInput) {
          targetInput.value = (d.targetPrice !== undefined ? d.targetPrice : (d.type === 'long_pos' ? d.p1.price + defaultDelta * 2 : d.p1.price - defaultDelta * 2)).toFixed(2);
          targetInput.oninput = updatePosInputsUI;
        }
        if (stopInput) {
          stopInput.value = (d.stopPrice !== undefined ? d.stopPrice : (d.type === 'long_pos' ? d.p1.price - defaultDelta : d.p1.price + defaultDelta)).toFixed(2);
          stopInput.oninput = updatePosInputsUI;
        }
        updatePosInputsUI();
      } else {
        if (inputsTabBtn) inputsTabBtn.style.display = 'none';
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        if (styleTabBtn) styleTabBtn.classList.add('active');
        if (stylePane) stylePane.classList.add('active');
      }

      // Populate Style fields
      const colorInput = document.getElementById('ds-line-color');
      if (colorInput) colorInput.value = d.color || '#2962ff';

      const opacitySlider = document.getElementById('ds-line-opacity');
      const opacityVal = document.getElementById('ds-line-opacity-val');
      const curOpacity = d.opacity !== undefined ? d.opacity : 100;
      if (opacitySlider) opacitySlider.value = curOpacity;
      if (opacityVal) opacityVal.textContent = `${curOpacity}%`;

      // Thickness buttons
      const curWidth = d.lineWidth || 2;
      modal.querySelectorAll('#ds-width-group .ds-choice-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.getAttribute('data-val'), 10) === curWidth);
      });

      // Style buttons
      const curStyle = d.lineStyle || 'solid';
      modal.querySelectorAll('#ds-style-group .ds-choice-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-val') === curStyle);
      });

      // Background fill section
      const fillSection = document.getElementById('ds-fill-section');
      const fillEnable = document.getElementById('ds-fill-enable');
      const fillColor = document.getElementById('ds-fill-color');
      const fillOpacity = document.getElementById('ds-fill-opacity');
      const fillOpacityVal = document.getElementById('ds-fill-opacity-val');

      const isAreaTool = ['fib', 'fib_ext', 'fib_channel', 'gann_box', 'gann_square', 'gann_sq_fixed', 'rectangle', 'long_pos', 'short_pos', 'measure'].includes(d.type);
      if (fillSection) fillSection.style.display = isAreaTool ? 'block' : 'none';
      if (fillEnable) fillEnable.checked = d.fillEnabled !== false;
      if (fillColor) fillColor.value = d.fillColor || d.color || '#2962ff';
      if (fillOpacity) fillOpacity.value = d.fillOpacity !== undefined ? d.fillOpacity : 20;
      if (fillOpacityVal) fillOpacityVal.textContent = `${d.fillOpacity !== undefined ? d.fillOpacity : 20}%`;

      // Text label section
      const textSection = document.getElementById('ds-text-section');
      const textInput = document.getElementById('ds-text-content');
      if (textSection) textSection.style.display = (d.type === 'text' || d.type === 'rectangle') ? 'block' : 'none';
      if (textInput) textInput.value = d.text || d.label || '';

      // Fibonacci 100% TradingView Settings Logic
      const genericLineSec = document.getElementById('ds-generic-line-section');
      const fibSection = document.getElementById('ds-fib-section');
      const fibContainer = document.getElementById('ds-fib-levels-container');
      const gannSection = document.getElementById('ds-gannbox-section');
      const gannPriceContainer = document.getElementById('ds-gann-price-levels-container');
      const gannTimeContainer = document.getElementById('ds-gann-time-levels-container');

      if (d.type === 'fib') {
        modal.classList.add('is-fib-modal');
        modal.classList.remove('is-gannbox-modal');
        if (genericLineSec) genericLineSec.style.display = 'none';
        if (fillSection) fillSection.style.display = 'none';
        if (textSection) textSection.style.display = 'none';
        if (fibSection) fibSection.style.display = 'block';
        if (gannSection) gannSection.style.display = 'none';

        // Ensure exactly 24 levels matching TradingView Pro
        const defLevels = window.TV_DEFAULT_24_FIB_LEVELS || [
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

        if (!d.fibLevels || d.fibLevels.length === 0) {
          d.fibLevels = JSON.parse(JSON.stringify(defLevels));
        } else if (d.fibLevels.length < 24) {
          const padded = JSON.parse(JSON.stringify(d.fibLevels));
          for (let i = d.fibLevels.length; i < 24; i++) {
            padded.push(defLevels[i] || { ratio: 0, color: '#787b86', visible: false });
          }
          d.fibLevels = padded;
        }

        // Render 24 levels in 2-column grid
        if (fibContainer) {
          fibContainer.innerHTML = '';
          d.fibLevels.forEach((lvl, idx) => {
            const cell = document.createElement('div');
            cell.className = 'tv-fib-level-cell';
            cell.innerHTML = `
              <input type="checkbox" id="fib-chk-${idx}" ${lvl.visible !== false ? 'checked' : ''}>
              <input type="number" step="any" class="tv-fib-level-input" id="fib-val-${idx}" value="${lvl.ratio}">
              <button type="button" class="ds-color-input tv-fib-swatch" id="fib-col-${idx}" value="${lvl.color || '#787b86'}" style="background-color: ${lvl.color || '#787b86'};" onclick="window.openTradingViewColorPicker(this, event)"></button>
            `;
            const chk = cell.querySelector(`#fib-chk-${idx}`);
            const valInput = cell.querySelector(`#fib-val-${idx}`);

            chk.addEventListener('change', () => {
              lvl.visible = chk.checked;
              window.DrawingEngine.redraw();
            });
            valInput.addEventListener('input', () => {
              const v = parseFloat(valInput.value);
              if (!isNaN(v)) {
                lvl.ratio = v;
                window.DrawingEngine.redraw();
              }
            });
            fibContainer.appendChild(cell);
          });
        }

        // 1. Trend line controls
        const trendEn = document.getElementById('ds-fib-trendline-en');
        const trendCol = document.getElementById('ds-fib-trendline-col');
        const trendWidth = document.getElementById('ds-fib-trendline-width');
        const trendStyle = document.getElementById('ds-fib-trendline-style');

        if (trendEn) {
          trendEn.checked = d.showTrendLine !== false;
          trendEn.onchange = () => { d.showTrendLine = trendEn.checked; window.DrawingEngine.redraw(); };
        }
        if (trendCol) {
          trendCol.value = d.trendLineColor || 'rgba(209, 212, 220, 0.65)';
          trendCol.style.backgroundColor = d.trendLineColor || 'rgba(209, 212, 220, 0.65)';
        }
        if (trendWidth) {
          trendWidth.value = d.trendLineWidth || 1;
          trendWidth.onchange = () => { d.trendLineWidth = parseInt(trendWidth.value, 10); window.DrawingEngine.redraw(); };
        }
        if (trendStyle) {
          trendStyle.value = d.trendLineStyle || 'dashed';
          trendStyle.onchange = () => { d.trendLineStyle = trendStyle.value; window.DrawingEngine.redraw(); };
        }

        // 2. Level line controls
        const levelCol = document.getElementById('ds-fib-levelline-col');
        const levelWidth = document.getElementById('ds-fib-levelline-width');
        const levelStyle = document.getElementById('ds-fib-levelline-style');

        if (levelCol) {
          levelCol.value = d.levelLineColor || '#2962ff';
          levelCol.style.backgroundColor = d.levelLineColor || '#2962ff';
        }
        if (levelWidth) {
          levelWidth.value = d.levelLineWidth || 1;
          levelWidth.onchange = () => { d.levelLineWidth = parseInt(levelWidth.value, 10); window.DrawingEngine.redraw(); };
        }
        if (levelStyle) {
          levelStyle.value = d.levelLineStyle || 'solid';
          levelStyle.onchange = () => { d.levelLineStyle = levelStyle.value; window.DrawingEngine.redraw(); };
        }

        // 3. Extend mode
        const extendSelect = document.getElementById('ds-fib-extend-mode');
        if (extendSelect) {
          extendSelect.value = d.extendMode || 'none';
          extendSelect.onchange = () => { d.extendMode = extendSelect.value; window.DrawingEngine.redraw(); };
        }

        // 4. Use one color
        const useOneColChk = document.getElementById('ds-fib-use-one-color');
        const oneColBtn = document.getElementById('ds-fib-one-color');
        if (useOneColChk) {
          useOneColChk.checked = d.useOneColor === true;
          useOneColChk.onchange = () => { d.useOneColor = useOneColChk.checked; window.DrawingEngine.redraw(); };
        }
        if (oneColBtn) {
          oneColBtn.value = d.oneColor || '#00897b';
          oneColBtn.style.backgroundColor = d.oneColor || '#00897b';
        }

        // 5. Background fill
        const bgEnable = document.getElementById('ds-fib-bg-enable');
        const bgOpacity = document.getElementById('ds-fib-bg-opacity');
        const bgOpacityVal = document.getElementById('ds-fib-bg-opacity-val');

        if (bgEnable) {
          bgEnable.checked = d.fillEnabled !== false;
          bgEnable.onchange = () => { d.fillEnabled = bgEnable.checked; window.DrawingEngine.redraw(); };
        }
        if (bgOpacity) {
          const curO = d.fillOpacity !== undefined ? d.fillOpacity : 20;
          bgOpacity.value = curO;
          if (bgOpacityVal) bgOpacityVal.textContent = `${curO}%`;
          bgOpacity.oninput = () => {
            const v = parseInt(bgOpacity.value, 10);
            if (bgOpacityVal) bgOpacityVal.textContent = `${v}%`;
            d.fillOpacity = v;
            window.DrawingEngine.redraw();
          };
        }

        // 6. Reverse
        const revChk = document.getElementById('ds-fib-reverse');
        if (revChk) {
          revChk.checked = d.reverse === true;
          revChk.onchange = () => { d.reverse = revChk.checked; window.DrawingEngine.redraw(); };
        }

        // 7. Prices
        const pricesChk = document.getElementById('ds-fib-prices');
        if (pricesChk) {
          pricesChk.checked = d.showPrices !== false;
          pricesChk.onchange = () => { d.showPrices = pricesChk.checked; window.DrawingEngine.redraw(); };
        }

        // 8. Levels
        const levelsChk = document.getElementById('ds-fib-levels-enable');
        const levelsFmt = document.getElementById('ds-fib-levels-format');
        if (levelsChk) {
          levelsChk.checked = d.showLevels !== false;
          levelsChk.onchange = () => { d.showLevels = levelsChk.checked; window.DrawingEngine.redraw(); };
        }
        if (levelsFmt) {
          levelsFmt.value = d.levelsFormat || 'values';
          levelsFmt.onchange = () => { d.levelsFormat = levelsFmt.value; window.DrawingEngine.redraw(); };
        }

        // 9. Labels
        const lblHorz = document.getElementById('ds-fib-label-horz');
        const lblVert = document.getElementById('ds-fib-label-vert');
        if (lblHorz) {
          lblHorz.value = d.labelHorz || 'left';
          lblHorz.onchange = () => { d.labelHorz = lblHorz.value; window.DrawingEngine.redraw(); };
        }
        if (lblVert) {
          lblVert.value = d.labelVert || 'middle';
          lblVert.onchange = () => { d.labelVert = lblVert.value; window.DrawingEngine.redraw(); };
        }

        // 10. Text
        const textEn = document.getElementById('ds-fib-text-enable');
        const textHorz = document.getElementById('ds-fib-text-horz');
        const textVert = document.getElementById('ds-fib-text-vert');
        if (textEn) {
          textEn.checked = d.showText !== false;
          textEn.onchange = () => { d.showText = textEn.checked; window.DrawingEngine.redraw(); };
        }
        if (textHorz) {
          textHorz.value = d.textHorz || 'center';
          textHorz.onchange = () => { d.textHorz = textHorz.value; window.DrawingEngine.redraw(); };
        }
        if (textVert) {
          textVert.value = d.textVert || 'middle';
          textVert.onchange = () => { d.textVert = textVert.value; window.DrawingEngine.redraw(); };
        }

        // 11. Font size
        const fontSizeSelect = document.getElementById('ds-fib-font-size');
        if (fontSizeSelect) {
          fontSizeSelect.value = d.fontSize || 12;
          fontSizeSelect.onchange = () => { d.fontSize = parseInt(fontSizeSelect.value, 10); window.DrawingEngine.redraw(); };
        }

        // 12. Log scale
        const logScaleChk = document.getElementById('ds-fib-log-scale');
        if (logScaleChk) {
          logScaleChk.checked = d.logScale === true;
          logScaleChk.onchange = () => { d.logScale = logScaleChk.checked; window.DrawingEngine.redraw(); };
        }
      } else if (d.type === 'gann_box') {
        modal.classList.remove('is-fib-modal');
        modal.classList.add('is-gannbox-modal');
        if (genericLineSec) genericLineSec.style.display = 'none';
        if (fillSection) fillSection.style.display = 'none';
        if (textSection) textSection.style.display = 'none';
        if (fibSection) fibSection.style.display = 'none';
        if (gannSection) gannSection.style.display = 'block';

        const defPriceLevels = window.TV_DEFAULT_GANN_PRICE_LEVELS || [
          { ratio: 0, color: '#00bcd4', visible: true },
          { ratio: 0.382, color: '#00897b', visible: false },
          { ratio: 0.618, color: '#00897b', visible: false },
          { ratio: 1.0, color: '#4caf50', visible: true },
          { ratio: 0.25, color: '#ff9800', visible: false },
          { ratio: 0.5, color: '#f23645', visible: true },
          { ratio: 0.75, color: '#089981', visible: false }
        ];

        const defTimeLevels = window.TV_DEFAULT_GANN_TIME_LEVELS || [
          { ratio: 0, color: '#00bcd4', visible: true },
          { ratio: 0.382, color: '#00897b', visible: false },
          { ratio: 0.618, color: '#089981', visible: false },
          { ratio: 1.0, color: '#787b86', visible: true },
          { ratio: 0.25, color: '#ff9800', visible: false },
          { ratio: 0.5, color: '#4caf50', visible: false },
          { ratio: 0.75, color: '#2962ff', visible: false }
        ];

        if (!d.priceLevels || d.priceLevels.length === 0) {
          d.priceLevels = JSON.parse(JSON.stringify(defPriceLevels));
        }
        if (!d.timeLevels || d.timeLevels.length === 0) {
          d.timeLevels = JSON.parse(JSON.stringify(defTimeLevels));
        }

        // Render Price Levels Grid (Column 1: 0, 0.382, 0.618, 1 | Column 2: 0.25, 0.5, 0.75)
        if (gannPriceContainer) {
          gannPriceContainer.innerHTML = '';
          d.priceLevels.forEach((lvl, idx) => {
            const cell = document.createElement('div');
            cell.className = 'tv-gann-level-cell';
            cell.innerHTML = `
              <input type="checkbox" id="gann-pchk-${idx}" ${lvl.visible !== false ? 'checked' : ''}>
              <input type="number" step="any" class="tv-gann-level-input" id="gann-pval-${idx}" value="${lvl.ratio}">
              <button type="button" class="ds-color-input tv-gann-swatch" id="gann-pcol-${idx}" value="${lvl.color || '#00bcd4'}" style="background-color: ${lvl.color || '#00bcd4'};" onclick="window.openTradingViewColorPicker(this, event)"></button>
            `;
            const chk = cell.querySelector(`#gann-pchk-${idx}`);
            const valInput = cell.querySelector(`#gann-pval-${idx}`);

            chk.addEventListener('change', () => {
              lvl.visible = chk.checked;
              window.DrawingEngine.redraw();
            });
            valInput.addEventListener('input', () => {
              const v = parseFloat(valInput.value);
              if (!isNaN(v)) {
                lvl.ratio = v;
                window.DrawingEngine.redraw();
              }
            });
            gannPriceContainer.appendChild(cell);
          });
        }

        // Render Time Levels Grid (Column 1: 0, 0.382, 0.618, 1 | Column 2: 0.25, 0.5, 0.75)
        if (gannTimeContainer) {
          gannTimeContainer.innerHTML = '';
          d.timeLevels.forEach((lvl, idx) => {
            const cell = document.createElement('div');
            cell.className = 'tv-gann-level-cell';
            cell.innerHTML = `
              <input type="checkbox" id="gann-tchk-${idx}" ${lvl.visible !== false ? 'checked' : ''}>
              <input type="number" step="any" class="tv-gann-level-input" id="gann-tval-${idx}" value="${lvl.ratio}">
              <button type="button" class="ds-color-input tv-gann-swatch" id="gann-tcol-${idx}" value="${lvl.color || '#00bcd4'}" style="background-color: ${lvl.color || '#00bcd4'};" onclick="window.openTradingViewColorPicker(this, event)"></button>
            `;
            const chk = cell.querySelector(`#gann-tchk-${idx}`);
            const valInput = cell.querySelector(`#gann-tval-${idx}`);

            chk.addEventListener('change', () => {
              lvl.visible = chk.checked;
              window.DrawingEngine.redraw();
            });
            valInput.addEventListener('input', () => {
              const v = parseFloat(valInput.value);
              if (!isNaN(v)) {
                lvl.ratio = v;
                window.DrawingEngine.redraw();
              }
            });
            gannTimeContainer.appendChild(cell);
          });
        }

        // Price sub options
        const leftLblChk = document.getElementById('ds-gann-left-labels');
        const rightLblChk = document.getElementById('ds-gann-right-labels');
        const priceBgChk = document.getElementById('ds-gann-price-bg-en');
        const priceBgOpacity = document.getElementById('ds-gann-price-bg-opacity');
        const priceBgOpacityVal = document.getElementById('ds-gann-price-bg-opacity-val');

        if (leftLblChk) {
          leftLblChk.checked = d.leftLabels !== false;
          leftLblChk.onchange = () => { d.leftLabels = leftLblChk.checked; window.DrawingEngine.redraw(); };
        }
        if (rightLblChk) {
          rightLblChk.checked = d.rightLabels !== false;
          rightLblChk.onchange = () => { d.rightLabels = rightLblChk.checked; window.DrawingEngine.redraw(); };
        }
        if (priceBgChk) {
          priceBgChk.checked = d.priceBgEnabled !== false;
          priceBgChk.onchange = () => { d.priceBgEnabled = priceBgChk.checked; window.DrawingEngine.redraw(); };
        }
        if (priceBgOpacity) {
          const curO = d.priceBgOpacity !== undefined ? d.priceBgOpacity : 20;
          priceBgOpacity.value = curO;
          if (priceBgOpacityVal) priceBgOpacityVal.textContent = `${curO}%`;
          priceBgOpacity.oninput = () => {
            const v = parseInt(priceBgOpacity.value, 10);
            if (priceBgOpacityVal) priceBgOpacityVal.textContent = `${v}%`;
            d.priceBgOpacity = v;
            window.DrawingEngine.redraw();
          };
        }

        // Time sub options
        const topLblChk = document.getElementById('ds-gann-top-labels');
        const bottomLblChk = document.getElementById('ds-gann-bottom-labels');
        const timeBgChk = document.getElementById('ds-gann-time-bg-en');
        const timeBgOpacity = document.getElementById('ds-gann-time-bg-opacity');
        const timeBgOpacityVal = document.getElementById('ds-gann-time-bg-opacity-val');

        if (topLblChk) {
          topLblChk.checked = d.topLabels === true;
          topLblChk.onchange = () => { d.topLabels = topLblChk.checked; window.DrawingEngine.redraw(); };
        }
        if (bottomLblChk) {
          bottomLblChk.checked = d.bottomLabels !== false;
          bottomLblChk.onchange = () => { d.bottomLabels = bottomLblChk.checked; window.DrawingEngine.redraw(); };
        }
        if (timeBgChk) {
          timeBgChk.checked = d.timeBgEnabled !== false;
          timeBgChk.onchange = () => { d.timeBgEnabled = timeBgChk.checked; window.DrawingEngine.redraw(); };
        }
        if (timeBgOpacity) {
          const curO = d.timeBgOpacity !== undefined ? d.timeBgOpacity : 20;
          timeBgOpacity.value = curO;
          if (timeBgOpacityVal) timeBgOpacityVal.textContent = `${curO}%`;
          timeBgOpacity.oninput = () => {
            const v = parseInt(timeBgOpacity.value, 10);
            if (timeBgOpacityVal) timeBgOpacityVal.textContent = `${v}%`;
            d.timeBgOpacity = v;
            window.DrawingEngine.redraw();
          };
        }

        // General options
        const useOneColChk = document.getElementById('ds-gann-use-one-color');
        const oneColBtn = document.getElementById('ds-gann-one-color');
        if (useOneColChk) {
          useOneColChk.checked = d.useOneColor === true;
          useOneColChk.onchange = () => { d.useOneColor = useOneColChk.checked; window.DrawingEngine.redraw(); };
        }
        if (oneColBtn) {
          oneColBtn.value = d.oneColor || '#00bcd4';
          oneColBtn.style.backgroundColor = d.oneColor || '#00bcd4';
        }

        const anglesChk = document.getElementById('ds-gann-angles');
        const anglesColBtn = document.getElementById('ds-gann-angles-color');
        if (anglesChk) {
          anglesChk.checked = d.angles === true;
          anglesChk.onchange = () => { d.angles = anglesChk.checked; window.DrawingEngine.redraw(); };
        }
        if (anglesColBtn) {
          anglesColBtn.value = d.anglesColor || '#787b86';
          anglesColBtn.style.backgroundColor = d.anglesColor || '#787b86';
        }

        const revChk = document.getElementById('ds-gann-reverse');
        if (revChk) {
          revChk.checked = d.reverse === true;
          revChk.onchange = () => { d.reverse = revChk.checked; window.DrawingEngine.redraw(); };
        }
      } else {
        modal.classList.remove('is-fib-modal');
        modal.classList.remove('is-gannbox-modal');
        if (genericLineSec) genericLineSec.style.display = 'block';
        if (fibSection) fibSection.style.display = 'none';
        if (gannSection) gannSection.style.display = 'none';
      }

      // Populate Coordinates
      const p1PriceInput = document.getElementById('ds-coord-p1-price');
      const p1TimeInput = document.getElementById('ds-coord-p1-time');
      const p2PriceInput = document.getElementById('ds-coord-p2-price');
      const p2TimeInput = document.getElementById('ds-coord-p2-time');

      if (p1PriceInput && d.p1) p1PriceInput.value = d.p1.price.toFixed(2);
      if (p1TimeInput && d.p1) p1TimeInput.value = new Date(d.p1.time * 1000).toLocaleString();
      if (p2PriceInput && d.p2) p2PriceInput.value = d.p2.price.toFixed(2);
      if (p2TimeInput && d.p2) p2TimeInput.value = new Date(d.p2.time * 1000).toLocaleString();

      modal.classList.add('active');
    };

    // Live update listeners
    const colorInput = document.getElementById('ds-line-color');
    if (colorInput) {
      colorInput.addEventListener('input', (e) => {
        if (activeDrawing) {
          activeDrawing.color = e.target.value;
          window.DrawingEngine.redraw();
        }
      });
    }

    const opacitySlider = document.getElementById('ds-line-opacity');
    const opacityVal = document.getElementById('ds-line-opacity-val');
    if (opacitySlider) {
      opacitySlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (opacityVal) opacityVal.textContent = `${val}%`;
        if (activeDrawing) {
          activeDrawing.opacity = val;
          window.DrawingEngine.redraw();
        }
      });
    }

    // Width buttons
    modal.querySelectorAll('#ds-width-group .ds-choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('#ds-width-group .ds-choice-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (activeDrawing) {
          activeDrawing.lineWidth = parseInt(btn.getAttribute('data-val'), 10);
          window.DrawingEngine.redraw();
        }
      });
    });

    // Style buttons
    modal.querySelectorAll('#ds-style-group .ds-choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('#ds-style-group .ds-choice-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (activeDrawing) {
          activeDrawing.lineStyle = btn.getAttribute('data-val');
          window.DrawingEngine.redraw();
        }
      });
    });

    // Fill checkbox & color
    const fillEnable = document.getElementById('ds-fill-enable');
    const fillColor = document.getElementById('ds-fill-color');
    const fillOpacity = document.getElementById('ds-fill-opacity');
    const fillOpacityVal = document.getElementById('ds-fill-opacity-val');

    if (fillEnable) {
      fillEnable.addEventListener('change', () => {
        if (activeDrawing) {
          activeDrawing.fillEnabled = fillEnable.checked;
          window.DrawingEngine.redraw();
        }
      });
    }
    if (fillColor) {
      fillColor.addEventListener('input', () => {
        if (activeDrawing) {
          activeDrawing.fillColor = fillColor.value;
          window.DrawingEngine.redraw();
        }
      });
    }
    if (fillOpacity) {
      fillOpacity.addEventListener('input', () => {
        const val = parseInt(fillOpacity.value, 10);
        if (fillOpacityVal) fillOpacityVal.textContent = `${val}%`;
        if (activeDrawing) {
          activeDrawing.fillOpacity = val;
          window.DrawingEngine.redraw();
        }
      });
    }

    // Text input
    const textInput = document.getElementById('ds-text-content');
    if (textInput) {
      textInput.addEventListener('input', () => {
        if (activeDrawing) {
          if (activeDrawing.type === 'rectangle') activeDrawing.label = textInput.value;
          else activeDrawing.text = textInput.value;
          window.DrawingEngine.redraw();
        }
      });
    }

    // Coordinates inputs
    const p1PriceInput = document.getElementById('ds-coord-p1-price');
    const p2PriceInput = document.getElementById('ds-coord-p2-price');
    if (p1PriceInput) {
      p1PriceInput.addEventListener('input', () => {
        const val = parseFloat(p1PriceInput.value);
        if (!isNaN(val) && activeDrawing) {
          activeDrawing.p1.price = val;
          window.DrawingEngine.redraw();
        }
      });
    }
    if (p2PriceInput) {
      p2PriceInput.addEventListener('input', () => {
        const val = parseFloat(p2PriceInput.value);
        if (!isNaN(val) && activeDrawing) {
          activeDrawing.p2.price = val;
          window.DrawingEngine.redraw();
        }
      });
    }

    function closeModal() {
      modal.classList.remove('active');
      closeTradingViewColorPicker();
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        if (activeDrawing && backupState) {
          Object.assign(activeDrawing, backupState);
          window.DrawingEngine.redraw();
        }
        closeModal();
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        if (window.DrawingEngine) {
          try {
            localStorage.setItem('tv_user_drawings', JSON.stringify(window.DrawingEngine.getDrawings()));
          } catch (e) {}
        }
        showToast('Settings saved / បានរក្សាទុកការកំណត់');
        closeModal();
      });
    }
    if (defaultsBtn) {
      defaultsBtn.addEventListener('click', () => {
        if (activeDrawing) {
          if (activeDrawing.type === 'fib') {
            activeDrawing.fibLevels = JSON.parse(JSON.stringify(window.TV_DEFAULT_24_FIB_LEVELS || []));
            activeDrawing.showTrendLine = true;
            activeDrawing.trendLineColor = 'rgba(209, 212, 220, 0.65)';
            activeDrawing.trendLineWidth = 1.2;
            activeDrawing.trendLineStyle = 'dashed';
            activeDrawing.levelLineWidth = 1;
            activeDrawing.levelLineStyle = 'solid';
            activeDrawing.extendMode = 'none';
            activeDrawing.useOneColor = false;
            activeDrawing.oneColor = '#00897b';
            activeDrawing.fillEnabled = true;
            activeDrawing.fillOpacity = 20;
            activeDrawing.reverse = false;
            activeDrawing.showPrices = true;
            activeDrawing.showLevels = true;
            activeDrawing.levelsFormat = 'values';
            activeDrawing.labelHorz = 'left';
            activeDrawing.labelVert = 'middle';
            activeDrawing.showText = true;
            activeDrawing.textHorz = 'center';
            activeDrawing.textVert = 'middle';
            activeDrawing.fontSize = 12;
            activeDrawing.logScale = false;
          } else if (activeDrawing.type === 'gann_box') {
            activeDrawing.priceLevels = JSON.parse(JSON.stringify(window.TV_DEFAULT_GANN_PRICE_LEVELS || []));
            activeDrawing.timeLevels = JSON.parse(JSON.stringify(window.TV_DEFAULT_GANN_TIME_LEVELS || []));
            activeDrawing.leftLabels = true;
            activeDrawing.rightLabels = true;
            activeDrawing.priceBgEnabled = true;
            activeDrawing.priceBgOpacity = 20;
            activeDrawing.topLabels = false;
            activeDrawing.bottomLabels = true;
            activeDrawing.timeBgEnabled = true;
            activeDrawing.timeBgOpacity = 20;
            activeDrawing.useOneColor = false;
            activeDrawing.oneColor = '#00bcd4';
            activeDrawing.angles = false;
            activeDrawing.anglesColor = '#787b86';
            activeDrawing.reverse = false;
          } else {
            activeDrawing.color = '#2962ff';
            activeDrawing.lineWidth = 2;
            activeDrawing.lineStyle = 'solid';
            activeDrawing.fillEnabled = true;
            activeDrawing.fillColor = '#2962ff';
            activeDrawing.fillOpacity = 20;
            activeDrawing.opacity = 100;
          }
          window.DrawingEngine.redraw();
          window.openDrawingSettingsModal(activeDrawing);
        }
      });
    }
  }

  function openChartSettingsModal(initialTab = 'symbol') {
    const modal = document.getElementById('modal-chart-settings');
    if (!modal) return;

    // Switch to initial tab
    const navItems = modal.querySelectorAll('.tv-cs-nav-item');
    const panes = modal.querySelectorAll('.tv-cs-pane');
    navItems.forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-cs-tab') === initialTab);
    });
    panes.forEach(p => {
      p.classList.toggle('active', p.id === `pane-cs-${initialTab}`);
    });

    bindAllColorInputs();
    modal.classList.add('active');
  }

  window.openChartSettingsModal = openChartSettingsModal;

  /**
   * ============================================================================
   * TRADINGVIEW PRO COLOR PICKER SYSTEM (Exact match to User Screenshot)
   * 8 rows x 10 columns = 80 swatches + Divider + Custom Color (+) + Opacity Slider & Badge
   * ============================================================================
   */
  const TV_PALETTE = [
    // Row 0: Grayscale (10)
    ['#ffffff', '#e0e3eb', '#d1d4dc', '#b2b5be', '#9598a1', '#787b86', '#5d606b', '#434651', '#2a2e39', '#000000'],
    // Row 1: Base Bright Colors (10)
    ['#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#00897b', '#00bcd4', '#2962ff', '#7b1fa2', '#ab47bc', '#e91e63'],
    // Row 2: Lightest pastel tints (10)
    ['#fccbcd', '#ffe0b2', '#fff9c4', '#c8e6c9', '#b2dfdb', '#b3e5fc', '#c5cae9', '#d1c4e9', '#e1bee7', '#f8bbd0'],
    // Row 3: Light tints (10)
    ['#ff9da4', '#ffcc80', '#fff59d', '#a5d6a7', '#80cbc4', '#81d4fa', '#9fa8da', '#b39ddb', '#ce93d8', '#f48fb1'],
    // Row 4: Soft tints (10)
    ['#f77c80', '#ffb74d', '#fff176', '#81c784', '#4db6ac', '#4fc3f7', '#7986cb', '#9575cd', '#ba68c8', '#f06292'],
    // Row 5: Medium tones (10)
    ['#f23645', '#ffa726', '#ffee58', '#4caf50', '#26a69a', '#29b6f6', '#5c6bc0', '#7e57c2', '#ab47bc', '#ec407a'],
    // Row 6: Deep saturated tones (10)
    ['#c2185b', '#f57c00', '#fbc02d', '#388e3c', '#00897b', '#0288d1', '#3949ab', '#5e35b1', '#8e24aa', '#d81b60'],
    // Row 7: Dark shadow tones (10)
    ['#7f0000', '#e65100', '#f57f17', '#1b5e20', '#004d40', '#01579b', '#1a237e', '#311b92', '#4a148c', '#880e4f']
  ];

  let activeColorTarget = null;
  let activeColorTargetId = null;
  let activeColorCallback = null;

  function hexToRgba(hex, alpha = 1) {
    if (!hex) return `rgba(41, 98, 255, ${alpha})`;
    let c = hex.replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    const r = parseInt(c.substring(0, 2), 16) || 0;
    const g = parseInt(c.substring(2, 4), 16) || 0;
    const b = parseInt(c.substring(4, 6), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * Master Chart & Settings Recolor Functions (Directly updates chart in real time)
   */
  const CHART_SETTINGS_STORAGE_KEY = 'tv_chart_settings';

  function applyCandleSettings() {
    if (!candleSeries) return;
    const bodyChecked = document.getElementById('cs-candles-body')?.checked ?? true;
    const bordersChecked = document.getElementById('cs-candles-borders')?.checked ?? true;
    const wickChecked = document.getElementById('cs-candles-wick')?.checked ?? true;

    const upColor = document.getElementById('cs-candle-up')?.value || '#089981';
    const downColor = document.getElementById('cs-candle-down')?.value || '#f23645';
    const borderUpColor = document.getElementById('cs-border-up')?.value || '#089981';
    const borderDownColor = document.getElementById('cs-border-down')?.value || '#f23645';
    const wickUpColor = document.getElementById('cs-wick-up')?.value || '#089981';
    const wickDownColor = document.getElementById('cs-wick-down')?.value || '#f23645';

    candleSeries.applyOptions({
      upColor: bodyChecked ? upColor : 'transparent',
      downColor: bodyChecked ? downColor : 'transparent',
      borderVisible: bordersChecked,
      borderUpColor: borderUpColor,
      borderDownColor: borderDownColor,
      wickVisible: wickChecked,
      wickUpColor: wickUpColor,
      wickDownColor: wickDownColor
    });

    // Auto-persist in localStorage
    saveChartSettings(true);
  }

  function applyGridSettings() {
    if (!chart) return;
    const vertVisible = document.getElementById('cs-cv-grid-vert')?.checked ?? true;
    const vertColor = document.getElementById('cs-cv-grid-vert-col')?.value || '#1e222d';
    const horzVisible = document.getElementById('cs-cv-grid-horz')?.checked ?? true;
    const horzColor = document.getElementById('cs-cv-grid-horz-col')?.value || '#1e222d';

    chart.applyOptions({
      grid: {
        vertLines: { visible: vertVisible, color: vertColor },
        horzLines: { visible: horzVisible, color: horzColor }
      }
    });

    saveChartSettings(true);
  }

  function saveChartSettings(isLocalOnly = false) {
    const settings = {
      bodyVisible: document.getElementById('cs-candles-body')?.checked ?? true,
      bordersVisible: document.getElementById('cs-candles-borders')?.checked ?? true,
      wickVisible: document.getElementById('cs-candles-wick')?.checked ?? true,
      candleUpColor: document.getElementById('cs-candle-up')?.value || '#089981',
      candleDownColor: document.getElementById('cs-candle-down')?.value || '#f23645',
      borderUpColor: document.getElementById('cs-border-up')?.value || '#089981',
      borderDownColor: document.getElementById('cs-border-down')?.value || '#f23645',
      wickUpColor: document.getElementById('cs-wick-up')?.value || '#089981',
      wickDownColor: document.getElementById('cs-wick-down')?.value || '#f23645',
      bgColor: document.getElementById('cs-cv-bg-color')?.value || '#131722',
      gridVert: document.getElementById('cs-cv-grid-vert')?.checked ?? true,
      gridVertColor: document.getElementById('cs-cv-grid-vert-col')?.value || '#1e222d',
      gridHorz: document.getElementById('cs-cv-grid-horz')?.checked ?? true,
      gridHorzColor: document.getElementById('cs-cv-grid-horz-col')?.value || '#1e222d',
      crosshairColor: document.getElementById('cs-cv-crosshair-col')?.value || '#758696',
      precision: document.getElementById('cs-precision')?.value || 'default',
      timezone: document.getElementById('cs-timezone')?.value || 'exchange'
    };

    try {
      localStorage.setItem(CHART_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {}

    if (!isLocalOnly) {
      const uid = localStorage.getItem('tv_active_user_id') || 'default';
      fetch('/api/settings/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: uid, settings })
      }).catch(() => {});
    }
  }

  function applySettingsObject(settings) {
    if (!settings) return;

    const setColorInput = (id, color) => {
      const el = document.getElementById(id);
      if (el && color) {
        el.value = color;
        el.setAttribute('value', color);
        el.style.backgroundColor = color;
      }
    };
    const setCheckbox = (id, checked) => {
      const el = document.getElementById(id);
      if (el && checked !== undefined) el.checked = !!checked;
    };

    setCheckbox('cs-candles-body', settings.bodyVisible);
    setCheckbox('cs-candles-borders', settings.bordersVisible);
    setCheckbox('cs-candles-wick', settings.wickVisible);

    setColorInput('cs-candle-up', settings.candleUpColor);
    setColorInput('cs-candle-down', settings.candleDownColor);
    setColorInput('cs-border-up', settings.borderUpColor);
    setColorInput('cs-border-down', settings.borderDownColor);
    setColorInput('cs-wick-up', settings.wickUpColor);
    setColorInput('cs-wick-down', settings.wickDownColor);

    setColorInput('cs-cv-bg-color', settings.bgColor);
    setCheckbox('cs-cv-grid-vert', settings.gridVert);
    setColorInput('cs-cv-grid-vert-col', settings.gridVertColor);
    setCheckbox('cs-cv-grid-horz', settings.gridHorz);
    setColorInput('cs-cv-grid-horz-col', settings.gridHorzColor);
    setColorInput('cs-cv-crosshair-col', settings.crosshairColor);

    if (settings.precision) {
      const sel = document.getElementById('cs-precision');
      if (sel) sel.value = settings.precision;
    }
    if (settings.timezone) {
      const sel = document.getElementById('cs-timezone');
      if (sel) sel.value = settings.timezone;
    }

    if (candleSeries) {
      const bodyChecked = settings.bodyVisible !== false;
      const bordersChecked = settings.bordersVisible !== false;
      const wickChecked = settings.wickVisible !== false;
      candleSeries.applyOptions({
        upColor: bodyChecked ? (settings.candleUpColor || '#089981') : 'transparent',
        downColor: bodyChecked ? (settings.candleDownColor || '#f23645') : 'transparent',
        borderVisible: bordersChecked,
        borderUpColor: settings.borderUpColor || '#089981',
        borderDownColor: settings.borderDownColor || '#f23645',
        wickVisible: wickChecked,
        wickUpColor: settings.wickUpColor || '#089981',
        wickDownColor: settings.wickDownColor || '#f23645'
      });
    }

    if (chart) {
      const vertVisible = settings.gridVert !== false;
      const vertColor = settings.gridVertColor || '#1e222d';
      const horzVisible = settings.gridHorz !== false;
      const horzColor = settings.gridHorzColor || '#1e222d';
      chart.applyOptions({
        grid: {
          vertLines: { visible: vertVisible, color: vertColor },
          horzLines: { visible: horzVisible, color: horzColor }
        }
      });
      if (settings.bgColor) {
        chart.applyOptions({ layout: { background: { color: settings.bgColor } } });
      }
    }
  }

  function loadChartSettings() {
    let settings = null;
    try {
      const saved = localStorage.getItem(CHART_SETTINGS_STORAGE_KEY);
      if (saved) settings = JSON.parse(saved);
    } catch (e) {}

    const uid = localStorage.getItem('tv_active_user_id') || 'default';
    fetch(`/api/settings?user_id=${encodeURIComponent(uid)}`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'ok' && data.settings && typeof data.settings === 'object') {
          applySettingsObject({ ...settings, ...data.settings });
        }
      })
      .catch(() => {});

    if (settings) {
      applySettingsObject(settings);
    }
  }

  function initTradingViewColorPicker() {
    const popover = document.getElementById('tv-color-picker-popover');
    if (!popover) return;

    // Custom color (+) button
    const customBtn = document.getElementById('tv-cp-custom-btn');
    const nativePicker = document.getElementById('tv-cp-native-color-picker');
    if (customBtn && nativePicker) {
      customBtn.onclick = (e) => {
        e.stopPropagation();
        nativePicker.click();
      };
      nativePicker.onchange = (e) => {
        selectColorFromPicker(e.target.value, true);
      };
    }

    // Opacity slider & editable badge sync
    const opacitySlider = document.getElementById('tv-cp-opacity-slider');
    const opacityBadge = document.getElementById('tv-cp-opacity-badge');
    if (opacitySlider && opacityBadge) {
      opacitySlider.oninput = () => {
        const val = parseInt(opacitySlider.value) || 0;
        opacityBadge.value = `${val}%`;
        applyColorToTarget(null, val);
      };

      const handleBadgeInput = () => {
        let num = parseInt(opacityBadge.value.replace(/[^0-9]/g, ''));
        if (isNaN(num)) num = 100;
        if (num < 0) num = 0;
        if (num > 100) num = 100;
        opacityBadge.value = `${num}%`;
        opacitySlider.value = num;
        applyColorToTarget(null, num);
      };

      opacityBadge.onchange = handleBadgeInput;
      opacityBadge.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleBadgeInput();
          opacityBadge.blur();
        }
      };
    }

    // Dismiss popover when clicking anywhere outside
    document.addEventListener('mousedown', (e) => {
      if (!popover || popover.style.display === 'none') return;
      if (!popover.contains(e.target) && !e.target.closest('.tv-cs-color-input') && !e.target.closest('.ds-color-input') && !e.target.closest('#btn-draw-color')) {
        closeTradingViewColorPicker();
      }
    });

    // Close on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeTradingViewColorPicker();
      }
    });

    // MutationObserver on Settings modal: when modal is closed, close color picker
    const csModalEl = document.getElementById('modal-chart-settings');
    if (csModalEl && window.MutationObserver) {
      const mo = new MutationObserver(() => {
        if (!csModalEl.classList.contains('active')) {
          closeTradingViewColorPicker();
        }
      });
      mo.observe(csModalEl, { attributes: true, attributeFilter: ['class'] });
    }

    bindAllColorInputs();
  }

  function bindAllColorInputs() {
    const inputs = document.querySelectorAll('.tv-cs-color-input, .ds-color-input, #btn-draw-color');
    inputs.forEach(el => {
      el.onclick = (e) => {
        openTradingViewColorPicker(el, e);
      };
    });
  }

  function openTradingViewColorPicker(target, e = null) {
    if (e && e.stopPropagation) {
      e.stopPropagation();
      e.preventDefault();
    }
    const popover = document.getElementById('tv-color-picker-popover');
    if (!popover || !target) return;

    activeColorTarget = target;
    activeColorTargetId = target.id;
    activeColorCallback = null;

    let currentColor = '#2962ff';
    let currentOpacity = 100;

    if (target.id === 'btn-draw-color') {
      const activeDrawing = window.DrawingEngine?.getSelectedDrawing?.();
      if (activeDrawing) {
        currentColor = activeDrawing.color || '#2962ff';
        currentOpacity = activeDrawing.opacity !== undefined ? activeDrawing.opacity : (activeDrawing.fillOpacity !== undefined ? activeDrawing.fillOpacity : 100);
      }
    } else if (target.value) {
      currentColor = target.value;
      currentOpacity = target.getAttribute('data-opacity') ? parseInt(target.getAttribute('data-opacity')) : 100;
    } else if (target.style.backgroundColor) {
      currentColor = target.style.backgroundColor;
    }

    // Normalize color to hex
    if (currentColor.startsWith('rgb')) {
      const parts = currentColor.match(/\d+/g);
      if (parts && parts.length >= 3) {
        currentColor = '#' + parts.slice(0, 3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
        if (parts.length >= 4) {
          currentOpacity = Math.round(parseFloat(parts[3]) * 100);
        }
      }
    }

    currentColor = currentColor.toLowerCase();

    // Highlight matching swatch
    const swatches = popover.querySelectorAll('.tv-cp-swatch');
    swatches.forEach(sw => {
      const swCol = sw.getAttribute('data-color');
      sw.classList.toggle('active', swCol === currentColor);
    });

    // Update opacity controls
    const opacitySlider = document.getElementById('tv-cp-opacity-slider');
    const opacityBadge = document.getElementById('tv-cp-opacity-badge');
    const gradientOverlay = document.getElementById('tv-cp-gradient-overlay');

    if (opacitySlider) opacitySlider.value = currentOpacity;
    if (opacityBadge) opacityBadge.value = `${currentOpacity}%`;
    if (gradientOverlay) {
      gradientOverlay.style.background = `linear-gradient(to right, ${hexToRgba(currentColor, 0)}, ${hexToRgba(currentColor, 1)})`;
    }

    // Position popover
    popover.style.display = 'flex';
    const rect = target.getBoundingClientRect();
    const popW = 272;
    const popH = popover.offsetHeight || 320;
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    let posX;
    if (rect.right + popW > winW - 12 || rect.left > winW / 2) {
      posX = rect.right - popW;
    } else {
      posX = rect.left;
    }

    if (posX + popW > winW - 12) posX = winW - popW - 12;
    if (posX < 12) posX = 12;

    let posY = rect.bottom + 6;
    if (posY + popH > winH - 12) {
      posY = rect.top - popH - 6;
      if (posY < 12) posY = 12;
    }

    popover.style.left = `${posX}px`;
    popover.style.top = `${posY}px`;
  }

  function closeTradingViewColorPicker() {
    const popover = document.getElementById('tv-color-picker-popover');
    if (popover) {
      popover.style.display = 'none';
    }
  }

  function selectColorFromPicker(colorHex, closePicker = true) {
    const popover = document.getElementById('tv-color-picker-popover');
    if (!popover) return;

    colorHex = colorHex.toLowerCase();

    // Update active ring
    const swatches = popover.querySelectorAll('.tv-cp-swatch');
    swatches.forEach(sw => {
      sw.classList.toggle('active', sw.getAttribute('data-color') === colorHex);
    });

    // Update opacity track gradient
    const gradientOverlay = document.getElementById('tv-cp-gradient-overlay');
    if (gradientOverlay) {
      gradientOverlay.style.background = `linear-gradient(to right, ${hexToRgba(colorHex, 0)}, ${hexToRgba(colorHex, 1)})`;
    }

    const opacitySlider = document.getElementById('tv-cp-opacity-slider');
    const opacity = opacitySlider ? parseInt(opacitySlider.value) : 100;

    try {
      applyColorToTarget(colorHex, opacity);
    } finally {
      if (closePicker) {
        closeTradingViewColorPicker();
      }
    }
  }

  function applyColorToTarget(colorHex, opacity) {
    let target = activeColorTarget;
    if (!target && activeColorTargetId) {
      target = document.getElementById(activeColorTargetId);
    }
    if (!target) return;

    if (colorHex) {
      target.value = colorHex;
      target.setAttribute('value', colorHex);
      target.style.backgroundColor = colorHex;
    }
    if (opacity !== undefined) {
      target.setAttribute('data-opacity', opacity);
    }

    if (target.id === 'btn-draw-color' || target.id === 'ds-line-color') {
      const activeDrawing = window.DrawingEngine?.getSelectedDrawing?.();
      if (activeDrawing) {
        if (colorHex) activeDrawing.color = colorHex;
        if (opacity !== undefined) {
          activeDrawing.opacity = opacity;
          if (activeDrawing.fillEnabled) activeDrawing.fillOpacity = opacity;
        }
        window.DrawingEngine.redraw();
        const preview = document.getElementById('draw-color-preview');
        if (preview && colorHex) preview.style.backgroundColor = colorHex;
      }
    } else if (target.id === 'ds-fill-color') {
      const activeDrawing = window.DrawingEngine?.getSelectedDrawing?.();
      if (activeDrawing) {
        if (colorHex) activeDrawing.fillColor = colorHex;
        if (opacity !== undefined) activeDrawing.fillOpacity = opacity;
        window.DrawingEngine.redraw();
      }
    } else if (target.id.startsWith('fib-col-')) {
      const idx = parseInt(target.id.replace('fib-col-', ''), 10);
      const activeDrawing = window.DrawingEngine?.getSelectedDrawing?.();
      if (activeDrawing && activeDrawing.fibLevels && activeDrawing.fibLevels[idx]) {
        activeDrawing.fibLevels[idx].color = colorHex;
        window.DrawingEngine.redraw();
      }
    } else if (target.id === 'ds-fib-trendline-col') {
      const activeDrawing = window.DrawingEngine?.getSelectedDrawing?.();
      if (activeDrawing) {
        activeDrawing.trendLineColor = colorHex;
        window.DrawingEngine.redraw();
      }
    } else if (target.id === 'ds-fib-levelline-col') {
      const activeDrawing = window.DrawingEngine?.getSelectedDrawing?.();
      if (activeDrawing) {
        activeDrawing.levelLineColor = colorHex;
        window.DrawingEngine.redraw();
      }
    } else if (target.id === 'ds-fib-one-color') {
      const activeDrawing = window.DrawingEngine?.getSelectedDrawing?.();
      if (activeDrawing) {
        activeDrawing.oneColor = colorHex;
        window.DrawingEngine.redraw();
      }
    } else if (target.id.startsWith('gann-pcol-')) {
      const idx = parseInt(target.id.replace('gann-pcol-', ''), 10);
      const activeDrawing = window.DrawingEngine?.getSelectedDrawing?.();
      if (activeDrawing && activeDrawing.priceLevels && activeDrawing.priceLevels[idx]) {
        activeDrawing.priceLevels[idx].color = colorHex;
        window.DrawingEngine.redraw();
      }
    } else if (target.id.startsWith('gann-tcol-')) {
      const idx = parseInt(target.id.replace('gann-tcol-', ''), 10);
      const activeDrawing = window.DrawingEngine?.getSelectedDrawing?.();
      if (activeDrawing && activeDrawing.timeLevels && activeDrawing.timeLevels[idx]) {
        activeDrawing.timeLevels[idx].color = colorHex;
        window.DrawingEngine.redraw();
      }
    } else if (target.id === 'ds-gann-one-color') {
      const activeDrawing = window.DrawingEngine?.getSelectedDrawing?.();
      if (activeDrawing) {
        activeDrawing.oneColor = colorHex;
        window.DrawingEngine.redraw();
      }
    } else if (target.id === 'ds-gann-angles-color') {
      const activeDrawing = window.DrawingEngine?.getSelectedDrawing?.();
      if (activeDrawing) {
        activeDrawing.anglesColor = colorHex;
        window.DrawingEngine.redraw();
      }
    }

    // Chart Settings inputs
    if (target.id.startsWith('cs-candle') || target.id.startsWith('cs-border') || target.id.startsWith('cs-wick')) {
      applyCandleSettings();
    } else if (target.id === 'cs-cv-bg-color') {
      if (chart) chart.applyOptions({ layout: { background: { color: target.value } } });
    } else if (target.id.startsWith('cs-cv-grid')) {
      applyGridSettings();
    } else if (target.id === 'cs-cv-crosshair-col') {
      if (chart) {
        chart.applyOptions({
          crosshair: {
            vertLine: { color: target.value },
            horzLine: { color: target.value }
          }
        });
      }
    } else if (target.id === 'cs-cv-watermark-col') {
      const wm = document.getElementById('chart-watermark');
      if (wm) wm.style.color = target.value;
    } else if (target.id === 'cs-cv-scale-text-col' || target.id === 'cs-cv-scale-lines-col') {
      if (chart) {
        const textCol = document.getElementById('cs-cv-scale-text-col')?.value || '#787b86';
        const linesCol = document.getElementById('cs-cv-scale-lines-col')?.value || '#2a2e39';
        chart.applyOptions({
          layout: { textColor: textCol },
          rightPriceScale: { borderColor: linesCol },
          leftPriceScale: { borderColor: linesCol },
          timeScale: { borderColor: linesCol }
        });
      }
    } else if (target.id === 'cs-alt-color') {
      updateAlertPriceLine();
    }

    try {
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {}

    if (typeof activeColorCallback === 'function') {
      try {
        activeColorCallback(colorHex || target.value, opacity);
      } catch (e) {}
    }
  }

  window.openTradingViewColorPicker = openTradingViewColorPicker;
  window.selectColorFromPicker = selectColorFromPicker;
  window.closeTradingViewColorPicker = closeTradingViewColorPicker;
  window.initTradingViewColorPicker = initTradingViewColorPicker;
  window.bindAllColorInputs = bindAllColorInputs;
  window.applyCandleSettings = applyCandleSettings;
  window.applyGridSettings = applyGridSettings;
  window.saveChartSettings = saveChartSettings;
  window.loadChartSettings = loadChartSettings;

  function updateAlertPriceLine() {
    if (!candleSeries) return;
    if (alertPriceLine) {
      try { candleSeries.removePriceLine(alertPriceLine); } catch (e) {}
      alertPriceLine = null;
    }

    const showLines = document.getElementById('cs-alt-lines')?.checked ?? true;
    if (!showLines || alertPrice === null) return;

    const col = document.getElementById('cs-alt-color')?.value || '#f23645';
    const sym = DataFeed.getCurrentSymbol();
    alertPriceLine = candleSeries.createPriceLine({
      price: alertPrice,
      color: col,
      lineWidth: 1,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: `🔔 Alert ${alertPrice.toFixed(sym.digits)}`
    });
  }

  function setupChartSettingsModal() {
    const modal = document.getElementById('modal-chart-settings');
    if (!modal) return;

    const closeBtn = document.getElementById('btn-close-chart-settings');
    const cancelBtn = document.getElementById('btn-cs-cancel');
    const okBtn = document.getElementById('btn-cs-ok');
    const applyAllBtn = document.getElementById('btn-cs-apply-all');
    const templateBtn = document.getElementById('btn-cs-template');

    // Header Settings Cog button
    const headerSettingsBtn = document.getElementById('btn-chart-settings');
    if (headerSettingsBtn) {
      headerSettingsBtn.addEventListener('click', () => {
        openChartSettingsModal();
      });
    }

    // Keyboard shortcut Alt + S
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
        e.preventDefault();
        openChartSettingsModal();
      }
    });

    // Double-clicking on chart background to open settings
    const viewport = document.getElementById('chart-viewport');
    if (viewport) {
      viewport.addEventListener('dblclick', (e) => {
        if (e.target.closest('#tv-drawing-actions') || e.target.closest('.tv-replay-toolbar') || e.target.closest('.tv-fav-toolbar')) return;
        if (window.DrawingEngine && window.DrawingEngine.getSelectedDrawing && window.DrawingEngine.getSelectedDrawing()) return;
        openChartSettingsModal();
      });
    }

    // Navigation Tab switching (Symbol, Status line, Scales and lines, Canvas, Trading, Alerts, Events)
    const navItems = modal.querySelectorAll('.tv-cs-nav-item');
    const panes = modal.querySelectorAll('.tv-cs-pane');

    navItems.forEach(item => {
      item.addEventListener('click', () => {
        closeTradingViewColorPicker();
        const tabKey = item.getAttribute('data-cs-tab');
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');

        panes.forEach(p => {
          p.classList.toggle('active', p.id === `pane-cs-${tabKey}`);
        });
      });
    });

    // 1. Candlestick Style Live Updates uses module-level applyCandleSettings
    ['cs-candles-body', 'cs-candles-borders', 'cs-candles-wick'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', applyCandleSettings);
    });

    ['cs-candle-up', 'cs-candle-down', 'cs-border-up', 'cs-border-down', 'cs-wick-up', 'cs-wick-down'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', applyCandleSettings);
    });

    // 2. Buy/Sell buttons toggle (synchronized between Status line and Trading tabs)
    function syncBuySellButtons(visible) {
      const qp = document.getElementById('quick-trade-panel') || document.querySelector('.tv-quick-trade');
      if (qp) qp.style.display = visible ? 'flex' : 'none';
      const c1 = document.getElementById('cs-sl-buysell');
      const c2 = document.getElementById('cs-tr-buysell');
      if (c1) c1.checked = visible;
      if (c2) c2.checked = visible;
    }
    const bs1 = document.getElementById('cs-sl-buysell');
    const bs2 = document.getElementById('cs-tr-buysell');
    if (bs1) bs1.addEventListener('change', () => syncBuySellButtons(bs1.checked));
    if (bs2) bs2.addEventListener('change', () => syncBuySellButtons(bs2.checked));

    // 3. Trading tab: Positions & orders, PnL display mode, Reverse button, Extended lines
    const posOrdersCb = document.getElementById('cs-tr-positions-orders');
    const pnlModeSel = document.getElementById('cs-tr-pnl-pos-mode');
    const revBtnCb = document.getElementById('cs-tr-reverse-btn');
    const extLinesCb = document.getElementById('cs-tr-extend-lines');

    [posOrdersCb, pnlModeSel, revBtnCb, extLinesCb].forEach(el => {
      if (el) {
        el.addEventListener('change', () => {
          renderPositionLinesOnChart(PaperTrading.getAccountSummary().positions);
          updatePaperTradingUI(PaperTrading.getAccountSummary());
        });
      }
    });

    // 4. Alerts tab: Alert lines toggle & color
    const altLinesCb = document.getElementById('cs-alt-lines');
    const altColInput = document.getElementById('cs-alt-color');
    if (altLinesCb) altLinesCb.addEventListener('change', updateAlertPriceLine);
    if (altColInput) altColInput.addEventListener('input', updateAlertPriceLine);

    // 5. Trading execution marks (Trading tab)
    const execMarksCb = document.getElementById('cs-tr-exec-marks');
    const execLabelsCb = document.getElementById('cs-tr-exec-labels');

    [execMarksCb, execLabelsCb].forEach(el => {
      if (el) el.addEventListener('change', () => updateChartMarkers());
    });

    // 6. Canvas Background & Grid Live Updates (Canvas tab)
    const bgColorInput = document.getElementById('cs-cv-bg-color');
    if (bgColorInput) {
      bgColorInput.addEventListener('input', () => {
        if (chart) {
          chart.applyOptions({
            layout: { background: { color: bgColorInput.value } }
          });
        }
      });
    }

    function applyGridSettings() {
      
      if (!chart) return;
      const vertVisible = document.getElementById('cs-cv-grid-vert')?.checked ?? true;
      const vertColor = document.getElementById('cs-cv-grid-vert-col')?.value || '#1e222d';
      const horzVisible = document.getElementById('cs-cv-grid-horz')?.checked ?? true;
      const horzColor = document.getElementById('cs-cv-grid-horz-col')?.value || '#1e222d';

      chart.applyOptions({
        grid: {
          vertLines: { visible: vertVisible, color: vertColor },
          horzLines: { visible: horzVisible, color: horzColor }
        }
      });
    }

    ['cs-cv-grid-vert', 'cs-cv-grid-horz'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', applyGridSettings);
    });

    ['cs-cv-grid-vert-col', 'cs-cv-grid-horz-col'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', applyGridSettings);
    });

    // Crosshair live update
    const crosshairCol = document.getElementById('cs-cv-crosshair-col');
    if (crosshairCol) {
      crosshairCol.addEventListener('input', () => {
        if (chart) {
          chart.applyOptions({
            crosshair: {
              vertLine: { color: crosshairCol.value },
              horzLine: { color: crosshairCol.value }
            }
          });
        }
      });
    }

    // Watermark
    const wmMode = document.getElementById('cs-cv-watermark-mode');
    const wmCol = document.getElementById('cs-cv-watermark-col');
    function applyWatermark() {
      const wm = document.getElementById('chart-watermark');
      if (!wm) return;
      if (wmMode && wmMode.value === 'disabled') {
        wm.style.display = 'none';
      } else {
        wm.style.display = 'block';
        if (wmCol) wm.style.color = wmCol.value;
      }
    }
    if (wmMode) wmMode.addEventListener('change', applyWatermark);
    if (wmCol) wmCol.addEventListener('input', applyWatermark);

    // Margins live update
    function applyMargins() {
      if (!chart) return;
      const topM = (parseFloat(document.getElementById('cs-margin-top')?.value) || 10) / 100;
      const btmM = (parseFloat(document.getElementById('cs-margin-bottom')?.value) || 8) / 100;
      const rBars = parseInt(document.getElementById('cs-margin-right')?.value) || 10;
      try {
        chart.priceScale('right').applyOptions({ scaleMargins: { top: topM, bottom: btmM } });
        chart.timeScale().applyOptions({ rightOffset: rBars });
      } catch (e) {}
    }
    ['cs-margin-top', 'cs-margin-bottom', 'cs-margin-right'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', applyMargins);
    });

    // Scales placement live update
    const scalePlacementSel = document.getElementById('cs-scale-placement');
    if (scalePlacementSel) {
      scalePlacementSel.addEventListener('change', () => {
        if (!chart) return;
        const val = scalePlacementSel.value;
        if (val === 'left') {
          chart.applyOptions({ rightPriceScale: { visible: false }, leftPriceScale: { visible: true } });
        } else {
          chart.applyOptions({ rightPriceScale: { visible: true }, leftPriceScale: { visible: false } });
        }
      });
    }

    // Precision & Timezone live update
    const precSel = document.getElementById('cs-precision');
    if (precSel) {
      precSel.addEventListener('change', () => {
        const sym = DataFeed.getCurrentSymbol();
        if (precSel.value !== 'default') {
          sym.digits = parseInt(precSel.value);
        } else {
          sym.digits = (sym.id === 'XAU/USD' || sym.id.includes('JPY')) ? 2 : (sym.id.includes('BTC') ? 2 : 4);
        }
        updateHeaderSymbolInfo(sym);
        updateCountdownUI();
      });
    }

    const tzSel = document.getElementById('cs-timezone');
    if (tzSel) {
      tzSel.addEventListener('change', () => {
        showToast(`Chart Timezone: ${tzSel.options[tzSel.selectedIndex].text}`);
      });
    }

    // Countdown to bar close
    const countdownCb = document.getElementById('cs-lbl-countdown');
    if (countdownCb) {
      countdownCb.addEventListener('change', () => {
        const cd = document.getElementById('tv-price-countdown');
        if (cd) cd.style.display = countdownCb.checked ? 'flex' : 'none';
      });
    }

    // Modal closing & saving
    function closeModal() {
      modal.classList.remove('active');
      closeTradingViewColorPicker();
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (okBtn) {
      okBtn.addEventListener('click', () => {
        saveChartSettings(false);
        showToast('Settings saved / បានរក្សាទុកការកំណត់');
        closeModal();
      });
    }
    if (applyAllBtn) {
      applyAllBtn.addEventListener('click', () => {
        saveChartSettings(false);
        showToast('Settings applied to all layouts / បានអនុវត្តលើប្លង់ទាំងអស់');
      });
    }
    if (templateBtn) {
      templateBtn.addEventListener('click', () => {
        applySettingsObject({
          bodyVisible: true,
          bordersVisible: true,
          wickVisible: true,
          candleUpColor: '#089981',
          candleDownColor: '#f23645',
          borderUpColor: '#089981',
          borderDownColor: '#f23645',
          wickUpColor: '#089981',
          wickDownColor: '#f23645',
          bgColor: '#131722',
          gridVert: true,
          gridVertColor: '#1e222d',
          gridHorz: true,
          gridHorzColor: '#1e222d',
          crosshairColor: '#758696',
          precision: 'default',
          timezone: 'exchange'
        });
        saveChartSettings(false);
        showToast('Template: TradingView Default Dark (Applied)');
      });
    }
  }

  function setupIndicatorLegendActions() {
    const legendEl = document.getElementById('legend-indicators');
    if (!legendEl) return;

    legendEl.addEventListener('click', (e) => {
      const delBtn = e.target.closest('[data-del-ind]');
      if (!delBtn) return;
      e.stopPropagation();

      const indType = delBtn.getAttribute('data-del-ind');
      if (indType === 'ema20') {
        indConfig.ema20 = false;
        if (ema20Series) ema20Series.setData([]);
        const row = document.getElementById('legend-row-ema20');
        if (row) row.style.display = 'none';
        showToast('EMA 20 removed from chart / បានលុប EMA 20');
      } else if (indType === 'ema50') {
        indConfig.ema50 = false;
        if (ema50Series) ema50Series.setData([]);
        const row = document.getElementById('legend-row-ema50');
        if (row) row.style.display = 'none';
        showToast('EMA 50 removed from chart / បានលុប EMA 50');
      } else if (indType === 'ob') {
        indConfig.ob = false;
        const toggle = document.getElementById('toggle-ind-ob');
        if (toggle) toggle.checked = false;
        const row = document.getElementById('legend-row-ob');
        if (row) row.style.display = 'none';
        renderICTMarkers(currentCandles);
        showToast('Order Blocks removed / បានលុប Order Blocks');
      } else if (indType === 'fvg') {
        indConfig.fvg = false;
        const toggle = document.getElementById('toggle-ind-fvg');
        if (toggle) toggle.checked = false;
        const row = document.getElementById('legend-row-fvg');
        if (row) row.style.display = 'none';
        renderICTMarkers(currentCandles);
        showToast('Fair Value Gaps removed / បានលុប FVGs');
      }

      // Update badge count
      let count = 0;
      ['ob', 'fvg', 'liquidity', 'bos', 'ema', 'bb', 'volume'].forEach(k => {
        if (indConfig[k]) {
          if (k === 'ema' && indConfig.ema20 === false && indConfig.ema50 === false) return;
          count++;
        }
      });
      const badge = document.getElementById('badge-active-indicators');
      if (badge) badge.textContent = count;
    });
  }

  /**
   * Sets up TradingView Pro Chart Context Menu (Right-click on chart)
   * Exact match to user screenshot with dynamic prices, orders, and drawing/indicator counts.
   */
  function setupChartContextMenu() {
    const chartViewport = document.getElementById('chart-viewport');
    const menu = document.getElementById('tv-chart-context-menu');
    if (!chartViewport || !menu) return;

    let contextPrice = null;
    let contextSymbol = null;

    chartViewport.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const sym = DataFeed.getCurrentSymbol();
      contextSymbol = sym;

      // Calculate price at mouse cursor Y
      const rect = chartViewport.getBoundingClientRect();
      const mouseY = e.clientY - rect.top;
      let price = null;
      if (candleSeries && typeof candleSeries.coordinateToPrice === 'function') {
        price = candleSeries.coordinateToPrice(mouseY);
      }
      if (price === null || isNaN(price)) {
        const stats = DataFeed.getStats(sym.id);
        price = (stats && stats.price) ? stats.price : sym.basePrice;
      }
      contextPrice = price;

      const formattedPrice = Number(price).toLocaleString('en-US', {
        minimumFractionDigits: sym.digits,
        maximumFractionDigits: sym.digits
      });

      const symId = sym.id.replace('/', '');

      // Update dynamic labels in context menu (matching Image 1)
      const copyLabel = document.getElementById('ctx-copy-price-label');
      if (copyLabel) copyLabel.textContent = `Copy price ${formattedPrice}`;

      const alertLabel = document.getElementById('ctx-alert-label');
      if (alertLabel) alertLabel.textContent = `Add alert on ${symId} at ${formattedPrice}...`;

      const sellLabel = document.getElementById('ctx-sell-label');
      if (sellLabel) sellLabel.textContent = `Sell 1 ${symId} @ ${formattedPrice} limit`;

      const buyLabel = document.getElementById('ctx-buy-label');
      if (buyLabel) buyLabel.textContent = `Buy 1 ${symId} @ ${formattedPrice} stop`;

      const orderLabel = document.getElementById('ctx-order-label');
      if (orderLabel) orderLabel.textContent = `Add order on ${symId} at ${formattedPrice}...`;

      // Update dynamic drawings count & selected drawing delete option
      const dCount = (window.DrawingEngine && window.DrawingEngine.getDrawingsCount) ? window.DrawingEngine.getDrawingsCount() : 0;
      const dLabel = document.getElementById('ctx-remove-drawings-label');
      if (dLabel) dLabel.textContent = `Remove ${dCount} drawings`;

      const selDrawing = (window.DrawingEngine && window.DrawingEngine.getSelectedDrawing) ? window.DrawingEngine.getSelectedDrawing() : null;
      const delSelItem = document.getElementById('ctx-delete-selected-drawing');
      if (delSelItem) {
        if (selDrawing) {
          delSelItem.style.display = 'flex';
          const delSelLabel = document.getElementById('ctx-delete-drawing-label');
          if (delSelLabel) delSelLabel.textContent = `Delete this ${selDrawing.type.replace('_', ' ')}`;
        } else {
          delSelItem.style.display = 'none';
        }
      }

      // Update dynamic indicators count
      let indCount = 0;
      ['ob', 'fvg', 'liquidity', 'bos', 'ema', 'bb', 'volume'].forEach(k => {
        if (indConfig[k]) indCount++;
      });
      const indLabel = document.getElementById('ctx-remove-indicators-label');
      if (indLabel) indLabel.textContent = `Remove ${indCount} indicators`;

      // Position context menu clamped to window
      menu.style.display = 'block';
      const menuW = 275;
      const menuH = menu.offsetHeight || 500;
      const winW = window.innerWidth;
      const winH = window.innerHeight;

      let posX = e.clientX;
      let posY = e.clientY;

      if (posX + menuW > winW - 10) posX = winW - menuW - 10;
      if (posY + menuH > winH - 10) posY = winH - menuH - 10;
      if (posX < 10) posX = 10;
      if (posY < 10) posY = 10;

      menu.style.left = `${posX}px`;
      menu.style.top = `${posY}px`;
    });

    // Close menu when clicking outside or pressing Escape
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target)) {
        menu.style.display = 'none';
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeTradingViewColorPicker();
        const settingsModal = document.getElementById('modal-chart-settings');
        if (settingsModal) settingsModal.classList.remove('active');
      }
      // Alt + R hotkey for reset view
      if (e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        if (chart) chart.timeScale().fitContent();
        showToast('Reset chart view');
      }
      // Alt + A hotkey for alert
      if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        const alertModal = document.getElementById('modal-alert');
        if (alertModal) alertModal.classList.add('active');
      }
    });

    // Handle menu item clicks
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.tv-ctx-item');
      if (!item) return;
      const action = item.getAttribute('data-action');
      menu.style.display = 'none';

      handleContextMenuAction(action, contextPrice, contextSymbol);
    });
  }

  function handleContextMenuAction(action, price, symbol) {
    const sym = symbol || DataFeed.getCurrentSymbol();
    const digits = sym.digits;
    const pVal = price !== null ? price : sym.basePrice;
    const pStr = Number(pVal).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

    switch (action) {
      case 'reset_view':
        if (chart) {
          chart.timeScale().resetTimeScale();
          chart.timeScale().fitContent();
        }
        showToast('Reset chart view / កំណត់មើលតារាងឡើងវិញ');
        break;

      case 'copy_price':
        if (navigator.clipboard) {
          navigator.clipboard.writeText(pStr).then(() => {
            showToast(`Copied price ${pStr} to clipboard`);
          }).catch(() => {
            showToast(`Price: ${pStr}`);
          });
        } else {
          showToast(`Price: ${pStr}`);
        }
        break;

      case 'paste':
        showToast('Nothing to paste / គ្មានអ្វីត្រូវ Paste ទេ');
        break;

      case 'add_alert':
        const alertModal = document.getElementById('modal-alert');
        const alertInput = document.getElementById('alert-price-input');
        if (alertInput) alertInput.value = parseFloat(pVal).toFixed(digits);
        if (alertModal) alertModal.classList.add('active');
        break;

      case 'sell_limit':
        PaperTrading.placeOrder(sym, 'sell', 1);
        playTradeSound();
        showToast(`Sell 1 ${sym.name} @ ${pStr} limit order placed!`);
        break;

      case 'buy_stop':
        PaperTrading.placeOrder(sym, 'buy', 1);
        playTradeSound();
        showToast(`Buy 1 ${sym.name} @ ${pStr} stop order placed!`);
        break;

      case 'add_order':
        const qtyEl = document.getElementById('quick-trade-qty');
        if (qtyEl) qtyEl.value = '1.00';
        showToast(`Order configured on ${sym.name} @ ${pStr}`);
        break;

      case 'move_chart':
        showToast('Pan chart by dragging with cursor / អូសតារាងដោយសេរី');
        break;

      case 'lock_cursor':
        showToast('Vertical cursor line by time locked / ចាក់សោបន្ទាត់បញ្ឈរ');
        break;

      case 'table_view':
        const scrTab = document.querySelector('[data-tab="screener"]');
        if (scrTab) scrTab.click();
        showToast('Table view (Screener) / បើកតារាងតាមដានផ្សារ');
        break;

      case 'object_tree':
        const dCount = (window.DrawingEngine && window.DrawingEngine.getDrawingsCount) ? window.DrawingEngine.getDrawingsCount() : 0;
        showToast(`Object Tree: ${dCount} Drawings, Indicators active`);
        break;

      case 'chart_template':
        showToast('Chart Template: TradingView Dark (Applied)');
        break;

      case 'apply_indicators':
        showToast('Active indicators applied to layout');
        break;

      case 'delete_selected_drawing':
        if (window.DrawingEngine && window.DrawingEngine.deleteSelectedDrawing) {
          window.DrawingEngine.deleteSelectedDrawing();
        }
        break;

      case 'remove_drawings':
        const count = (window.DrawingEngine && window.DrawingEngine.getDrawingsCount) ? window.DrawingEngine.getDrawingsCount() : 0;
        if (window.DrawingEngine && window.DrawingEngine.clearAllDrawings) {
          window.DrawingEngine.clearAllDrawings();
        }
        break;

      case 'remove_indicators':
        // Disable all indicators
        indConfig.ema = false;
        indConfig.ema20 = false;
        indConfig.ema50 = false;
        indConfig.bb = false;
        indConfig.volume = false;
        indConfig.ob = false;
        indConfig.fvg = false;
        indConfig.liquidity = false;
        indConfig.bos = false;
        indConfig.rsi = false;
        indConfig.priceLines = false;
        clearPriceScaleLines();

        // Uncheck modal toggles
        ['ob', 'fvg', 'liquidity', 'bos', 'ema', 'bb', 'volume', 'rsi'].forEach(k => {
          const cb = document.getElementById(`toggle-ind-${k}`);
          if (cb) cb.checked = false;
        });

        // Hide legend rows
        document.querySelectorAll('.tv-legend-ind-row').forEach(row => {
          row.style.display = 'none';
        });

        updateChartData(currentCandles);
        const indBadge = document.getElementById('badge-active-indicators');
        if (indBadge) {
          indBadge.textContent = '0';
          indBadge.style.display = 'none';
        }
        showToast('Removed all indicators from chart / បានលុបសូចនាករទាំងអស់');
        break;

      case 'settings':
        openChartSettingsModal();
        break;
    }
  }

  function renderScreenerTable() {
    const tbody = document.getElementById('screener-table-body');
    if (!tbody) return;
    const symbols = DataFeed.getSymbols();
    let html = '';

    symbols.forEach(s => {
      const stats = DataFeed.getStats(s.id);
      const pct = stats ? stats.changePercent.toFixed(2) : '1.20';
      const isPos = pct >= 0;
      const rsi = Math.round(45 + Math.random() * 25);
      const trend = isPos ? (window.I18N ? window.I18N.t('trend_bullish') : 'Bullish') : (window.I18N ? window.I18N.t('trend_bearish') : 'Bearish');

      html += `
        <tr style="cursor: pointer;" onclick="window.switchSymbol('${s.id}')">
          <td style="font-weight: 700;">${s.icon} ${s.name}</td>
          <td>${s.category.toUpperCase()}</td>
          <td>${stats ? stats.price.toFixed(s.digits) : s.basePrice}</td>
          <td style="color: ${isPos ? 'var(--tv-green)' : 'var(--tv-red)'}; font-weight: 700;">${isPos ? '+' : ''}${pct}%</td>
          <td>${stats ? stats.high.toFixed(s.digits) : '-'}</td>
          <td>${stats ? stats.low.toFixed(s.digits) : '-'}</td>
          <td>${rsi}</td>
          <td><span class="badge-pos ${isPos ? 'buy' : 'sell'}">${trend}</span></td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  /**
   * Sound & Toast notifications
   */
  let audioCtx = null;
  function setupAudioAlerts() {
    window.addEventListener('click', () => {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
    }, { once: true });
  }

  function playTradeSound() {
    if (!audioCtx) return;
    const soundEnabled = document.getElementById('cs-tr-sound')?.checked ?? true;
    if (!soundEnabled) return;

    const vol = (parseFloat(document.getElementById('cs-tr-sound-vol')?.value) || 80) / 100 * 0.2;
    const soundType = document.getElementById('cs-tr-sound-type')?.value || 'alarm_clock';

    try {
      const now = audioCtx.currentTime;
      if (soundType === 'bell') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.36);
      } else if (soundType === 'chime') {
        [523.25, 659.25, 783.99].forEach((freq, idx) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.06);
          gain.gain.setValueAtTime(vol * 0.8, now + idx * 0.06);
          gain.gain.linearRampToValueAtTime(0.01, now + idx * 0.06 + 0.15);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now + idx * 0.06);
          osc.stop(now + idx * 0.06 + 0.16);
        });
      } else if (soundType === 'pop') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.07);
        gain.gain.setValueAtTime(vol * 1.2, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.07);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
      } else {
        // alarm_clock: double electronic beep
        [0, 0.09].forEach(delay => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(1046.5, now + delay);
          gain.gain.setValueAtTime(vol * 0.5, now + delay);
          gain.gain.linearRampToValueAtTime(0.01, now + delay + 0.06);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now + delay);
          osc.stop(now + delay + 0.07);
        });
      }
    } catch (e) {}
  }

  function triggerPriceAlert(price) {
    alertPrice = null; // Reset
    updateAlertPriceLine();

    const soundEnabled = document.getElementById('cs-alt-sound-cb')?.checked ?? true;
    if (audioCtx && soundEnabled) {
      try {
        const vol = (parseFloat(document.getElementById('cs-alt-volume')?.value) || 75) / 100 * 0.25;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.2);
        gain.gain.setValueAtTime(vol, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.36);
      } catch (e) {}
    }
    showToast(`🔔 Price Alert Triggered! Price reached ${price}`);
  }

  function showToast(msg, isForceAlert = false) {
    // Strictly disable all notification popups when user does anything (silent & clean like TradingView)
    // Only real-time price alert triggers (containing '🔔' or with isForceAlert flag) are allowed
    if (!isForceAlert && (!msg || !msg.includes('🔔'))) {
      return;
    }
    const autoHide = document.getElementById('cs-alt-auto-hide-toast')?.checked ?? true;
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = '#2a2e39';
    toast.style.border = '1px solid #2962ff';
    toast.style.color = '#ffffff';
    toast.style.padding = '10px 20px';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
    toast.style.zIndex = '9999';
    toast.style.fontWeight = '600';
    toast.style.fontSize = '13px';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '10px';

    const textSpan = document.createElement('span');
    textSpan.textContent = msg;
    toast.appendChild(textSpan);

    if (!autoHide) {
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '&times;';
      closeBtn.style.background = 'transparent';
      closeBtn.style.border = 'none';
      closeBtn.style.color = '#a3a6af';
      closeBtn.style.fontSize = '16px';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.marginLeft = '8px';
      closeBtn.onclick = () => toast.remove();
      toast.appendChild(closeBtn);
    }

    document.body.appendChild(toast);

    if (autoHide) {
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.4s';
        setTimeout(() => toast.remove(), 400);
      }, 2800);
    }
  }

  window.showToast = showToast;

})();

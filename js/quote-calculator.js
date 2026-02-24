/* Waterloo Roofing Co — Quote Calculator
   3-step flow with Mapbox satellite + auto roof detection */

(function () {
  'use strict';

  // ---- State ----
  var state = {
    step: 1,
    totalSteps: 3,       // 3 normally, 4 if fallback manual size
    useFallback: false,   // true if building footprint not found
    address: '',
    sqft: null,           // detected footprint area (sq ft)
    pitch: '0.75',        // default: Standard
    service: null,
    material: null,
    lat: null,
    lng: null,
    footprintDetected: false,
    buildingGeoJSON: null    // GeoJSON of the detected building polygon
  };

  // Step flow mapping: which DOM step-id to show for each logical step number
  // Normal:   1→step-1, 2→step-2, 3→step-3
  // Fallback: 1→step-1, 2→step-manual-size, 3→step-2, 4→step-3
  function getStepId(num) {
    if (!state.useFallback) {
      return 'step-' + num;
    }
    if (num === 1) return 'step-1';
    if (num === 2) return 'step-manual-size';
    if (num === 3) return 'step-2';
    if (num === 4) return 'step-3';
    return 'step-' + num;
  }

  // ---- Pricing Constants ----
  var MATERIAL_COSTS = { '4.50': 4.50, '9.00': 9.00, '12.00': 12.00 };
  var REPAIR_BASE = 850;
  var REPAIR_MAX = 4500;

  // ---- DOM References ----
  var calculator = document.getElementById('quote-calculator');
  if (!calculator) return;

  var progressFill = document.getElementById('progress-fill');
  var progressSteps = document.querySelectorAll('.quote-progress__step');

  // ---- Mapbox Map ----
  var map = null;
  var mapStaticClone = null;

  // ---- Utility: Show Step ----
  function showStep(num) {
    state.step = num;
    var targetId = getStepId(num);

    // Hide all steps
    calculator.querySelectorAll('.quote-step').forEach(function (el) {
      el.classList.remove('is-active');
    });
    // Show the target step
    var target = document.getElementById(targetId);
    if (target) target.classList.add('is-active');

    // Update progress bar
    var pct = (num / state.totalSteps) * 100;
    progressFill.style.width = pct + '%';

    // Update progress dots
    updateProgressDots();

    calculator.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // If final step, calculate results
    if (num === state.totalSteps) calculateResults();
  }

  function updateProgressDots() {
    // Rebuild progress dots for current totalSteps
    var container = document.querySelector('.quote-progress__steps');
    if (!container) return;
    container.innerHTML = '';
    for (var i = 1; i <= state.totalSteps; i++) {
      var span = document.createElement('span');
      span.className = 'quote-progress__step';
      span.dataset.step = i;
      span.textContent = i;
      if (i === state.step) span.classList.add('is-active');
      if (i < state.step) span.classList.add('is-complete');
      container.appendChild(span);
    }
    // Update aria
    var bar = document.querySelector('.quote-progress');
    if (bar) {
      bar.setAttribute('aria-valuemax', state.totalSteps);
      bar.setAttribute('aria-valuenow', state.step);
    }
  }

  // ---- Option Selection Handler ----
  function setupOptionGroup(containerId, stateKey) {
    var container = document.getElementById(containerId);
    if (!container) return;

    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.quote-option');
      if (!btn) return;

      container.querySelectorAll('.quote-option').forEach(function (b) {
        b.classList.remove('is-selected');
      });
      btn.classList.add('is-selected');
      state[stateKey] = btn.dataset.value;

      // Enable next button in this step
      var step = btn.closest('.quote-step');
      var nextBtn = step ? step.querySelector('.quote-next') : null;
      if (nextBtn) nextBtn.disabled = false;
    });
  }

  setupOptionGroup('pitch-options', 'pitch');
  setupOptionGroup('size-options', 'sqft');
  setupOptionGroup('service-options', 'service');
  setupOptionGroup('material-options', 'material');

  // ---- Step 2 (service & material) needs both selected ----
  var step2El = document.getElementById('step-2');
  if (step2El) {
    step2El.addEventListener('click', function () {
      var nextBtn = step2El.querySelector('.quote-next');
      if (nextBtn && state.service && state.material) {
        nextBtn.disabled = false;
      }
    });
  }

  // ---- Mapbox Geocoding Autocomplete ----
  var addressInput = document.getElementById('address');
  var geocodeResults = document.getElementById('geocode-results');
  var debounceTimer = null;

  if (addressInput) {
    addressInput.addEventListener('input', function () {
      var query = addressInput.value.trim();
      state.address = query;

      if (query.length < 4) {
        geocodeResults.style.display = 'none';
        return;
      }

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        fetchGeocode(query);
      }, 300);
    });

    // Close dropdown on outside click
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#address') && !e.target.closest('#geocode-results')) {
        geocodeResults.style.display = 'none';
      }
    });
  }

  function fetchGeocode(query) {
    if (typeof MAPBOX_TOKEN === 'undefined' || MAPBOX_TOKEN === 'YOUR_MAPBOX_TOKEN_HERE') {
      console.warn('Mapbox token not configured. Set MAPBOX_TOKEN in js/config.js');
      return;
    }

    var url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
      encodeURIComponent(query) +
      '.json?access_token=' + MAPBOX_TOKEN +
      '&country=us&types=address&limit=5' +
      '&proximity=-97.7431,30.2672'; // Bias toward Austin, TX

    fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.features || data.features.length === 0) {
          geocodeResults.style.display = 'none';
          return;
        }
        renderGeocodeSuggestions(data.features);
      })
      .catch(function () {
        geocodeResults.style.display = 'none';
      });
  }

  function renderGeocodeSuggestions(features) {
    geocodeResults.innerHTML = '';
    features.forEach(function (feat) {
      var item = document.createElement('div');
      item.className = 'geocode-dropdown__item';
      item.textContent = feat.place_name;
      item.addEventListener('click', function () {
        selectAddress(feat);
      });
      geocodeResults.appendChild(item);
    });
    geocodeResults.style.display = 'block';
  }

  function selectAddress(feature) {
    state.address = feature.place_name;
    state.lng = feature.center[0];
    state.lat = feature.center[1];
    addressInput.value = feature.place_name;
    geocodeResults.style.display = 'none';

    // Enable next button
    var nextBtn = document.querySelector('#step-1 .quote-next');
    if (nextBtn) nextBtn.disabled = false;

    // Show map + pitch
    initMap(state.lng, state.lat);
    document.getElementById('pitch-section').style.display = '';
  }

  // ---- Mapbox Map Initialization ----
  function initMap(lng, lat) {
    var mapWrap = document.getElementById('quote-map-wrap');
    mapWrap.style.display = '';

    if (map) {
      // Clear previous highlight
      state.buildingGeoJSON = null;
      var src = map.getSource('selected-building');
      if (src) src.setData({ type: 'FeatureCollection', features: [] });

      map.setCenter([lng, lat]);
      map.setZoom(19);
      map.once('idle', function () { detectFootprint(lng, lat); });
      return;
    }

    mapboxgl.accessToken = MAPBOX_TOKEN;
    map = new mapboxgl.Map({
      container: 'quote-map',
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [lng, lat],
      zoom: 19
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', function () {
      // Subtle outline on all buildings so tiles load the building layer
      map.addLayer({
        id: 'building-outline',
        type: 'line',
        source: 'composite',
        'source-layer': 'building',
        paint: {
          'line-color': '#ff0000',
          'line-width': 1,
          'line-opacity': 0.3
        }
      });

      // Source + layers for the selected building highlight
      map.addSource('selected-building', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'selected-building-fill',
        type: 'fill',
        source: 'selected-building',
        paint: {
          'fill-color': '#ff0000',
          'fill-opacity': 0.35
        }
      });
      map.addLayer({
        id: 'selected-building-outline',
        type: 'line',
        source: 'selected-building',
        paint: {
          'line-color': '#ff0000',
          'line-width': 3
        }
      });

      // Slight delay to let tiles load before querying
      setTimeout(function () { detectFootprint(lng, lat); }, 1500);
    });
  }

  // ---- Building Footprint Detection ----
  function detectFootprint(lng, lat) {
    var statusEl = document.getElementById('footprint-status');
    statusEl.innerHTML = '<span style="color: var(--color-text-muted);">Detecting building footprint...</span>';

    // Query building polygon at the geocoded point
    var point = map.project([lng, lat]);

    // Search a small area around the point (10px radius)
    var bbox = [
      [point.x - 10, point.y - 10],
      [point.x + 10, point.y + 10]
    ];

    var features = map.queryRenderedFeatures(bbox, { layers: ['building-outline'] });

    if (features.length > 0) {
      var polygon = features[0];
      var areaSqM = turf.area(polygon);
      var areaSqFt = Math.round(areaSqM * 10.764);

      state.sqft = areaSqFt;
      state.footprintDetected = true;
      state.useFallback = false;
      state.totalSteps = 3;

      // Store GeoJSON and highlight the selected building
      state.buildingGeoJSON = polygon.toJSON ? polygon.toJSON() : JSON.parse(JSON.stringify(polygon));
      highlightBuilding(map);

      statusEl.innerHTML = '<div style="background: var(--color-cream, #f5f0e8); border-radius: var(--radius-md, 8px); padding: var(--space-md, 12px) var(--space-lg, 16px); border-left: 4px solid var(--color-teal, #2a9d8f);">' +
        '<strong>Detected footprint: ~' + areaSqFt.toLocaleString() + ' sq ft</strong>' +
        '<br><small style="color: var(--color-text-muted, #666);">Measured from satellite building data. Select your roof pitch below, then continue.</small>' +
        '</div>';

      updateProgressDots();
    } else {
      // Fallback: no footprint found
      state.footprintDetected = false;
      state.useFallback = true;
      state.totalSteps = 4;

      statusEl.innerHTML = '<div style="background: #fff3cd; border-radius: var(--radius-md, 8px); padding: var(--space-md, 12px) var(--space-lg, 16px); border-left: 4px solid #ffc107;">' +
        '<strong>Could not auto-detect building footprint</strong>' +
        '<br><small>No building data found at this location. You\'ll select your home size in the next step.</small>' +
        '</div>';

      // Show the manual size step in the flow
      var manualStep = document.getElementById('step-manual-size');
      if (manualStep) manualStep.style.display = '';

      updateProgressDots();
    }
  }

  // ---- Highlight Selected Building ----
  function highlightBuilding(targetMap) {
    if (!state.buildingGeoJSON) return;
    var src = targetMap.getSource('selected-building');
    if (src) {
      src.setData({
        type: 'FeatureCollection',
        features: [state.buildingGeoJSON]
      });
    }
  }

  // ---- Navigation Buttons ----
  calculator.addEventListener('click', function (e) {
    var nextBtn = e.target.closest('.quote-next');
    if (nextBtn && !nextBtn.disabled) {
      var nextNum = parseInt(nextBtn.dataset.next);

      // In fallback mode, step-1 "Next" goes to logical step 2 (manual-size)
      // The data-next values are set to the normal flow's step numbers
      // We need to translate them to logical step numbers
      if (state.useFallback) {
        // Determine current logical step from current visible step
        var currentStepEl = nextBtn.closest('.quote-step');
        var currentId = currentStepEl ? currentStepEl.id : '';

        if (currentId === 'step-1') {
          showStep(2); // → manual-size
          return;
        }
        if (currentId === 'step-manual-size') {
          showStep(3); // → service & material (step-2 DOM)
          return;
        }
        if (currentId === 'step-2') {
          showStep(4); // → results (step-3 DOM)
          return;
        }
      }

      showStep(nextNum);
      return;
    }

    var prevBtn = e.target.closest('.quote-prev');
    if (prevBtn) {
      var prevNum = parseInt(prevBtn.dataset.prev);

      if (state.useFallback) {
        var currentStepEl2 = prevBtn.closest('.quote-step');
        var currentId2 = currentStepEl2 ? currentStepEl2.id : '';

        if (currentId2 === 'step-manual-size') {
          showStep(1);
          return;
        }
        if (currentId2 === 'step-2') {
          showStep(2); // → manual-size
          return;
        }
        if (currentId2 === 'step-3') {
          showStep(3); // → service & material
          return;
        }
      }

      showStep(prevNum);
    }
  });

  // ---- Pricing Calculation ----
  function calculateResults() {
    var resultLow = document.getElementById('result-low');
    var resultHigh = document.getElementById('result-high');
    var resultDetails = document.getElementById('result-details');

    var sqft = parseFloat(state.sqft) || 2000;
    var pitch = parseFloat(state.pitch) || 0.75;
    var service = state.service;
    var materialCost = MATERIAL_COSTS[state.material];

    var pitchLabels = { '0.55': 'Flat', '0.65': 'Low', '0.75': 'Standard', '0.90': 'Steep' };
    var pitchLabel = pitchLabels[state.pitch] || 'Standard';

    // Build satellite thumbnail on results page
    if (map && state.lat && state.lng) {
      var thumbWrap = document.getElementById('result-map-thumb');
      thumbWrap.style.display = '';
      var thumbContainer = document.getElementById('quote-map-static');

      if (!mapStaticClone) {
        mapStaticClone = new mapboxgl.Map({
          container: 'quote-map-static',
          style: 'mapbox://styles/mapbox/satellite-streets-v12',
          center: [state.lng, state.lat],
          zoom: 18,
          interactive: false,
          attributionControl: false
        });
        mapStaticClone.on('load', function () {
          // Add selected building highlight source + layers
          mapStaticClone.addSource('selected-building', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
          });
          mapStaticClone.addLayer({
            id: 'selected-building-fill-thumb',
            type: 'fill',
            source: 'selected-building',
            paint: { 'fill-color': '#ff0000', 'fill-opacity': 0.35 }
          });
          mapStaticClone.addLayer({
            id: 'selected-building-outline-thumb',
            type: 'line',
            source: 'selected-building',
            paint: { 'line-color': '#ff0000', 'line-width': 2 }
          });
          highlightBuilding(mapStaticClone);
        });
      } else {
        mapStaticClone.setCenter([state.lng, state.lat]);
        highlightBuilding(mapStaticClone);
      }
    }

    if (service === 'inspection') {
      resultLow.textContent = 'FREE';
      resultHigh.textContent = '';
      document.querySelector('.quote-result__separator').style.display = 'none';
      resultDetails.innerHTML = '<p>Waterloo Roofing Co offers <strong>free 21-point roof inspections</strong> for Austin homeowners. Our team will assess your roof\'s condition and provide a detailed written report.</p>';
      return;
    }

    document.querySelector('.quote-result__separator').style.display = '';

    if (service === 'repair') {
      var repairLow = REPAIR_BASE;
      var repairHigh = Math.min(REPAIR_MAX, REPAIR_BASE + sqft * 1.2);
      resultLow.textContent = formatCurrency(repairLow);
      resultHigh.textContent = formatCurrency(repairHigh);
      resultDetails.innerHTML = '<p>Repair costs vary based on damage type and extent. This range covers common repairs like leak fixes, shingle replacement, and flashing repair.</p>';
      return;
    }

    // For replacement: footprint area × pitch multiplier
    var roofArea = sqft * pitch;
    var sourceLabel = state.footprintDetected ? ' <span class="solar-badge">Satellite Detected</span>' : '';

    if (!materialCost) {
      var lowCost = roofArea * 4.50 * 0.85;
      var highCost = roofArea * 12.00 * 1.15;
      resultLow.textContent = formatCurrency(lowCost);
      resultHigh.textContent = formatCurrency(highCost);
      resultDetails.innerHTML = '<p><strong>~' + sqft.toLocaleString() + ' sq ft footprint</strong> &middot; ' + pitchLabel + ' pitch' + sourceLabel + '</p>' +
        '<p>Roof area: ~' + Math.round(roofArea).toLocaleString() + ' sq ft</p>' +
        '<p>Range includes asphalt shingles through premium tile. We\'ll help you choose the best material during your free inspection.</p>';
      return;
    }

    var baseCost = roofArea * materialCost;
    var low = baseCost * 0.85;
    var high = baseCost * 1.15;

    var materialLabels = { '4.50': 'Asphalt Shingles', '9.00': 'Metal Roofing', '12.00': 'Tile Roofing' };
    var materialLabel = materialLabels[state.material] || '';

    resultLow.textContent = formatCurrency(low);
    resultHigh.textContent = formatCurrency(high);
    resultDetails.innerHTML = '<p><strong>~' + sqft.toLocaleString() + ' sq ft footprint</strong> &middot; ' + pitchLabel + ' pitch &middot; ' + materialLabel + sourceLabel + '</p>' +
      '<p>Roof area: ~' + Math.round(roofArea).toLocaleString() + ' sq ft &middot; Material: $' + materialCost.toFixed(2) + '/sq ft</p>';
  }

  function formatCurrency(num) {
    return '$' + Math.round(num).toLocaleString();
  }

  // ---- Lead Capture ----
  var submitBtn = document.getElementById('submit-lead');
  if (submitBtn) {
    submitBtn.addEventListener('click', function () {
      var name = document.getElementById('lead-name').value.trim();
      var phone = document.getElementById('lead-phone').value.trim();
      var email = document.getElementById('lead-email').value.trim();

      if (!name || !phone || !email) {
        alert('Please fill in all fields to schedule your free inspection.');
        return;
      }

      var leadForm = document.querySelector('.quote-lead');
      leadForm.innerHTML = '<div class="quote-lead__success">' +
        '<svg viewBox="0 0 24 24" width="48" height="48" fill="var(--color-teal)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>' +
        '<h3>Thank You, ' + name.split(' ')[0] + '!</h3>' +
        '<p>We\'ve received your request. A Waterloo team member will contact you within 2 hours to schedule your free inspection.</p>' +
        '<p><strong>Address:</strong> ' + state.address + '</p>' +
        '</div>';
    });
  }

  // Init: show step 1
  showStep(1);

})();

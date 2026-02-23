/* Creekstone Roof Co — Quote Calculator
   Multi-step form with pricing engine */

(function () {
  'use strict';

  // ---- State ----
  var state = {
    step: 1,
    address: '',
    sqft: null,
    pitch: 0.75,   // default: Standard
    stories: 1,    // default: 1
    service: null,
    material: null,
    solarData: null,    // Google Solar API data
    roofAreaSqFt: null, // actual roof area from Solar API
    lat: null,
    lng: null
  };

  // ---- Pricing Constants ----
  var PITCH_MULTIPLIERS = { '0.55': 0.55, '0.65': 0.65, '0.75': 0.75, '0.90': 0.90 };
  var MATERIAL_COSTS = { '4.50': 4.50, '9.00': 9.00, '12.00': 12.00 };
  var REPAIR_BASE = 850;
  var REPAIR_MAX = 4500;
  var INSPECTION_COST = 0; // free

  // ---- DOM References ----
  var calculator = document.getElementById('quote-calculator');
  if (!calculator) return;

  var progressFill = document.getElementById('progress-fill');
  var progressSteps = document.querySelectorAll('.quote-progress__step');
  var steps = calculator.querySelectorAll('.quote-step');

  // ---- Utility: Show Step ----
  function showStep(num) {
    state.step = num;

    steps.forEach(function (el) {
      el.classList.toggle('is-active', parseInt(el.dataset.step) === num);
    });

    // Update progress bar
    var pct = (num / 5) * 100;
    progressFill.style.width = pct + '%';

    progressSteps.forEach(function (el) {
      var s = parseInt(el.dataset.step);
      el.classList.toggle('is-active', s === num);
      el.classList.toggle('is-complete', s < num);
    });

    // Scroll to top of calculator
    calculator.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // If step 5, calculate results
    if (num === 5) calculateResults();
  }

  // ---- Option Selection Handler ----
  function setupOptionGroup(containerId, stateKey, autoAdvance) {
    var container = document.getElementById(containerId);
    if (!container) return;

    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.quote-option');
      if (!btn) return;

      // Deselect siblings
      container.querySelectorAll('.quote-option').forEach(function (b) {
        b.classList.remove('is-selected');
      });
      btn.classList.add('is-selected');

      state[stateKey] = btn.dataset.value;

      // Enable next button in this step
      var step = btn.closest('.quote-step');
      var nextBtn = step.querySelector('.quote-next');
      if (nextBtn) nextBtn.disabled = false;
    });
  }

  setupOptionGroup('size-options', 'sqft');
  setupOptionGroup('pitch-options', 'pitch');
  setupOptionGroup('stories-options', 'stories');
  setupOptionGroup('service-options', 'service');
  setupOptionGroup('material-options', 'material');

  // ---- Step 4 needs both service AND material selected ----
  var step4 = document.getElementById('step-4');
  if (step4) {
    step4.addEventListener('click', function () {
      var nextBtn = step4.querySelector('.quote-next');
      if (nextBtn && state.service && state.material) {
        nextBtn.disabled = false;
      }
    });
  }

  // ---- Address Input (Step 1) ----
  var addressInput = document.getElementById('address');
  if (addressInput) {
    addressInput.addEventListener('input', function () {
      state.address = addressInput.value.trim();
      var nextBtn = document.querySelector('#step-1 .quote-next');
      if (nextBtn) nextBtn.disabled = state.address.length < 5;
    });
  }

  // ---- Google Places Autocomplete ----
  window.initAutocomplete = function () {
    if (!addressInput || typeof google === 'undefined') return;
    var autocomplete = new google.maps.places.Autocomplete(addressInput, {
      types: ['address'],
      componentRestrictions: { country: 'us' }
    });
    autocomplete.addListener('place_changed', function () {
      var place = autocomplete.getPlace();
      if (place && place.formatted_address) {
        state.address = place.formatted_address;
        addressInput.value = place.formatted_address;
        var nextBtn = document.querySelector('#step-1 .quote-next');
        if (nextBtn) nextBtn.disabled = false;

        // Capture lat/lng for Solar API
        if (place.geometry && place.geometry.location) {
          state.lat = place.geometry.location.lat();
          state.lng = place.geometry.location.lng();
          fetchSolarData(state.lat, state.lng);
        }
      }
    });
  };

  // ---- Google Solar API ----
  function fetchSolarData(lat, lng) {
    // Extract API key from the Google Maps script tag
    var mapsScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (!mapsScript) return;
    var keyMatch = mapsScript.src.match(/key=([^&]+)/);
    if (!keyMatch || keyMatch[1] === 'YOUR_API_KEY') return;
    var apiKey = keyMatch[1];

    var url = 'https://solar.googleapis.com/v1/buildingInsights:findClosest' +
      '?location.latitude=' + lat +
      '&location.longitude=' + lng +
      '&requiredQuality=HIGH' +
      '&key=' + apiKey;

    // Show loading indicator on step 1
    showSolarStatus('loading');

    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('Solar API error: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data && data.solarPotential && data.solarPotential.roofSegmentStats) {
          processSolarData(data);
        } else {
          showSolarStatus('none');
        }
      })
      .catch(function () {
        showSolarStatus('none');
      });
  }

  function processSolarData(data) {
    var segments = data.solarPotential.roofSegmentStats;

    // Sum total roof area (sq meters → sq ft)
    var totalAreaM2 = 0;
    var weightedPitch = 0;
    segments.forEach(function (seg) {
      totalAreaM2 += seg.areaMeters2;
      weightedPitch += seg.pitchDegrees * seg.areaMeters2;
    });
    var avgPitchDeg = weightedPitch / totalAreaM2;
    var totalAreaSqFt = Math.round(totalAreaM2 * 10.7639);

    // Store solar data
    state.solarData = data;
    state.roofAreaSqFt = totalAreaSqFt;

    // Map pitch degrees to our multiplier categories
    // Flat: 0-10°, Low: 10-20°, Standard: 20-35°, Steep: 35°+
    var pitchValue;
    if (avgPitchDeg < 10) pitchValue = '0.55';
    else if (avgPitchDeg < 20) pitchValue = '0.65';
    else if (avgPitchDeg < 35) pitchValue = '0.75';
    else pitchValue = '0.90';

    // Estimate home sqft from roof area (reverse of pitch multiplier)
    var pitchMult = parseFloat(pitchValue);
    var estHomeSqFt = Math.round(totalAreaSqFt / pitchMult);

    // Find closest sqft option
    var sqftOptions = [800, 1250, 1750, 2250, 2750, 3500];
    var closestSqft = sqftOptions[0];
    var minDiff = Math.abs(estHomeSqFt - sqftOptions[0]);
    sqftOptions.forEach(function (opt) {
      var diff = Math.abs(estHomeSqFt - opt);
      if (diff < minDiff) { minDiff = diff; closestSqft = opt; }
    });

    // Pre-select size option in step 2
    var sizeContainer = document.getElementById('size-options');
    if (sizeContainer) {
      sizeContainer.querySelectorAll('.quote-option').forEach(function (btn) {
        btn.classList.remove('is-selected');
        if (btn.dataset.value === String(closestSqft)) {
          btn.classList.add('is-selected');
        }
      });
      state.sqft = String(closestSqft);
      var nextBtn = document.querySelector('#step-2 .quote-next');
      if (nextBtn) nextBtn.disabled = false;
    }

    // Pre-select pitch option in step 3
    var pitchContainer = document.getElementById('pitch-options');
    if (pitchContainer) {
      pitchContainer.querySelectorAll('.quote-option').forEach(function (btn) {
        btn.classList.remove('is-selected');
        if (btn.dataset.value === pitchValue) {
          btn.classList.add('is-selected');
        }
      });
      state.pitch = pitchValue;
    }

    showSolarStatus('success', totalAreaSqFt, Math.round(avgPitchDeg));
  }

  function showSolarStatus(status, roofSqFt, pitchDeg) {
    var existing = document.getElementById('solar-status');
    if (existing) existing.remove();

    if (status === 'none') return;

    var el = document.createElement('div');
    el.id = 'solar-status';
    el.className = 'solar-status solar-status--' + status;

    if (status === 'loading') {
      el.innerHTML = '<span class="solar-status__icon">&#128752;</span> Analyzing roof from satellite imagery…';
    } else if (status === 'success') {
      el.innerHTML = '<span class="solar-status__icon">&#9989;</span> Satellite data detected: <strong>~' +
        roofSqFt.toLocaleString() + ' sq ft</strong> roof area &middot; <strong>' + pitchDeg + '°</strong> avg pitch' +
        '<br><small>Size &amp; pitch have been auto-filled. You can still adjust manually.</small>';
    }

    var step1Body = document.querySelector('#step-1 .quote-step__body');
    if (step1Body) step1Body.appendChild(el);
  }

  // ---- Navigation Buttons ----
  calculator.addEventListener('click', function (e) {
    var nextBtn = e.target.closest('.quote-next');
    if (nextBtn && !nextBtn.disabled) {
      showStep(parseInt(nextBtn.dataset.next));
      return;
    }
    var prevBtn = e.target.closest('.quote-prev');
    if (prevBtn) {
      showStep(parseInt(prevBtn.dataset.prev));
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

    // Pitch label
    var pitchLabels = { '0.55': 'Flat', '0.65': 'Low', '0.75': 'Standard', '0.90': 'Steep' };
    var pitchLabel = pitchLabels[state.pitch] || 'Standard';

    if (service === 'inspection') {
      resultLow.textContent = 'FREE';
      resultHigh.textContent = '';
      document.querySelector('.quote-result__separator').style.display = 'none';
      resultDetails.innerHTML = '<p>Creekstone Roof Co offers <strong>free 21-point roof inspections</strong> for Austin homeowners. Our team will assess your roof\'s condition and provide a detailed written report.</p>';
      return;
    }

    document.querySelector('.quote-result__separator').style.display = '';

    if (service === 'repair') {
      // Repairs: flat range based on home size
      var repairLow = REPAIR_BASE;
      var repairHigh = Math.min(REPAIR_MAX, REPAIR_BASE + sqft * 1.2);
      resultLow.textContent = formatCurrency(repairLow);
      resultHigh.textContent = formatCurrency(repairHigh);
      resultDetails.innerHTML = '<p>Repair costs vary based on damage type and extent. This range covers common repairs like leak fixes, shingle replacement, and flashing repair.</p>';
      return;
    }

    // Use actual roof area from Solar API if available, otherwise estimate from sqft × pitch
    var useSolar = state.roofAreaSqFt && state.solarData;
    var roofArea = useSolar ? state.roofAreaSqFt : sqft * pitch;
    var sourceLabel = useSolar ? ' <span class="solar-badge">Satellite Data</span>' : '';

    // Replacement calculation
    if (!materialCost) {
      // "Not sure" — show range across all materials
      var lowCost = roofArea * 4.50 * 0.85;
      var highCost = roofArea * 12.00 * 1.15;
      resultLow.textContent = formatCurrency(lowCost);
      resultHigh.textContent = formatCurrency(highCost);
      resultDetails.innerHTML = '<p><strong>' + sqft.toLocaleString() + ' sq ft home</strong> &middot; ' + pitchLabel + ' pitch' + sourceLabel + '</p>' +
        '<p>Roof area: ~' + Math.round(roofArea).toLocaleString() + ' sq ft</p>' +
        '<p>Range includes asphalt shingles through premium tile. We\'ll help you choose the best material for your budget and needs during your free inspection.</p>';
      return;
    }

    var baseCost = roofArea * materialCost;
    var low = baseCost * 0.85;
    var high = baseCost * 1.15;

    // Material label
    var materialLabels = { '4.50': 'Asphalt Shingles', '9.00': 'Metal Roofing', '12.00': 'Tile Roofing' };
    var materialLabel = materialLabels[state.material] || '';

    resultLow.textContent = formatCurrency(low);
    resultHigh.textContent = formatCurrency(high);
    resultDetails.innerHTML = '<p><strong>' + sqft.toLocaleString() + ' sq ft home</strong> &middot; ' + pitchLabel + ' pitch &middot; ' + materialLabel + sourceLabel + '</p>' +
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

      // In production, this would POST to a backend/CRM
      // For now, show confirmation
      var leadForm = document.querySelector('.quote-lead');
      leadForm.innerHTML = '<div class="quote-lead__success">' +
        '<svg viewBox="0 0 24 24" width="48" height="48" fill="var(--color-teal)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>' +
        '<h3>Thank You, ' + name.split(' ')[0] + '!</h3>' +
        '<p>We\'ve received your request. A Creekstone team member will contact you within 2 hours to schedule your free inspection.</p>' +
        '<p><strong>Address:</strong> ' + state.address + '</p>' +
        '</div>';
    });
  }

  // ---- Set defaults: pitch=Standard, stories=1 are pre-selected in HTML ----
  state.pitch = '0.75';
  state.stories = '1';

})();

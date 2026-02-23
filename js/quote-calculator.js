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
    material: null
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
      }
    });
  };

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

    // Replacement calculation
    if (!materialCost) {
      // "Not sure" — show range across all materials
      var roofArea = sqft * pitch;
      var lowCost = roofArea * 4.50 * 0.85;
      var highCost = roofArea * 12.00 * 1.15;
      resultLow.textContent = formatCurrency(lowCost);
      resultHigh.textContent = formatCurrency(highCost);
      resultDetails.innerHTML = '<p><strong>' + sqft.toLocaleString() + ' sq ft home</strong> &middot; ' + pitchLabel + ' pitch</p>' +
        '<p>Range includes asphalt shingles through premium tile. We\'ll help you choose the best material for your budget and needs during your free inspection.</p>';
      return;
    }

    var roofArea = sqft * pitch;
    var baseCost = roofArea * materialCost;
    var low = baseCost * 0.85;
    var high = baseCost * 1.15;

    // Material label
    var materialLabels = { '4.50': 'Asphalt Shingles', '9.00': 'Metal Roofing', '12.00': 'Tile Roofing' };
    var materialLabel = materialLabels[state.material] || '';

    resultLow.textContent = formatCurrency(low);
    resultHigh.textContent = formatCurrency(high);
    resultDetails.innerHTML = '<p><strong>' + sqft.toLocaleString() + ' sq ft home</strong> &middot; ' + pitchLabel + ' pitch &middot; ' + materialLabel + '</p>' +
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

// ===========================
// Currency Data & Mapping
// ===========================

// Comprehensive mapping of currency codes to flags and names
const currencies = {
    "USD": { "name": "US Dollar", "flag": "🇺🇸" },
    "EUR": { "name": "Euro", "flag": "🇪🇺" },
    "GBP": { "name": "British Pound", "flag": "🇬🇧" },
    "JPY": { "name": "Japanese Yen", "flag": "🇯🇵" },
    "AUD": { "name": "Australian Dollar", "flag": "🇦🇺" },
    "CAD": { "name": "Canadian Dollar", "flag": "🇨🇦" },
    "CHF": { "name": "Swiss Franc", "flag": "🇨🇭" },
    "CNY": { "name": "Chinese Yuan", "flag": "🇨🇳" },
    "SEK": { "name": "Swedish Krona", "flag": "🇸🇪" },
    "NZD": { "name": "New Zealand Dollar", "flag": "🇳🇿" },
    "INR": { "name": "Indian Rupee", "flag": "🇮🇳" },
    "BRL": { "name": "Brazilian Real", "flag": "🇧🇷" },
    "ZAR": { "name": "South African Rand", "flag": "🇿🇦" },
    "RUB": { "name": "Russian Ruble", "flag": "🇷🇺" },
    "AED": { "name": "UAE Dirham", "flag": "🇦🇪" },
    "SGD": { "name": "Singapore Dollar", "flag": "🇸🇬" },
    "HKD": { "name": "Hong Kong Dollar", "flag": "🇭🇰" },
    "MXN": { "name": "Mexican Peso", "flag": "🇲🇽" },
    "KRW": { "name": "South Korean Won", "flag": "🇰🇷" },
    "TRY": { "name": "Turkish Lira", "flag": "🇹🇷" }
};

const popularPairs = [
    { from: "USD", to: "EUR" },
    { from: "GBP", to: "USD" },
    { from: "USD", to: "JPY" },
    { from: "EUR", to: "GBP" },
    { from: "USD", to: "CAD" },
    { from: "AUD", to: "USD" },
    { from: "USD", to: "CHF" },
    { from: "USD", to: "INR" }
];

// API endpoint configuration
const API_URL = "https://open.er-api.com/v6/latest/";

// ===========================
// DOM Elements
// ===========================
const fromSelect = document.getElementById('fromCurrency');
const toSelect = document.getElementById('toCurrency');
const fromFlag = document.getElementById('fromFlag');
const toFlag = document.getElementById('toFlag');
const fromAmount = document.getElementById('fromAmount');
const toAmount = document.getElementById('toAmount');
const swapBtn = document.getElementById('swapBtn');
const convertBtn = document.getElementById('convertBtn');
const resultPanel = document.getElementById('resultPanel');
const rateValue = document.getElementById('rateValue');
const inverseRate = document.getElementById('inverseRate');
const lastUpdated = document.getElementById('lastUpdated');
const ratesGrid = document.getElementById('ratesGrid');
const statusDot = document.getElementById('statusDot');

let exchangeRates = null;
let lastFetchTime = null;

// ===========================
// Initialization
// ===========================

function init() {
    populateSelects();
    createParticles();
    fetchRates('USD').then(() => {
        renderPopularRates();
    });

    // Set defaults
    fromSelect.value = "USD";
    toSelect.value = "EUR";
    updateFlag(fromSelect, fromFlag);
    updateFlag(toSelect, toFlag);

    // Event Listeners
    fromSelect.addEventListener('change', () => { handleSelectChange(fromSelect, fromFlag); handleConvert(); });
    toSelect.addEventListener('change', () => { handleSelectChange(toSelect, toFlag); handleConvert(); });
    fromAmount.addEventListener('input', handleConvert);
    swapBtn.addEventListener('click', handleSwap);
    convertBtn.addEventListener('click', handleConvertButton);
}

// ===========================
// Core Logic
// ===========================

// Populate dropdowns with currencies
function populateSelects() {
    const optionsHtml = Object.entries(currencies).map(([code, data]) => {
        return `<option value="${code}">${code} - ${data.name}</option>`;
    }).join('');

    fromSelect.innerHTML = optionsHtml;
    toSelect.innerHTML = optionsHtml;
}

// Update the flag icon next to the select
function updateFlag(selectElement, flagElement) {
    const code = selectElement.value;
    if (currencies[code] && currencies[code].flag) {
        flagElement.textContent = currencies[code].flag;
    } else {
        flagElement.textContent = "🏳️"; // Fallback flag
    }
}

// Handle select dropdown changes
function handleSelectChange(selectElement, flagElement) {
    updateFlag(selectElement, flagElement);
}

// Fetch exchange rates from the API
async function fetchRates(baseCurrency) {
    try {
        updateNetworkStatus('fetching');
        const response = await fetch(`${API_URL}${baseCurrency}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.result === "success") {
            exchangeRates = data.rates;
            lastFetchTime = new Date(data.time_last_update_utc);
            updateNetworkStatus('connected');
            return true;
        } else {
            throw new Error('API returned failure');
        }
    } catch (error) {
        console.error("Error fetching rates:", error);
        updateNetworkStatus('error');
        showToast("Failed to fetch live rates. Please try again later.", "error");
        return false;
    }
}

// Execute the conversion
async function handleConvert() {
    const amount = parseFloat(fromAmount.value);
    
    // Validation
    if (isNaN(amount) || amount < 0) {
        toAmount.value = "";
        resultPanel.classList.remove('visible');
        return;
    }

    const fromCode = fromSelect.value;
    const toCode = toSelect.value;
    
    // We always fetch against the fromCode as base base to ensure max accuracy
    // In a production app you might cache this to prevent over-fetching
    const success = await fetchRates(fromCode);
    
    if (success && exchangeRates && exchangeRates[toCode]) {
        const rate = exchangeRates[toCode];
        const result = amount * rate;
        
        // Format the output
        toAmount.value = result.toLocaleString('en-US', { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 4 
        });
        
        // Update details panel
        rateValue.textContent = `1 ${fromCode} = ${rate.toFixed(4)} ${toCode}`;
        
        const inverseRateVal = 1 / rate;
        inverseRate.textContent = `1 ${toCode} = ${inverseRateVal.toFixed(4)} ${fromCode}`;
        
        const formatter = new Intl.DateTimeFormat('en-US', {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        lastUpdated.innerHTML = `<span class="update-dot"></span>Last updated: ${formatter.format(lastFetchTime)}`;
        
        resultPanel.classList.add('visible');
    } else {
        toAmount.value = "Error";
    }
}

// Handle convert button click specifically (with loading animation)
async function handleConvertButton() {
    const amount = parseFloat(fromAmount.value);
    if (isNaN(amount) || amount <= 0) {
        showToast("Please enter a valid amount greater than 0.", "error");
        
        // Add a temporary shake animation class to input
        fromAmount.style.animation = "shake 0.4s cubic-bezier(.36,.07,.19,.97) both";
        setTimeout(() => { fromAmount.style.animation = ""; }, 400);
        return;
    }

    convertBtn.classList.add('loading');
    
    // Minimum visual delay so the user feels an action happened
    await new Promise(r => setTimeout(r, 600)); 
    
    await handleConvert();
    
    convertBtn.classList.remove('loading');
    
    // Success feedback
    if (toAmount.value && toAmount.value !== "Error") {
        showToast("Currency converted successfully!", "success");
    }
}

// Add shake keyframes dynamically if not present
if (!document.getElementById('keyframes-shake')) {
    const style = document.createElement('style');
    style.id = 'keyframes-shake';
    style.innerHTML = `
        @keyframes shake {
            10%, 90% { transform: translate3d(-1px, 0, 0); }
            20%, 80% { transform: translate3d(2px, 0, 0); }
            30%, 50%, 70% { transform: translate3d(-4px, 0, 0); }
            40%, 60% { transform: translate3d(4px, 0, 0); }
        }
    `;
    document.head.appendChild(style);
}


// Swap from and to currencies
function handleSwap() {
    // Add visual rotation
    swapBtn.classList.add('rotating');
    setTimeout(() => swapBtn.classList.remove('rotating'), 400);

    // Swap values
    const tempValue = fromSelect.value;
    fromSelect.value = toSelect.value;
    toSelect.value = tempValue;

    // Update UI flags
    updateFlag(fromSelect, fromFlag);
    updateFlag(toSelect, toFlag);

    // Re-calculate
    if (fromAmount.value) {
        handleConvert();
    }
}

// Render the grid of popular currency rates
async function renderPopularRates() {
    // Show skeletons first
    ratesGrid.innerHTML = Array(8).fill(0).map(() => `
        <div class="rate-card">
            <div class="rate-card-pair">
                <span class="rate-card-flags">🌐</span>
                <span class="rate-card-code">Loading...</span>
            </div>
            <div class="rate-card-skeleton"></div>
        </div>
    `).join('');

    // Fetch USD base rates if we don't have them
    if (!exchangeRates || fromSelect.value !== 'USD') {
        await fetchRates('USD');
    }

    if (!exchangeRates) {
        ratesGrid.innerHTML = '<p style="color: var(--text-muted); grid-column: 1/-1; text-align: center;">Unable to load popular rates.</p>';
        return;
    }

    // Render actual cards
    const cardsHtml = popularPairs.map(pair => {
        let rate;
        
        // Calculate the cross rate if needed, or use direct rate
        if (pair.from === 'USD') {
            rate = exchangeRates[pair.to];
        } else if (pair.to === 'USD') {
            rate = 1 / exchangeRates[pair.from];
        } else {
             rate = exchangeRates[pair.to] / exchangeRates[pair.from];
        }
        
        if (!rate) return '';

        const fromFlagIcon = currencies[pair.from]?.flag || '🏳️';
        const toFlagIcon = currencies[pair.to]?.flag || '🏳️';

        return `
            <div class="rate-card" onclick="setConversionPair('${pair.from}', '${pair.to}')">
                <div class="rate-card-pair">
                    <span class="rate-card-flags">${fromFlagIcon}${toFlagIcon}</span>
                    <span class="rate-card-code">${pair.from} / ${pair.to}</span>
                </div>
                <div class="rate-card-value">${rate.toFixed(4)}</div>
                <div class="rate-card-label">1 ${pair.from} equals ${pair.to}</div>
            </div>
        `;
    }).join('');

    ratesGrid.innerHTML = cardsHtml;
}

// Global function to set from/to from a popular card click
window.setConversionPair = function(fromCode, toCode) {
    fromSelect.value = fromCode;
    toSelect.value = toCode;
    updateFlag(fromSelect, fromFlag);
    updateFlag(toSelect, toFlag);
    
    // Scroll smoothly to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // Run convert 
    fromAmount.value = "1";
    handleConvert();
};


// ===========================
// UI Helpers
// ===========================

// Update the network status indicator
function updateNetworkStatus(status) {
    let color, text;
    
    switch(status) {
        case 'connected':
            color = '#22c55e'; // green
            text = 'Live Rates Data';
            break;
        case 'fetching':
            color = '#f59e0b'; // amber
            text = 'Updating...';
            break;
        case 'error':
            color = '#ef4444'; // red
            text = 'Offline Mode';
            break;
    }
    
    statusDot.innerHTML = `
        <span class="pulse-dot" style="background: ${color}; box-shadow: 0 0 8px ${color}"></span>
        <style>.pulse-dot::after { border-color: ${color} }</style>
        ${text}
    `;
}

// Show standard toast notification
function showToast(message, type = "info") {
    // Remove existing toast if present
    const existing = document.querySelector('.toast');
    if (existing) {
        existing.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after delay
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400); // Wait for transition
    }, 3000);
}

// Create ambient background particles
function createParticles() {
    const container = document.getElementById('bgParticles');
    const particleCount = 20;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        
        // Randomize properties
        const size = Math.random() * 4 + 2; // 2px to 6px
        const left = Math.random() * 100; // 0% to 100%
        const animationDuration = Math.random() * 15 + 10; // 10s to 25s
        const animationDelay = Math.random() * 10; // 0s to 10s
        
        // Use theme accents (purple & cyan)
        const isPurple = Math.random() > 0.5;
        const color = isPurple ? 'rgba(124, 58, 237, 0.4)' : 'rgba(6, 182, 212, 0.4)';
        const blur = Math.random() * 2;

        particle.style.cssText = `
            width: ${size}px;
            height: ${size}px;
            left: ${left}%;
            background: ${color};
            box-shadow: 0 0 ${size * 2}px ${color};
            filter: blur(${blur}px);
            animation-duration: ${animationDuration}s;
            animation-delay: -${animationDelay}s;
        `;

        container.appendChild(particle);
    }
}

// ===========================
// Bootstrap
// ===========================
document.addEventListener('DOMContentLoaded', init);
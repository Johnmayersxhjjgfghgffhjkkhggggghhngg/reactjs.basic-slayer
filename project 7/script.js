// Factory function using Closure to manage API state
function createCurrencyAPI(baseUrl) {
    // Closure: these variables are kept private
    const cache = {}; // Simple cache to store fetched rates

    // Function returning a Promise with async/await
    return async function getExchangeRate(baseCurrency, targetCurrency) {
        
        // 1. Return a Promise
        return new Promise(async (resolve, reject) => {
            
            // Check cache first (Closure maintains this cache across calls)
            if (cache[baseCurrency]) {
                const rate = cache[baseCurrency][targetCurrency];
                if (rate) {
                    console.log(`Using cached rates for ${baseCurrency}`);
                    resolve(rate);
                    return;
                }
            }

            try {
                // 2. Use fetch API with async/await
                console.log(`Fetching new rates for ${baseCurrency}...`);
                const response = await fetch(`${baseUrl}${baseCurrency}`);
                
                if (!response.ok) {
                    throw new Error(`Failed to fetch data: ${response.statusText}`);
                }

                const data = await response.json();

                if (data.result === 'success') {
                    // Update cache
                    cache[baseCurrency] = data.rates;
                    
                    const rate = data.rates[targetCurrency];
                    if (rate) {
                        resolve(rate);
                    } else {
                        reject(new Error(`Currency ${targetCurrency} not found.`));
                    }
                } else {
                    reject(new Error('API returned an error.'));
                }

            } catch (error) {
                // Catch any network errors or thrown errors
                reject(error);
            }
        });
    };
}

// Initialize the API wrapper closure
const fetchRate = createCurrencyAPI('https://open.er-api.com/v6/latest/');

// DOM Elements
const amountInput = document.getElementById('amount');
const fromCurrencySelect = document.getElementById('fromCurrency');
const toCurrencySelect = document.getElementById('toCurrency');
const convertBtn = document.getElementById('convertBtn');
const convertedAmountDisplay = document.getElementById('convertedAmount');
const errorMsgDisplay = document.getElementById('errorMsg');

// Setup Event Listener
convertBtn.addEventListener('click', handleConversion);

// Async function to handle the conversion logic
async function handleConversion() {
    const amount = parseFloat(amountInput.value);
    const fromCurrency = fromCurrencySelect.value;
    const toCurrency = toCurrencySelect.value;

    // Reset error message
    errorMsgDisplay.textContent = '';
    
    if (isNaN(amount) || amount <= 0) {
        errorMsgDisplay.textContent = 'Please enter a valid amount.';
        convertedAmountDisplay.textContent = '0.00';
        return;
    }

    if (fromCurrency === toCurrency) {
        convertedAmountDisplay.textContent = `${amount.toFixed(2)} ${toCurrency}`;
        return;
    }

    // Indicate loading state
    convertBtn.textContent = 'Converting...';
    convertBtn.disabled = true;

    try {
        // Await the promise returned by our closure-based API function
        const rate = await fetchRate(fromCurrency, toCurrency);
        
        const finalAmount = amount * rate;
        convertedAmountDisplay.textContent = `${finalAmount.toFixed(2)} ${toCurrency}`;
        
    } catch (error) {
        console.error('Error during conversion:', error);
        errorMsgDisplay.textContent = 'Error fetching exchange rate. Please try again.';
        convertedAmountDisplay.textContent = '0.00';
    } finally {
        // Reset button state
        convertBtn.textContent = 'Convert';
        convertBtn.disabled = false;
    }
}

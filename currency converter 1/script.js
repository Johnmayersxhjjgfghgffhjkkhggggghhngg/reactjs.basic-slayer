document.getElementById("convertBtn").addEventListener("click", convertCurrency);


async function convertCurrency(){
    try{
        let amount = document.getElementById("amount").value;
        let fromCurrency = document.getElementById("fromCurrency").value;
        let toCurrency = document.getElementById("toCurrency").value;
        let response = await fetch(`https://api.exchangerate-api.com/v4/latest/${fromCurrency}`);
        let data = await response.json();
        let rate = data.rates[toCurrency];
        let result = amount * rate;
        document.getElementById("result").innerText = result;
    }
    catch(error){
        console.log(error);
    }
}
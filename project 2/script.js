function calcGST(price) {
    return price * 0.18
}

document.getElementById("btn").addEventListener("click", () =>{
    let price = document.getElementById("price").value;
    let gst = calcGST(price);
    document.getElementById("result").innerText = "Total Price: " + (Number(price) + Number(gst))
})
function calculate(price){
 return price * 0.18;
}  
document.getElementById("btn").addEventListener("click",fuction(){
    let price = document.getElementById("price").value;
    let gst = calculate(price);
    let result = document.getElementById("result").innerText = "Total Price: " +  (Number(price) + Number(gst));
});
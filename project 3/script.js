function createCounter(){
    let count = 0;
    return function(){
        count++;
        document.getElementById("count").innerText = count;
    }
}

let counter = createCounter();
document.getElementById("btn").addEventListener("click",counter);
document.getElementById("load-btn").addEventListener("click", function () {
    document.getElementById("status").innerText = "Loading...";
    let promise = new Promise((resolve, reject) => {
        if(Math.random() > 0.5){
            setTimeout(() => {
                resolve("Data loaded");
            }, 2000);
        }
        else{
            setTimeout(() => {
                reject("Data not loaded");
            }, 2000);
        }
    });
    promise.then((data) => { 
         document.getElementById("status").innerText = data;
    });
    promise.catch((error) => { 
         document.getElementById("status").innerText = error;
    });
    promise.finally(() => { 
         document.getElementById("status").innerText = "done...";
    });
});
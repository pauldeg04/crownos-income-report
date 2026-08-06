document.addEventListener("DOMContentLoaded", function(){
    const user =
        window.CrownAuth?.refreshCurrentUser?.();

    if(!user){
        location.href =
            "login.html";

        return;
    }

    if(
        !window.CrownAuth?.canAccessPage?.(
            "statistics.html",
            user
        )
    ){
        alert(
            "Your account does not have access to Statistics."
        );

        location.href =
            "home.html";
    }
});

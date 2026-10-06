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
            "receptionist-sales.html",
            user
        )
    ){
        alert(
            "Your account does not have access to Receptionist Sales."
        );

        location.href =
            "home.html";

        return;
    }

});

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
            "therapist-sales.html",
            user
        )
    ){
        alert(
            "Your account does not have access to Therapist Sales."
        );

        location.href =
            "home.html";

        return;
    }

    if(
        user.role === "Therapist" &&
        !user.therapistName
    ){
        alert(
            "Your account is not yet linked to a Therapist profile. Please contact your Admin."
        );

        location.href =
            "home.html";
    }
});

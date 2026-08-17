const Auth = {

    async start(){

        const token = localStorage.getItem("FamilyToken");

        if(token){

            API.token = token;

            try{

                const me = await API.request("/api/me");

                if(me.success){

                    window.currentUser = me.user;

                    showApp();

                    return;
                }

            }catch(e){

                console.log("Auto login failed");
            }
        }


        showLogin();

    },


    async login(){

        const loginInput =
            document.getElementById("login");

        const passwordInput =
            document.getElementById("password");


        const login =
            loginInput.value.trim();

        const password =
            passwordInput.value;


        const error =
            document.getElementById("loginError");


        error.innerHTML = "";


        try{

            const result =
                await API.login(
                    login,
                    password
                );


            if(result.success){

                localStorage.setItem(
                    "FamilyToken",
                    result.token
                );


                API.token =
                    result.token;


                window.currentUser =
                    result.user;


                showApp();

            }else{

                error.innerHTML =
                    result.error ||
                    "Ошибка входа";
            }


        }catch(e){

            console.error(e);

            error.innerHTML =
                "Неверный логин или пароль";
        }

    },


    logout(){

        localStorage.removeItem(
            "FamilyToken"
        );

        location.reload();

    }

};



function showLogin(){

    const login =
        document.getElementById(
            "loginScreen"
        );

    const app =
        document.getElementById(
            "mainScreen"
        );


    if(login)
        login.classList.add("active");


    if(app)
        app.classList.remove("active");

}



function showApp(){

    const login =
        document.getElementById(
            "loginScreen"
        );

    const app =
        document.getElementById(
            "mainScreen"
        );


    if(login)
        login.classList.remove("active");


    if(app)
        app.classList.add("active");


    if(window.Chat){

        Chat.start();

    }

}



document.addEventListener(
"DOMContentLoaded",
()=>{


    const btn =
        document.getElementById(
            "loginBtn"
        );


    if(btn){

        btn.onclick =
            ()=>Auth.login();

    }


    Auth.start();


});
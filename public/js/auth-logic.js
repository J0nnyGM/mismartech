// public/js/auth-logic.js
import { auth, db, provider, signInWithPopup, doc, getDoc, setDoc } from "./firebase-init.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const googleBtn = document.getElementById('btn-google');
const msgBox = document.getElementById('auth-message');
const forgotPasswordLink = document.getElementById('forgot-password');

function showMessage(msg, type = 'error') {
    if (!msgBox) return;
    msgBox.textContent = msg;
    msgBox.classList.remove('hidden', 'bg-red-500/20', 'text-red-400', 'bg-green-500/20', 'text-green-400', 'border-red-500/50', 'border-green-500/50');
    if (type === 'error') msgBox.classList.add('bg-red-500/20', 'text-red-400', 'border', 'border-red-500/50');
    else msgBox.classList.add('bg-green-500/20', 'text-green-400', 'border', 'border-green-500/50');
    msgBox.classList.remove('hidden');
}

// --- REDIRECCIÓN INTELIGENTE ---
async function smartRedirect(user) {
    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
            const role = userDoc.data().role;
            const staffRoles = ['admin', 'contabilidad', 'ventas', 'logistica'];
            
            if (staffRoles.includes(role)) {
                console.log(`Acceso Empleado (${role}).`);
                window.location.href = "/admin/index.html";
            } else {
                console.log("Acceso Cliente.");
                window.location.href = "/index.html";
            }
        } else {
            window.location.href = "/index.html";
        }
    } catch (error) {
        console.error("Error en el Smart Redirect:", error);
        window.location.href = "/index.html";
    }
}

// --- LÓGICA DE REGISTRO (Email/Password) ---
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('reg-name').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;

        try {
            // 1. Crear en Firebase Auth
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Guardar nombre en el perfil
            await updateProfile(user, { displayName: name });

            // 3. Crear documento de usuario en Firestore (Rol por defecto: customer)
            await setDoc(doc(db, "users", user.uid), {
                name: name,
                email: email,
                role: 'customer', 
                createdAt: new Date()
            });

            showMessage("¡Cuenta PixelTech creada! Redirigiendo...", "success");
            setTimeout(() => window.location.href = "/index.html", 1500);

        } catch (error) {
            console.error(error);
            if(error.code === 'auth/email-already-in-use') showMessage("Este correo ya está registrado.");
            else if(error.code === 'auth/weak-password') showMessage("La contraseña debe tener al menos 6 caracteres.");
            else showMessage("Error: " + error.message);
        }
    });
}

// --- LÓGICA DE LOGIN (Email/Password) ---
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            // Ejecutar redirección inteligente
            await smartRedirect(userCredential.user);
        } catch (error) {
            console.error(error);
            showMessage("Correo o contraseña incorrectos.");
        }
    });
}

// --- LÓGICA DE LOGIN CON GOOGLE ---
if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
        try {
            const result = await signInWithPopup(auth, provider);
            const user = result.user;

            // Guardar/Actualizar datos en Firestore (merge:true no borra el rol si ya existe)
            const userRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
                // Si es un usuario nuevo de Google, creamos su perfil como customer
                await setDoc(userRef, {
                    name: user.displayName,
                    email: user.email,
                    role: 'customer',
                    createdAt: new Date()
                });
            }

            // Ejecutar redirección inteligente
            await smartRedirect(user);

        } catch (error) {
            console.error(error);
            showMessage("Error al conectar con Google.");
        }
    });
}

// --- LÓGICA DE RESTABLECER CONTRASEÑA ---

if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value;

        if (!email) {
            showMessage("Por favor, escribe tu correo electrónico primero.");
            return;
        }

        try {
            await sendPasswordResetEmail(auth, email);
            showMessage("Correo de restablecimiento enviado. Revisa tu bandeja de entrada.", "success");
        } catch (error) {
            console.error(error);
            if (error.code === 'auth/user-not-found') {
                showMessage("No hay ningún usuario registrado con este correo.");
            } else {
                showMessage("Error: " + error.message);
            }
        }
    });
}
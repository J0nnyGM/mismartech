// public/js/firebase-init.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// LIBRERÍA DE FIRESTORE (Base de datos)
import { 
    getFirestore, collection, addDoc, getDocs, doc, Timestamp, getDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit, runTransaction, writeBatch, onSnapshot,limitToLast,  endAt, startAt, serverTimestamp, arrayUnion, startAfter,
    getCountFromServer, 
    getAggregateFromServer, 
    sum, count,endBefore,documentId
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// LIBRERÍA DE STORAGE (Imágenes)
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// --- NUEVO: LIBRERÍA DE FUNCTIONS (Para MercadoPago/Addi) ---
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// Configuración de tu proyecto
const firebaseConfig = {
apiKey: "AIzaSyAhDCTuplw5Lfswx6UQOBn0ze8ypL__KQs",
authDomain: "mismartech.firebaseapp.com",
projectId: "mismartech",
storageBucket: "mismartech.firebasestorage.app",
messagingSenderId: "822654656828",
appId: "1:822654656828:web:58a05207664f8ca12c3e39"
};

// Inicialización
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app); // <-- ¡NUEVO! Inicializamos Functions
export const provider = new GoogleAuthProvider();

// Exportar funciones para toda la app
export { 
    onAuthStateChanged, 
    signInWithPopup, 
    signOut,
    collection,
    addDoc, 
    getDocs, 
    doc, 
    limitToLast,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    query,      
    orderBy,    
    limit,   
    startAt,
    writeBatch,
    endAt,  
    where,      
    ref,
    uploadBytes,
    getDownloadURL,
    runTransaction,
    onSnapshot,
    serverTimestamp,
    arrayUnion,
    Timestamp,
    // --- NUEVO: Exportar para usar en checkout.js ---
    httpsCallable ,
    startAfter,
    // NUEVAS EXPORTACIONES:
    getCountFromServer,
    getAggregateFromServer,
    sum,
    count,
    endBefore,
    documentId                                                                                                 
};

// ==========================================
// 💥 KILL SWITCH: DESTRUCCIÓN TOTAL DE CACHÉ EN TIEMPO REAL
// ==========================================
export function initCacheKillSwitch(db) {
    if (!navigator.onLine) return; // Si no hay internet, no hacemos nada

    try {
        const configRef = doc(db, "config", "system");
        
        // Usamos onSnapshot para que sea EN TIEMPO REAL. 
        // Apenas cambies el número en Firebase, a todos los usuarios se les limpiará la app.
        onSnapshot(configRef, async (snap) => {
            if (snap.exists()) {
                const serverVersion = snap.data().cacheVersion || 1;
                const localVersionString = localStorage.getItem('pixeltech_cache_version');

                // 🔥 CASO 1: ES UN USUARIO NUEVO
                if (localVersionString === null) {
                    localStorage.setItem('pixeltech_cache_version', serverVersion.toString());
                    return; 
                }

                // 🔥 CASO 2: USUARIO RECURRENTE
                const localVersion = parseInt(localVersionString);
                
                // Si el servidor tiene una versión mayor, DETONAMOS LA BOMBA 💣
                if (serverVersion > localVersion) {
                    console.warn(`💥 KILL SWITCH ACTIVADO (v${serverVersion}). Borrando absolutamente todo...`);

                    // 1. DESTRUIR DATOS LOCALES (Limpieza absoluta)
                    // Nota: Firebase Auth usa IndexedDB, así que el usuario NO perderá su sesión, 
                    // pero sí borraremos tu historial, selecciones y caché de productos.
                    localStorage.clear(); 
                    sessionStorage.clear();

                    // 2. DESTRUIR LA BÓVEDA DEL SERVICE WORKER (Archivos físicos)
                    if ('caches' in window) {
                        const cacheNames = await caches.keys();
                        await Promise.all(cacheNames.map(name => caches.delete(name)));
                        console.log("🧹 Bóveda de archivos (Caches) eliminada.");
                    }

                    // 3. MATAR LOS SERVICE WORKERS ACTIVOS
                    if ('serviceWorker' in navigator) {
                        const registrations = await navigator.serviceWorker.getRegistrations();
                        for (let registration of registrations) {
                            await registration.unregister();
                        }
                        console.log("🔌 Service Worker desregistrado y eliminado.");
                    }

                    // 4. Registrar la nueva versión para evitar bucles infinitos
                    localStorage.setItem('pixeltech_cache_version', serverVersion.toString());

                    // 5. RECARGA NUCLEAR (Evita el caché HTTP del navegador)
                    // Cambiamos window.location.reload(true) por esto. Al agregar "?v=X", 
                    // el navegador cree que es una página distinta y descarga el HTML/JS obligatoriamente.
                    const newUrl = new URL(window.location.href);
                    newUrl.searchParams.set('v_cache', serverVersion);
                    window.location.replace(newUrl.toString()); 
                }
            }
        }, (error) => {
            console.warn("Kill Switch en pausa (Modo Offline o error de red).");
        });
    } catch (error) {
        console.error("Error iniciando Kill Switch:", error);
    }
}

// Ejecutamos silenciosamente en segundo plano una vez que la página termine de cargar
window.addEventListener('load', () => {
    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => initCacheKillSwitch(db));
    } else {
        setTimeout(() => initCacheKillSwitch(db), 2000); 
    }
});
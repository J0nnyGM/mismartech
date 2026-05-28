// public/js/firebase-init.js
// --- PRE-OCULTACIÓN INSTANTÁNEA PARA EVITAR FLASH DE CONTENIDO EN MANTENIMIENTO ---
const _preloadPath = window.location.pathname;
if (localStorage.getItem('mismartech_maintenance_active') === 'true' && !_preloadPath.includes('/admin/') && !_preloadPath.includes('/auth/') && !_preloadPath.includes('mantenimiento.html')) {
    const style = document.createElement('style');
    style.id = 'maintenance-preload-hide';
    style.innerHTML = 'html { display: none !important; }';
    document.documentElement.appendChild(style);
}

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// 🔥 IMPORTAMOS LAS FUNCIONES NATIVAS DE ESCRITURA CON UN "ALIAS" (native...)
import { 
    getFirestore, collection, getDocs, doc, Timestamp, getDoc, deleteDoc, query, where, orderBy, limit, onSnapshot, limitToLast, endAt, startAt, serverTimestamp, arrayUnion, startAfter, getCountFromServer, getAggregateFromServer, sum, count, endBefore, documentId,
    addDoc as nativeAddDoc,
    setDoc as nativeSetDoc,
    updateDoc as nativeUpdateDoc,
    runTransaction as nativeRunTransaction,
    writeBatch as nativeWriteBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
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

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);
export const provider = new GoogleAuthProvider();


// ============================================================================
// 🛡️ INTERCEPTORES: Auto-inyección de updatedAt en TODA la app
// ============================================================================

export const addDoc = (reference, data) => {
    if (data && typeof data === 'object') {
        data.updatedAt = serverTimestamp();
        if (!data.createdAt) data.createdAt = serverTimestamp();
    }
    return nativeAddDoc(reference, data);
};

export const setDoc = (reference, data, options) => {
    if (data && typeof data === 'object') {
        data.updatedAt = serverTimestamp();
        if (!options?.merge && !data.createdAt) data.createdAt = serverTimestamp();
    }
    return nativeSetDoc(reference, data, options);
};

export const updateDoc = (reference, data) => {
    if (data && typeof data === 'object') {
        data.updatedAt = serverTimestamp();
    }
    return nativeUpdateDoc(reference, data);
};

export const writeBatch = (dbInstance) => {
    const batch = nativeWriteBatch(dbInstance);
    // Envolvemos el batch para no perder la inyección si usan encadenamiento (chaining)
    const wrappedBatch = {
        set: (ref, data, options) => {
            if (data && typeof data === 'object') {
                data.updatedAt = serverTimestamp();
                if (!options?.merge && !data.createdAt) data.createdAt = serverTimestamp();
            }
            batch.set(ref, data, options);
            return wrappedBatch;
        },
        update: (ref, data) => {
            if (data && typeof data === 'object') {
                data.updatedAt = serverTimestamp();
            }
            batch.update(ref, data);
            return wrappedBatch;
        },
        delete: (ref) => {
            batch.delete(ref);
            return wrappedBatch;
        },
        commit: () => batch.commit()
    };
    return wrappedBatch;
};

export const runTransaction = (dbInstance, updateFunction) => {
    return nativeRunTransaction(dbInstance, async (transaction) => {
        const wrappedTx = {
            get: (ref) => transaction.get(ref),
            set: (ref, data, options) => {
                if (data && typeof data === 'object') {
                    data.updatedAt = serverTimestamp();
                    if (!options?.merge && !data.createdAt) data.createdAt = serverTimestamp();
                }
                transaction.set(ref, data, options);
                return wrappedTx;
            },
            update: (ref, data) => {
                if (data && typeof data === 'object') {
                    data.updatedAt = serverTimestamp();
                }
                transaction.update(ref, data);
                return wrappedTx;
            },
            delete: (ref) => {
                transaction.delete(ref);
                return wrappedTx;
            }
        };
        return updateFunction(wrappedTx);
    });
};

// Exportar las demás utilidades de Firebase sin modificar
export { 
    onAuthStateChanged, signInWithPopup, signOut, collection, getDocs, doc, 
    limitToLast, getDoc, deleteDoc, query, orderBy, limit, startAt, endAt, 
    where, ref, uploadBytes, getDownloadURL, onSnapshot, serverTimestamp, 
    arrayUnion, Timestamp, httpsCallable, startAfter, getCountFromServer, 
    getAggregateFromServer, sum, count, endBefore, documentId
};

// ==========================================
// 💥 KILL SWITCH: DESTRUCCIÓN TOTAL DE CACHÉ EN TIEMPO REAL
// ==========================================
export function initCacheKillSwitch(db) {
    if (!navigator.onLine) return;

    try {
        const configRef = doc(db, "config", "system");
        
        onSnapshot(configRef, async (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                
                // --- 🛡️ MODO MANTENIMIENTO INTEGRADO (URL ESTÁTICA) ---
                const maintenanceMode = data.maintenanceMode || false;
                const path = window.location.pathname;
                const isShowingMaintenance = document.body && document.body.getAttribute('data-maintenance') === 'active';
                
                if (maintenanceMode) {
                    // Guardamos estado para la pre-ocultación rápida en el siguiente page load
                    localStorage.setItem('mismartech_maintenance_active', 'true');

                    // Si no estamos en administración, ni en autenticación y no estamos mostrando ya el mantenimiento
                    if (!path.includes('/admin/') && !path.includes('/auth/') && !path.includes('mantenimiento.html') && !isShowingMaintenance) {
                        console.warn("🛡️ MODO MANTENIMIENTO ACTIVO. Cargando interfaz de mantenimiento en pantalla...");
                        try {
                            const res = await fetch('/mantenimiento.html');
                            if (res.ok) {
                                const html = await res.text();
                                
                                // Reemplazamos el documento por el HTML de mantenimiento sin alterar la URL,
                                // inyectando el atributo de forma nativa en la cadena HTML para evitar bucles infinitos
                                const injectedHtml = html.replace('<body', '<body data-maintenance="active"');
                                
                                document.open();
                                document.write(injectedHtml);
                                document.close();
                            }
                        } catch (e) {
                            console.error("Error al inyectar mantenimiento:", e);
                            if (document.body) {
                                document.body.innerHTML = `
                                    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background-color:#0a0a0a;color:white;font-family:sans-serif;text-align:center;padding:20px;z-index:99999;position:fixed;inset:0;">
                                        <h1 style="color:#F05A28;font-size:2.5rem;font-weight:900;margin-bottom:10px;">Estamos mejorando para ti</h1>
                                        <p style="color:#a0a0a0;max-width:500px;font-weight:500;">MiSmartech se encuentra temporalmente en labores de mantenimiento técnico. Volveremos muy pronto.</p>
                                    </div>
                                `;
                            }
                        }
                        return; // Detenemos la ejecución posterior
                    }
                } else {
                    localStorage.setItem('mismartech_maintenance_active', 'false');

                    // Si se quitó el mantenimiento, removemos la pre-ocultación si existía
                    const preloadHide = document.getElementById('maintenance-preload-hide');
                    if (preloadHide) preloadHide.remove();

                    // Si el mantenimiento finalizó, pero seguimos mostrando la interfaz o estamos físicamente en /mantenimiento.html
                    if (isShowingMaintenance || path.includes('mantenimiento.html')) {
                        console.log("🔓 MODO MANTENIMIENTO DESACTIVADO. Restableciendo sitio original...");
                        window.location.reload();
                        return;
                    }
                }

                const serverVersion = data.cacheVersion || 1;
                const localVersionString = localStorage.getItem('mismartech_cache_version');

                if (localVersionString === null) {
                    localStorage.setItem('mismartech_cache_version', serverVersion.toString());
                    return; 
                }

                const localVersion = parseInt(localVersionString);
                
                if (serverVersion > localVersion) {
                    console.warn(`💥 KILL SWITCH ACTIVADO (v${serverVersion}). Borrando absolutamente todo...`);

                    localStorage.clear(); 
                    sessionStorage.clear();

                    if ('caches' in window) {
                        const cacheNames = await caches.keys();
                        await Promise.all(cacheNames.map(name => caches.delete(name)));
                    }

                    if ('serviceWorker' in navigator) {
                        const registrations = await navigator.serviceWorker.getRegistrations();
                        for (let registration of registrations) {
                            await registration.unregister();
                        }
                    }

                    localStorage.setItem('mismartech_cache_version', serverVersion.toString());

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

window.addEventListener('load', () => {
    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => initCacheKillSwitch(db));
    } else {
        setTimeout(() => initCacheKillSwitch(db), 2000); 
    }
});
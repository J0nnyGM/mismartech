// public/js/admin/admin-guard.js
import { auth, db, doc, getDoc, onAuthStateChanged } from '../firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

const denyAccess = (msg = "Acceso denegado: Usuario no autorizado.") => {
    console.warn(msg);
    // Borra el historial para que no puedan volver atrás
    window.location.replace("/auth/login.html"); 
};

const redirectHome = (msg) => {
    alert(msg);
    window.location.replace("/admin/index.html");
};

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        denyAccess();
        return;
    }

    try {
        const docRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const userData = docSnap.data();
            const role = userData.role || 'customer';
            const staffRoles = ['admin', 'contabilidad', 'ventas', 'logistica'];

            // 1. Verificar si es empleado
            if (!staffRoles.includes(role)) {
                alert("No tienes permisos para acceder al panel administrativo.");
                window.location.replace("/index.html");
                return;
            }

            // Guardar datos de sede y rol en sessionStorage
            const assignedBranchId = userData.assignedBranchId || (role === 'admin' ? 'ALL' : 'bodega');
            sessionStorage.setItem('adminUserRole', role);
            sessionStorage.setItem('adminUserBranchId', assignedBranchId);
            
            // Si activeBranchId no está inicializado, o es inválido para el usuario, lo definimos
            if (role !== 'admin' && assignedBranchId !== 'ALL') {
                sessionStorage.setItem('activeBranchId', assignedBranchId);
            } else {
                let activeBranch = sessionStorage.getItem('activeBranchId');
                if (!activeBranch || activeBranch === 'sede_principal') {
                    sessionStorage.setItem('activeBranchId', 'bodega');
                }
            }

            // 2. Definir permisos de rutas por rol
            const path = window.location.pathname.split('/').pop() || 'index.html';
            
            const allowedRoutes = {
                'admin': ['all'], // Todo permitido
                'contabilidad': ['index.html', 'invoices.html', 'cartera.html', 'treasury.html', 'expenses.html', 'profitability.html', 'branches.html'],
                'ventas': ['index.html', 'whatsapp.html', 'orders.html', 'clients.html', 'warranties.html', 'products.html', 'categories.html', 'promotions.html', 'branches.html'],
                'logistica': ['index.html', 'orders.html', 'products.html', 'inventory-entry.html', 'warranty-inventory.html', 'shipping-config.html', 'branches.html']
            };

            // 3. Proteger las rutas estrictamente
            if (role !== 'admin') {
                const userAllowedRoutes = allowedRoutes[role] || [];
                // Si la ruta actual no está en su lista permitida, lo mandamos al dashboard
                if (!userAllowedRoutes.includes(path) && path !== '') {
                    redirectHome(`Tu rol (${role.toUpperCase()}) no tiene permiso para ver esta sección.`);
                    return;
                }
            }

            console.log(`✅ Acceso concedido [Rol: ${role.toUpperCase()}]:`, user.email);
            
            // Le pasamos el rol al UI para que construya el menú dinámico
            loadAdminSidebar(role);
            
            document.body.style.display = 'flex'; 
            
        } else {
            denyAccess("Usuario no encontrado en la base de datos.");
        }
    } catch (error) {
        console.error("Error verificando permisos:", error);
        denyAccess("Error de conexión al verificar permisos.");
    }
});
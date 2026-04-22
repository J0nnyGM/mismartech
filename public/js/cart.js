import { db, doc, onSnapshot } from "./firebase-init.js";

// Clave para guardar en el navegador
const CART_KEY = 'pixeltech_cart';

// --- CONTROLADORES DE TIEMPO REAL ---
let cartUnsubscribers = {}; // Guarda las conexiones activas por ID de producto

// --- 1. OBTENER CARRITO ---
export function getCart() {
    const cart = localStorage.getItem(CART_KEY);
    return cart ? JSON.parse(cart) : [];
}

// --- 2. GUARDAR CARRITO (Interna) ---
function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event('cartUpdated')); 
    updateCartCount();
    
    // 🔥 Cada vez que el carrito cambia, ajustamos los vigilantes en tiempo real
    startCartSync(); 
}

// --- 3. AGREGAR ITEM (VALIDANDO STOCK) ---
export function addToCart(product) {
    const cart = getCart();
    
    const pColor = product.color || null;
    const pCapacity = product.capacity || null;
    const maxStock = product.maxStock || 999; 

    const uniqueCartId = `${product.id}-${pColor || 'def'}-${pCapacity || 'def'}`;
    const existingItem = cart.find(item => item.cartId === uniqueCartId);

    let newQty = product.quantity || 1;

    if (existingItem) {
        newQty += existingItem.quantity;
        if (newQty > maxStock) {
            return { success: false, message: `Solo hay ${maxStock} unidades disponibles.` };
        }
        existingItem.quantity = newQty;
    } else {
        if (newQty > maxStock) {
            return { success: false, message: `Solo hay ${maxStock} unidades disponibles.` };
        }
        cart.push({
            cartId: uniqueCartId,
            id: product.id,
            name: product.name,
            // Aseguramos que los precios siempre se guarden como enteros limpios
            price: Math.round(Number(product.price)) || 0,
            originalPrice: Math.round(Number(product.originalPrice)) || 0,
            image: product.mainImage || product.image || 'https://placehold.co/100',
            color: pColor,       
            capacity: pCapacity, 
            quantity: newQty,
            maxStock: maxStock
        });
    }

    saveCart(cart);
    window.dispatchEvent(new Event('cartItemAdded'));
    
    return { success: true };
}

// --- 4. ACTUALIZAR CANTIDAD (VALIDANDO STOCK) ---
export function updateQuantity(cartId, newQty) {
    let cart = getCart();
    const item = cart.find(i => i.cartId === cartId);

    if (item) {
        const qty = parseInt(newQty);
        const max = item.maxStock || 999; 
        
        if (qty > max) {
            return { success: false, message: `Máximo ${max} unidades.` };
        }

        if (qty <= 0) {
            cart = cart.filter(i => i.cartId !== cartId);
        } else {
            item.quantity = qty;
        }
        saveCart(cart);
        return { success: true };
    }
    return { success: false, message: "Producto no encontrado" };
}

// --- 5. ELIMINAR ITEM (Por ID de carrito) ---
export function removeFromCart(cartId) {
    let cart = getCart();
    cart = cart.filter(item => item.cartId !== cartId);
    saveCart(cart);
}

// --- 6. ELIMINAR UNA UNIDAD (Por ID de Producto - Genérico) ---
export function removeOneUnit(productId) {
    let cart = getCart();
    const index = cart.findIndex(item => item.id === productId);
    
    if (index !== -1) {
        if (cart[index].quantity > 1) {
            cart[index].quantity -= 1;
        } else {
            cart.splice(index, 1);
        }
        saveCart(cart);
    }
}

// --- 7. CALCULAR TOTAL ---
export function getCartTotal() {
    const cart = getCart();
    return cart.reduce((total, item) => {
        if (item.maxStock !== undefined && item.maxStock <= 0) {
            return total; // No sumar productos agotados
        }
        return total + (item.price * item.quantity);
    }, 0);
}

// --- 8. ACTUALIZAR BADGES (UI) ---
export function updateCartCount() {
    const cart = getCart();
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    
    const badges = document.querySelectorAll('#cart-count-desktop, #cart-count-mobile');
    badges.forEach(badge => {
        badge.textContent = count;
        if(count > 0) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
    });
}

// --- 9. OBTENER CANTIDAD TOTAL DE UN PRODUCTO ---
export function getProductQtyInCart(productId) {
    const cart = getCart();
    return cart
        .filter(item => item.id === productId)
        .reduce((sum, item) => sum + (item.quantity || 0), 0);
}


// ==========================================================================
// 🧠 MOTOR DE SINCRONIZACIÓN EN TIEMPO REAL DEL CARRITO (ONSNAPSHOT)
// ==========================================================================

export function startCartSync() {
    const cart = getCart();
    // Extraer solo los IDs base de los productos (sin importar las variantes)
    const productIdsInCart = [...new Set(cart.map(i => i.id))];
    
    // 1. LIMPIEZA: Apagar escuchas de productos que ya no están en el carrito
    Object.keys(cartUnsubscribers).forEach(id => {
        if (!productIdsInCart.includes(id)) {
            cartUnsubscribers[id](); // Apaga el onSnapshot
            delete cartUnsubscribers[id];
        }
    });
    
    // 2. INICIAR: Encender escuchas para los productos que están en el carrito
    productIdsInCart.forEach(productId => {
        if (!cartUnsubscribers[productId]) {
            cartUnsubscribers[productId] = onSnapshot(doc(db, "products", productId), (snap) => {
                if (snap.exists()) {
                    updateCartItemsFromCloud(productId, snap.data());
                } else {
                    // Si el producto fue borrado de Firebase, marcar stock 0
                    updateCartItemsFromCloud(productId, { stock: 0, status: 'inactive' });
                }
            }, (error) => {
                console.error(`Error vigilando producto ${productId}:`, error);
            });
        }
    });
}

// Helper: Procesa la info que llega de la nube y ajusta el carrito si es necesario
function updateCartItemsFromCloud(productId, pData) {
    let cart = getCart();
    let hasChanges = false;
    
    cart.forEach(item => {
        if (item.id === productId) {
            let newPrice = pData.price || 0;
            let newStock = pData.stock || 0;
            const isInactive = pData.status !== 'active';
            
            // Si el producto fue desactivado o borrado, forzamos stock a 0
            if (isInactive) {
                newStock = 0;
            } 
            // Si tiene combinaciones, buscamos el stock y precio exacto de su variante
            else if (pData.combinations && pData.combinations.length > 0) {
                const combo = pData.combinations.find(c => 
                    (c.color === item.color || (!c.color && !item.color)) &&
                    (c.capacity === item.capacity || (!c.capacity && !item.capacity))
                );
                if (combo) {
                    newPrice = combo.price;
                    newStock = combo.stock;
                } else {
                    newStock = 0; // Esa variante específica ya no existe
                }
            } 
            // Si solo tiene capacidades simples
            else if (item.capacity && pData.capacities) {
                const cap = pData.capacities.find(c => c.label === item.capacity);
                if (cap) {
                    newPrice = cap.price;
                }
            }

            // Detectamos si el precio, el stock o el nombre cambiaron
            if (item.price !== newPrice || item.maxStock !== newStock || item.name !== pData.name) {
                item.price = newPrice;
                item.maxStock = newStock;
                item.name = pData.name || item.name;
                item.originalPrice = pData.originalPrice || 0;
                
                // Si el nuevo stock máximo es menor a lo que el cliente quería, ajustamos su cantidad
                if (newStock > 0 && item.quantity > newStock) {
                    item.quantity = newStock;
                }

                hasChanges = true;
            }
        }
    });
    
    // Solo si detectó un cambio real, guarda silenciosamente y avisa a la UI
    if (hasChanges) {
        console.log(`🛒 [Cart Sync] El producto ${productId} cambió de precio o stock en vivo.`);
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
        window.dispatchEvent(new Event('cartUpdated')); 
        updateCartCount();
    }
}

// Iniciar vigilancia apenas se cargue el archivo por primera vez
document.addEventListener('DOMContentLoaded', () => {
    startCartSync();
});